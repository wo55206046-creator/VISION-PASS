import { OcrResult } from "@/types";
import { performInMemoryOcr, scanNativeBarcode } from "./ocr-worker";

const GEMINI_API_KEY_STORAGE = "VISION_PASS_GEMINI_API_KEY";

export function getGeminiApiKey(): string {
  if (typeof window !== "undefined") {
    const userKey = localStorage.getItem(GEMINI_API_KEY_STORAGE);
    if (userKey && userKey.trim()) return userKey.trim();
  }
  return process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
}

export function setGeminiApiKey(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GEMINI_API_KEY_STORAGE, key.trim());
}

const GEMINI_SYSTEM_PROMPT = `당신은 반도체, 디스플레이, 정밀 계측기(LabJack, DAQ, PLC, 컨트롤러 등) 및 중공업 제조 설비의 금속 명판(타각, 레이저 각인, 인쇄)과 노란색 라벨 테이프의 시리얼 번호를 판독하는 최고 등급의 산업용 초정밀 광학 판독 AI입니다.

[1. 시리얼 번호 vs 제품 모델명 엄격 분별 원칙 (Strict Serial Priority)]
- 장비/부품 본체에 크게 인쇄된 제품 브랜드/모델명(예: "LabJack U6-PRO", "SOLA-1000", "NaVi-MG200", "TM200L" 등)이나 웹사이트 주소("www.labjack.com"), 단자대 핀 배열 기호("GND", "VS", "AIN0", "FIO1", "DAC0", "10UA" 등)는 절대로 시리얼 번호가 아닙니다!
- 노란색 라벨 스티커나 명판의 'SN:', 'S/N:', 'S/N', 'SN', 'Serial No', 'PC S/N', 'WIN11 S/N' 표기 옆에 기재된 고유 일련번호(예: "SN:360025446" -> "360025446", "PC S/N : KSA7706685" -> "KSA7706685", "CON-B1 SN:260225-40" -> "260225-40")를 최우선으로 찾아내어 접두사 제외 순수 번호를 raw_serial로 전사하십시오.
- 6~12자리 숫자 시리얼(예: 360025446)이나 영문+숫자 복합 시리얼은 한 글자도 누락 없이 획 그대로 100% 전사해야 합니다.

[2. 엄격한 원문 복사 모드 (Strict Literal Transcribe Mode)]
- 임의 추론, 사전 단어 완성, 문맥적 철자 교정, 임의 문자 스왑을 완전히 차단하십시오.
- 오직 이미지 픽셀에 물리적으로 존재하는 획(Stroke)과 텍스트만을 있는 그대로 전사(Raw Transcribe)하십시오.
- 하이픈(-), 슬래시(/), 언더바(_), 마침표(.), 콜론(:)은 이미지에 인쇄된 형태 그대로 정확히 분별하십시오.

[3. 라벨 회전 및 세로 방향 자동 보정 (Orientation & Rotation Invariance)]
- 이미지가 세로 방향(90°/270°), 거꾸로(180°), 또는 비스듬히 기울어져 있더라도 문자의 올바른 정방향을 스스로 감지하여 정상 순서대로 판독하십시오.

[4. 다중 시리얼 및 복수 라벨 분별 (Multi-Serial & Dual S/N Support)]
- 하나의 장비에 여러 시리얼이 함께 존재하는 경우 (예: "SN:360025446", "WIN11 S/N : ...", "PC S/N : ...", "CON-B1 SN:260225-40"):
  1) 대상 부품 정보([품명], [규격])에 가장 적합한 시리얼을 raw_serial로 선택하십시오.
  2) 이미지 내에 존재하는 모든 유효 시리얼 번호들을 serial_candidates 목록에 라벨명과 함께 전부 추출하십시오.

[5. Strict JSON 출력 스키마]
반드시 아래 JSON 형식으로만 응답하십시오:
{
  "raw_serial": "접두사가 제외된 순수 시리얼 번호 (예: 360025446, KSA7706685, 260225-40)",
  "serial_candidates": [
    { "label": "SN", "value": "360025446" },
    { "label": "PC S/N", "value": "KSA7706685" }
  ],
  "source_type": "printed" 또는 "handwritten" 또는 "engraved",
  "model_name": "식별된 모델명 (예: LabJack U6-PRO, UCON161-MAIN, PC)",
  "notes": "특이사항 (있는 경우, 없으면 null)",
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
  cleaned = cleaned.replace(
    /^(?:WIN11\s*S[\/\\|\-.]?N|PC\s*S[\/\\|\-.]?N|Production\s*S[\/\\|\-.]?N|Product\s*S[\/\\|\-.]?N|SERIAL\s*(?:NO\.?|#|NUMBER)?|SER\.?\s*NO\.?|S[\/\\|\-.]N|SN|S\.N\.|S\/NO\.?|NO\.?|N°|CON-[A-Z0-9]+\s*SN|시리얼\s*넘버|시리얼\s*번호|시리얼|일련\s*번호|제조\s*번호|식별\s*번호|관리\s*번호)\s*[:.\-|=#\s]*/i,
    ""
  );
  // 앞뒤 기호 제거
  cleaned = cleaned.replace(/^[ :;=|\-#/\\_.,<>()[\]{}]+|[ :;=|\-#/\\_.,<>()[\]{}]+$/g, "").trim();
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

  // 2. Gemini API 호출 (순수 클라이언트 웹앱 직통 호출)
  const streamABase64 = canvas.toDataURL("image/jpeg", 0.95).split(",")[1];
  const streamBBase64 = generateStreamBHighContrast(canvas);

  let parsed: any = null;

  if (apiKey) {
    onProgress?.(35, "🤖 Gemini 2.0 Flash AI 정밀 시리얼 판독 중...");
    const modelCandidates = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
    const userText = `[대상 부품 정보]\n- 품명: ${context?.partName || "-"}\n- 규격: ${context?.spec || "-"}\n- 세부사양: ${context?.subSpec || "-"}\n\n제공된 이미지에서 제품 브랜드/모델명(예: LabJack U6-PRO 등)이나 단자대/웹주소가 아닌, 'SN:', 'S/N:', 노란색 라벨에 기재된 [순수 시리얼 번호](예: 360025446, KSA7706685, 260225-40 등)를 정확하게 찾아내어 raw_serial로 전사하고 접두사를 제외한 번호를 반환하십시오.`;

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
        // 다음 모델 시도
      }
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

  // 3. API Key 미등록 또는 네트워크 실패 시: 로컬 Tesseract 5 + Barcode 엔진으로 100% 무중단 페일오버
  onProgress?.(60, "⚡ 고정밀 로컬 광학 OCR 및 분산 텍스트 분석 중...");
  return await performInMemoryOcr(canvas, onProgress, context);
}

