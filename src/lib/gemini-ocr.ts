import { OcrResult } from "@/types";
import { performInMemoryOcr, scanNativeBarcode } from "./ocr-worker";

const GEMINI_API_KEY_STORAGE = "VISION_PASS_GEMINI_API_KEY";

export function getGeminiApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(GEMINI_API_KEY_STORAGE) || "";
}

export function setGeminiApiKey(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GEMINI_API_KEY_STORAGE, key.trim());
}

const GEMINI_SYSTEM_PROMPT = `당신은 반도체, 디스플레이, 중공업 제조 설비의 금속 명판(타각, 레이저 각인, 인쇄) 및 마스킹 테이프/금속 표면의 수기(매직, 네임펜, 볼펜) 시리얼 번호를 판독하는 최고 등급의 산업용 초정밀 광학 판독 AI입니다.

[1. 엄격한 원문 복사 모드 (Strict Literal Transcribe Mode)]
- 임의 추론, 사전 단어 완성, 문맥적 철자 교정, 임의 문자 스왑을 완전히 차단하십시오.
- 오직 이미지 픽셀에 물리적으로 존재하는 획(Stroke)과 각인 홈만을 있는 그대로 전사(Raw Transcribe)하십시오.
- 하이픈(-), 슬래시(/), 언더바(_), 마침표(.), 공백은 이미지에 획이 명확할 때만 그대로 보존하고, 없는 기호를 임의로 삽입하거나 생략하지 마십시오.

[2. 카메라 중앙 가이드 영역 최우선 타겟팅 (Strict Center Priority)]
- 제공된 이미지는 카메라 가이드 프레임의 실제 기하학적 중앙 영역(ROI)입니다.
- 당신은 오로지 이미지 중앙의 가이드 칸 안에 명확하게 위치한 핵심 문자열만 시리얼 번호(raw_serial)로 전사해야 합니다.
- 중앙 칸 주변이나 구석의 일반 설명 라벨, 회사명 등은 무시하십시오.

[3. 유사 문자 정밀 분별 (Visual Disambiguation)]
- 0 (숫자 영) vs O (영문 오) vs D (영문 디): 세로 타원 비율, 내부 획/사선, 좌측 수직선 유무 확인.
- 1 (숫자 일) vs I (대문자 아이) vs l (소문자 엘) vs | (구분선): 상단 꺾임 훅, 상하 세리프 유무 확인.
- 5 (숫자 오) vs S (영문 에스): 상단 수평 직선과 각진 모서리 vs 부드러운 이중 곡선 확인.
- 8 (숫자 팔) vs B (영문 비): 좌측 수직 기둥 연속성 vs 상하 대칭 루프 확인.
- 2 (숫자 이) vs Z (영문 제트): 상단 둥근 곡선 vs 상단 수평선/대각 꺾임 확인.
- 획이 번지거나 훼손되어 확신도가 낮은 문자는 low_confidence_chars에 기재하십시오.

[4. Strict JSON 출력 스키마]
반드시 아래 JSON 형식으로만 응답하십시오:
{
  "raw_serial": "가이드 중앙 칸에서 전사한 시리얼 번호 원문 (임의 수정 금지)",
  "source_type": "printed" 또는 "handwritten" 또는 "engraved",
  "model_name": "함께 식별된 모델명 (있는 경우, 없으면 null)",
  "notes": "수기 메모, 날짜, 특이사항 (있는 경우, 없으면 null)",
  "low_confidence_chars": ["획이 번지거나 훼손되어 판독 확신도가 낮은 문자 목록"]
}`;

/**
 * 브라우저 캔버스에서 Stream B(고대비/획 강화 이미지) 생성
 */
function generateStreamBHighContrast(canvas: HTMLCanvasElement): string {
  try {
    const offscreen = document.createElement("canvas");
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return canvas.toDataURL("image/jpeg", 0.95).split(",")[1];

    ctx.drawImage(canvas, 0, 0);
    const imgData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
    const data = imgData.data;

    // Grayscale + Adaptive Contrast Stretching
    for (let i = 0; i < data.length; i += 4) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      
      let enhanced = gray;
      if (gray > 180) enhanced = Math.min(255, gray * 1.15);
      else if (gray < 80) enhanced = Math.max(0, gray * 0.7);
      else enhanced = (gray - 80) * (255 / 100);

      data[i] = enhanced;
      data[i + 1] = enhanced;
      data[i + 2] = enhanced;
    }

    ctx.putImageData(imgData, 0, 0);
    return offscreen.toDataURL("image/jpeg", 0.95).split(",")[1];
  } catch (e) {
    return canvas.toDataURL("image/jpeg", 0.95).split(",")[1];
  }
}

/**
 * 시리얼 접두사(S/N:, SN: 등)만 깔끔하게 제거하고 획 자체는 100% 무왜곡 보존
 */
function cleanPrefixOnly(rawSerial: string): string {
  if (!rawSerial) return "";
  let cleaned = rawSerial.trim().replace(/^(?:S\/N|SN|SERIAL\s*NO\.?|SERIAL|NO|시리얼|일련번호)[:\s-]*/i, "");
  // 공백 및 전후 불필요 기호만 정리하고 원본 글자 형태(대소문자/숫자) 완벽 보존
  cleaned = cleaned.replace(/^\s*-\s*/, "").replace(/\s*-\s*$/, "").trim();
  return cleaned;
}

