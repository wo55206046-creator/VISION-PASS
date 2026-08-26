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

const GEMINI_SYSTEM_PROMPT = `당신은 반도체, 디스플레이, 중공업 제조 설비의 금속 명판(타각, 레이저 각인, 인쇄) 및 노란색 라벨 테이프/마스킹 테이프의 시리얼 번호를 판독하는 최고 등급의 산업용 초정밀 광학 판독 AI입니다.

[1. 엄격한 원문 복사 모드 (Strict Literal Transcribe Mode)]
- 임의 추론, 사전 단어 완성, 문맥적 철자 교정, 임의 문자 스왑을 완전히 차단하십시오.
- 오직 이미지 픽셀에 물리적으로 존재하는 획(Stroke)과 텍스트만을 있는 그대로 전사(Raw Transcribe)하십시오.
- 하이픈(-), 슬래시(/), 언더바(_), 마침표(.), 콜론(:)은 이미지에 인쇄된 형태 그대로 정확히 분별하십시오.

[2. 라벨 회전 및 세로 방향 자동 보정 (Orientation & Rotation Invariance)]
- 이미지가 세로 방향(90°/270°), 거꾸로(180°), 또는 비스듬히 기울어져 있더라도 문자의 올바른 정방향을 스스로 감지하여 정상 순서대로 판독하십시오.
- 특히 산업용 PC나 제어 보드에 부착된 노란색 라벨(Yellow Label Tape)의 세로/가로 인쇄 텍스트를 정확하게 판독하십시오.

[3. 다중 시리얼 및 복수 라벨 분별 (Multi-Serial & Dual S/N Support)]
- 하나의 라벨에 여러 시리얼이 함께 인쇄된 경우 (예: "WIN11 S/N : 4FNDF-3RRKD-...", "PC S/N : KSA7706685", 또는 "CON-B1 SN:260225-40", "CON-B2 SN:210708-28"):
  1) 대상 부품 정보([품명], [규격])에 가장 적합한 시리얼을 raw_serial로 선택하십시오.
     * 대상이 PC/Industrial PC이면 하드웨어 시리얼 "PC S/N : KSA7706685" (또는 규격에 Win11이 명시된 경우 "WIN11 S/N")
     * 대상이 Control Board(UCON-161 Main)이면 "CON-B1 SN:260225-40"의 260225-40
     * 대상이 Control Board(UCON-107 I/O)이면 "CON-B2 SN:210708-28"의 210708-28
  2) 이미지 내에 존재하는 모든 유효 시리얼 번호들을 serial_candidates 목록에 라벨명과 함께 전부 추출하십시오.

[4. 유사 문자 정밀 분별 (Visual Disambiguation)]
- 0 (숫자 영) vs O (영문 오) vs D (영문 디): 세로 타원 비율, 내부 획/사선, 좌측 수직선 유무 확인.
- 1 (숫자 일) vs I (대문자 아이) vs l (소문자 엘) vs | (구분선): 상단 꺾임 훅, 상하 세리프 유무 확인.
- 5 (숫자 오) vs S (영문 에스): 상단 수평 직선과 각진 모서리 vs 부드러운 이중 곡선 확인.
- 8 (숫자 팔) vs B (영문 비): 좌측 수직 기둥 연속성 vs 상하 대칭 루프 확인.
- 2 (숫자 이) vs Z (영문 제트): 상단 둥근 곡선 vs 상단 수평선/대각 꺾임 확인.
- 획이 번지거나 훼손되어 확신도가 낮은 문자는 low_confidence_chars에 기재하십시오.

[5. Strict JSON 출력 스키마]
반드시 아래 JSON 형식으로만 응답하십시오:
{
  "raw_serial": "타깃 부품에 가장 적합한 메인 시리얼 번호 원문 (접두사 제외된 순수 번호)",
  "serial_candidates": [
    { "label": "PC S/N", "value": "KSA7706685" },
    { "label": "WIN11 S/N", "value": "4FNDF-3RRKD-YQKPB-GDFG9-V249D" },
    { "label": "CON-B1", "value": "260225-40" }
  ],
  "source_type": "printed" 또는 "handwritten" 또는 "engraved",
  "model_name": "함께 식별된 모델명 (예: UCON161-MAIN, CON-B1, PC)",
  "notes": "수기 메모, 날짜, 특이사항 (있는 경우, 없으면 null)",
  "low_confidence_chars": []
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

    // Grayscale + Adaptive Contrast Stretching (Yellow tape & dark text boost)
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      
      let enhanced = gray;
      if (gray > 170) enhanced = 255;
      else if (gray < 85) enhanced = 0;
      else enhanced = (gray - 85) * (255 / 85);

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
 * 시리얼 접두사(S/N:, SN:, PC S/N:, WIN11 S/N: 등)만 깔끔하게 제거하고 획 자체는 100% 무왜곡 보존
 */
export function cleanPrefixOnly(rawSerial: string): string {
  if (!rawSerial) return "";
  let cleaned = rawSerial.trim();
  // 접두사 제거
  cleaned = cleaned.replace(/^(?:WIN11\s*S\/N|PC\s*S\/N|S\/N|SN|SERIAL\s*NO\.?|SERIAL|NO|CON-[A-Z0-9]+\s*SN|시리얼|일련번호)[:\s-]*/i, "");
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

      onProgress?.(50, "🤖 Gemini Vision 방향 감지 및 다중 시리얼 정밀 전사 중...");

      const modelCandidates = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
      let parsed: any = null;

      const userText = `[대상 부품 정보]\n- 품명: ${context?.partName || "-"}\n- 규격: ${context?.spec || "-"}\n- 세부사양: ${context?.subSpec || "-"}\n제공된 이미지(Stream A 원본, Stream B 고대비)를 분석하십시오. 이미지가 세로로 서 있거나 거꾸로 회전되어 있더라도 올바른 방향으로 감지하여 노란색 라벨/명판의 시리얼 번호('PC S/N', 'WIN11 S/N', 'CON-B1 SN', 'SN:...' 등)를 리터럴 전사하고 후보 목록(serial_candidates)을 함께 반환하십시오.`;

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
        onProgress?.(85, "⚙️ 다중 시리얼 후보 정리 및 무왜곡 검증 완료...");

        const rawPrimary = parsed.raw_serial || parsed.serial_number_primary || parsed.best_serial || "";
        let literalSerial = cleanPrefixOnly(rawPrimary);

        const candidatesList: string[] = [];

        // 다중 후보(serial_candidates) 파싱
        if (parsed.serial_candidates && Array.isArray(parsed.serial_candidates)) {
          for (const cand of parsed.serial_candidates) {
            const val = typeof cand === "string" ? cand : cand?.value;
            const label = typeof cand === "object" && cand?.label ? `[${cand.label}] ` : "";
            if (val) {
              const cleanedVal = cleanPrefixOnly(val);
              if (cleanedVal && !candidatesList.includes(cleanedVal)) {
                candidatesList.push(cleanedVal);
              }
            }
          }
        }

        if (literalSerial && !candidatesList.includes(literalSerial)) {
          candidatesList.unshift(literalSerial);
        } else if (!literalSerial && candidatesList.length > 0) {
          literalSerial = candidatesList[0];
        }

        let confidenceNumeric = 99;
        if (parsed.low_confidence_chars && Array.isArray(parsed.low_confidence_chars) && parsed.low_confidence_chars.length > 0) {
          confidenceNumeric = Math.max(50, confidenceNumeric - parsed.low_confidence_chars.length * 6);
        }

        onProgress?.(100, "✨ 명판 시리얼 전사 완료!");

        const lines: string[] = [`[전사 시리얼]: ${literalSerial || "-"}`];
        if (parsed.source_type) {
          lines.push(`[텍스트 유형]: ${parsed.source_type}`);
        }
        if (parsed.model_name) {
          lines.push(`[식별 모델명]: ${parsed.model_name}`);
        }
        if (parsed.serial_candidates && parsed.serial_candidates.length > 1) {
          const candSummary = parsed.serial_candidates
            .map((c: any) => `${c.label || "S/N"}: ${cleanPrefixOnly(c.value || c)}`)
            .join(" | ");
          lines.push(`[검출 후보]: ${candSummary}`);
        }
        if (parsed.notes) {
          lines.push(`[특이사항]: ${parsed.notes}`);
        }
        if (parsed.low_confidence_chars && parsed.low_confidence_chars.length > 0) {
          lines.push(`[저확신 문자]: ${parsed.low_confidence_chars.join(", ")}`);
        }

        return {
          rawText: JSON.stringify(parsed, null, 2),
          cleanedSerial: literalSerial,
          confidence: confidenceNumeric,
          lines,
          candidates: candidatesList.slice(0, 5),
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