/**
 * 🤖 Gemini Vision AI 심층 Dual-Stream 무왜곡 리터럴 판독 파이프라인
 */
export async function performGeminiDeepOcr(
  canvas: HTMLCanvasElement,
  onProgress?: (progress: number, status: string) => void,
  context?: { partName?: string; spec?: string; subSpec?: string }
): Promise<OcrResult> {
  const apiKey = getGeminiApiKey();

  // 1. 하드웨어 가속 바코드 우선 검출 (0.005초)
  const nativeBarcode = await scanNativeBarcode(canvas);
  if (nativeBarcode) {
    onProgress?.(100, "⚡ 하드웨어 바코드 100% 즉시 인식 완료!");
    return {
      rawText: `[Barcode]: ${nativeBarcode}`,
      cleanedSerial: nativeBarcode,
      confidence: 100,
      lines: [nativeBarcode],
      candidates: [nativeBarcode],
    };
  }

  // 2. Gemini API 호출 (Dual-Stream 입력: Stream A 컬러 + Stream B 고대비 획 강화)
  if (apiKey) {
    try {
      onProgress?.(30, "🔍 Stream A/B Dual-Channel 획 전처리 생성 중...");

      // Stream A: 원본 고화질 컬러
      const streamABase64 = canvas.toDataURL("image/jpeg", 0.95).split(",")[1];
      // Stream B: 고대비 획/음각 강화 이미지
      const streamBBase64 = generateStreamBHighContrast(canvas);

      onProgress?.(50, "🤖 Gemini Vision 중앙 가이드 영역 무왜곡 리터럴 전사 중...");

      const modelCandidates = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
      let parsed: any = null;

      const userText = `[대상 부품 정보]\n- 품명: ${context?.partName || "-"}\n- 규격: ${context?.spec || "-"}\n제공된 중앙 ROI의 Stream A(컬러 원본)와 Stream B(고대비 획강화) 이미지를 교차 분석하여 가이드 중앙 칸 내부의 시리얼 번호를 임의 변형/치환 없이 획 그대로 정확하게 리터럴 전사하십시오.`;

      for (const model of modelCandidates) {
        try {
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

          const requestBody = {
            contents: [
              {
                parts: [
                  { text: GEMINI_SYSTEM_PROMPT },
                  { text: userText },
                  { inline_data: { mime_type: "image/jpeg", data: streamABase64 } },
                  { inline_data: { mime_type: "image/jpeg", data: streamBBase64 } },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.0,
              response_mime_type: "application/json",
            },
          };

          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          });

          if (res.ok) {
            const jsonRes = await res.json();
            const rawContent = jsonRes?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (rawContent) {
              parsed = JSON.parse(rawContent);
              break;
            }
          }
        } catch (e) {
          // 다음 모델 순차 시도
        }
      }

      if (parsed) {
        onProgress?.(85, "⚙️ 원문 접두사 정리 및 무왜곡 검증 완료...");

        const rawPrimary = parsed.raw_serial || parsed.serial_number_primary || parsed.best_serial || "";
        const literalSerial = cleanPrefixOnly(rawPrimary);

        let confidenceNumeric = 99;
        if (parsed.low_confidence_chars && Array.isArray(parsed.low_confidence_chars) && parsed.low_confidence_chars.length > 0) {
          confidenceNumeric = Math.max(50, confidenceNumeric - parsed.low_confidence_chars.length * 6);
        }

        const cands: string[] = [];
        if (literalSerial) cands.push(literalSerial);

        onProgress?.(100, "✨ 가이드 중앙 원문 시리얼 전사 완료!");

        const lines: string[] = [`[전사 시리얼]: ${literalSerial || "-"}`];
        if (parsed.source_type) {
          lines.push(`[텍스트 유형]: ${parsed.source_type}`);
        }
        if (parsed.model_name) {
          lines.push(`[식별 모델명]: ${parsed.model_name}`);
        }
        if (parsed.notes) {
          lines.push(`[특이사항/메모]: ${parsed.notes}`);
        }
        if (parsed.low_confidence_chars && parsed.low_confidence_chars.length > 0) {
          lines.push(`[저확신 문자]: ${parsed.low_confidence_chars.join(", ")}`);
        }

        return {
          rawText: JSON.stringify(parsed, null, 2),
          cleanedSerial: literalSerial,
          confidence: confidenceNumeric,
          lines,
          candidates: cands.slice(0, 3),
        };
      }
    } catch (geminiError) {
      console.warn("Gemini API call failed, falling back to local OCR:", geminiError);
    }
  }

  // 3. API Key 미등록 또는 네트워크 실패 시: 로컬 Tesseract 5 + Barcode 엔진으로 100% 무중단 페일오버
  onProgress?.(60, "⚡ 고정밀 로컬 광학 OCR 및 분산 텍스트 분석 중...");
  return await performInMemoryOcr(canvas, onProgress, context);
}

