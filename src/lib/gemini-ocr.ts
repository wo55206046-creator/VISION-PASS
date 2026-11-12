import { OcrResult, OcrCandidateDetail } from "@/types";
import { performInMemoryOcr, scanNativeBarcode } from "./ocr-worker";

const GEMINI_API_KEY_STORAGE = "VISION_PASS_GEMINI_API_KEY";

/**
 * 사용할 Gemini 모델 우선순위 (앞에서부터 시도, 404/429/5xx 시 다음 모델로 폴백)
 * ※ gemini-2.0-flash / gemini-1.5-flash 는 서비스 종료되어 404가 반환됨
 */
export const GEMINI_MODEL_CANDIDATES = ["gemini-3.8-flash", "gemini-3.5-flash"];

/** Gemini 호출 타임아웃 (이미지 업로드 + 추론 시간을 고려해 충분히 확보) */
const GEMINI_TIMEOUT_MS = 25000;

export function isLikelyValidGeminiKey(key?: string | null): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  // Google AI Studio 키 형식: 기존 'AIzaSy...'(약 39자) 및 신규 'AQ.' 접두사 형식(약 53자) 모두 허용
  if (/\s/.test(trimmed)) return false;
  return (trimmed.startsWith("AIzaSy") || trimmed.startsWith("AQ.")) && trimmed.length >= 35;
}

export function getGeminiApiKey(): string {
  if (typeof window !== "undefined") {
    const userKey = localStorage.getItem(GEMINI_API_KEY_STORAGE);
    if (userKey && userKey.trim()) return userKey.trim();
  }
  const envKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (envKey && isLikelyValidGeminiKey(envKey)) return envKey.trim();
  return "";
}

export function setGeminiApiKey(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GEMINI_API_KEY_STORAGE, key.trim());
}

const GEMINI_SYSTEM_PROMPT = `당신은 반도체, 디스플레이, 정밀 계측기(LabJack, DAQ 등), 자동화 제어기(PLC, 컨트롤러, I/O 모듈), 산업용 PC(IPC), 서버, 모터 드라이버, 센서 등 [모든 산업용 부품의 명판 및 라벨]의 시리얼 번호를 판독하는 최고 등급의 범용 산업용 광학 판독 AI입니다.

[1. 다중 시리얼 후보 전수 수집 원칙 (Zero Omission)]
- 이미지 내에 존재하는 [모든 식별 번호와 시리얼 번호 후보]를 편향 없이 전수 탐색하여 serial_candidates 목록에 빠짐없이 등록하십시오.
- 특정 부품(윈도우 키나 특정 길이 등)에 편향되지 마십시오. 라벨에 인쇄된 각 번호의 성격을 label에 명시하고 실제 값을 value에 담으십시오.
- 예시:
  - 노란 라벨에 "WIN11 S/N : 2398N-..." 과 "PC S/N : KSA7706705" 가 함께 있으면: 둘 다 누락 없이 등록
  - 모듈에 "CON-B2" 와 "SN:210708-28" 이 함께 있으면: 둘 다 누락 없이 등록
  - 명판에 "S/N: 360025446" 이 있으면: 해당 번호 등록

[2. 비시리얼 하드웨어 기호 엄격 제외]
- 단자대 핀 배열 기호("CHANNEL", "OUTPUT", "FAULT", "01~20", "CON1", "AiN 1-6", "GND", "VS", "PWR", "CAN" 등)나 케이블 번호("SMP-24" 등), 전원 사양("24VDC", "5A" 등)은 시리얼 번호가 아니므로 절대 추출하지 마십시오.

[3. 엄격한 원문 복사 모드 (Strict Literal Transcribe Mode)]
- 임의 추론, 사전 단어 완성, 문맥적 철자 교정을 절대 하지 마십시오.
- 오직 이미지에 물리적으로 존재하는 획(Stroke)과 텍스트만을 100% 있는 그대로 전사하십시오.
- 하이픈(-), 콜론(:) 등의 구분 기호는 원본 형태를 정확히 보존하십시오.
- 'SN:', 'S/N:', 'WIN11 S/N:', 'PC S/N:' 등의 접두사는 value에서 제외하고 순수 번호만 담되, 라벨 정보는 label 필드에 기록하십시오.

[4. 회전 및 각도 자동 보정 (Orientation Invariance)]
- 이미지가 회전(90°/180°/270°)되었거나 비스듬히 기울어져 있어도 문자의 올바른 정방향을 스스로 감지하여 정상 순서대로 판독하십시오.

[5. Strict JSON 출력 스키마]
반드시 아래 JSON 형식으로만 응답하십시오:
{
  "raw_serial": "가장 대표적인 고유 일련번호(접두사 제외)",
  "serial_candidates": [
    { "label": "라벨 명칭(예: WIN11 S/N, PC S/N, SN, 모듈태그, 일련번호 등)", "value": "순수 번호" },
    { "label": "두 번째 라벨 명칭", "value": "두 번째 순수 번호" }
  ],
  "source_type": "label_or_plate",
  "model_name": "식별된 제품 모델명(예: IPC, CON, LabJack 등, 없으면 null)",
  "notes": null,
  "low_confidence_chars": []
}`;

/**
 * 시리얼 접두사(S/N:, SN:, PC S/N:, WIN11 S/N: 등)만 깔끔하게 제거하고 획 자체는 100% 무왜곡 보존
 */
export function cleanPrefixOnly(rawSerial: string): string {
  if (!rawSerial) return "";
  let cleaned = rawSerial.trim();
  // 접두사 제거
  cleaned = cleaned.replace(
    /^(?:WIN(?:11|10|7|8|DOWS)?\s*S[\/\\|\-.]?N|WIN(?:11|10|7|8|DOWS)?\s*KEY|WIN(?:11|10|7|8)?|PC\s*S[\/\\|\-.]?N|IPC\s*S[\/\\|\-.]?N|Production\s*S[\/\\|\-.]?N|Product\s*S[\/\\|\-.]?N|Prod\s*S[\/\\|\-.]?N|SERIAL\s*(?:NO\.?|#|NUMBER)?|SER\.?\s*NO\.?|S[\/\\|\-.]N|SN|S\.N\.|S\/NO\.?|NO\.?|N°|CON-[A-Z0-9]+\s*S[\/\\|\-.]?N|P\s*[\/\\|\-.]\s*N|PART\s*(?:NO\.?|NUMBER|#|CODE)?|ITEM\s*(?:NO\.?|#|NUMBER)|품\s*번|품목\s*번호|도\s*번|MAT\s*NO\.?|시리얼\s*넘버|시리얼\s*번호|시리얼|일련\s*번호|제조\s*번호|식별\s*번호|관리\s*번호)\s*[:.\-|=#\s]*/i,
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

  // 2. Gemini API 호출 (고화질 94% 무손실급 JPEG 직통 호출)
  const streamABase64 = canvas.toDataURL("image/jpeg", 0.94).split(",")[1];

  let parsed: any = null;

  if (apiKey) {
    onProgress?.(35, "🤖 Gemini Flash AI 정밀 시리얼 판독 중...");
    const modelCandidates = GEMINI_MODEL_CANDIDATES;
    const userText = `[대상 부품 정보]
- 품명: ${context?.partName || "-"}
- 규격: ${context?.spec || "-"}
- 세부사양: ${context?.subSpec || "-"}

[판독 필수 지침]
제공된 이미지에서 단자대 핀 기호(10UA, SGND, SPC, AIN0~3, FIO0~3, DAC0~1, CHANNEL, FAULT, CON1 등)나 케이블 번호, 제품 모델명(LabJack, U6-PRO, PRO 등)이 아닌, 노란색 라벨 스티커 위의 [고유 시리얼 번호]를 최우선으로 찾아내십시오.
★ 1. 'SN: 360025446', 'SN:360025446', 'S/N: 210708-28' 등 SN, S/N, SERIAL, SER 표기가 있는 경우: 접두사를 제외한 순수 고유 일련번호('360025446', '210708-28')를 무조건 압도적 1순위로 출력하십시오.
★ 2. 윈도우 키(WIN11 S/N)가 있을 경우: 5개 블록 총 25자리('XXXXX-XXXXX-XXXXX-XXXXX-XXXXX')를 1순위, PC S/N('KSA7706705')을 2순위로 등록하십시오.`;

    for (const model of modelCandidates) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
      try {
        // API 키는 URL 쿼리에 노출하지 않고 헤더(x-goog-api-key)로만 전달
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        const requestBody = {
          system_instruction: {
            parts: [{ text: GEMINI_SYSTEM_PROMPT }],
          },
          contents: [
            {
              parts: [
                { text: userText },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: streamABase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.0,
            responseMimeType: "application/json",
          },
        };

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        if (res.ok) {
          const jsonRes = await res.json();
          // thinking 모델은 사고(thought) 파트가 섞여 올 수 있으므로 thought 가 아닌 텍스트 파트만 합침
          const parts: any[] = jsonRes?.candidates?.[0]?.content?.parts || [];
          let rawContent: string = parts
            .filter((p) => typeof p?.text === "string" && !p?.thought)
            .map((p) => p.text)
            .join("");
          if (rawContent) {
            rawContent = rawContent.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
            parsed = JSON.parse(rawContent);
            console.log("✨ Gemini AI OCR 판독 성공:", parsed);
            break;
          }
        } else {
          const errText = await res.text();
          console.warn(`Gemini API [${model}] status ${res.status}:`, errText);
          // 키 오류/권한 오류는 다른 모델로 재시도해도 동일하므로 즉시 중단 (404는 모델 폐기이므로 다음 모델 시도)
          if (res.status === 401 || res.status === 403) {
            break;
          }
        }
      } catch (e) {
        console.warn(`Gemini API [${model}] fetch error:`, e);
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  if (parsed) {
    onProgress?.(85, "⚙️ 다중 시리얼 후보 정리 및 무왜곡 검증 완료...");

    const rawPrimary = parsed.raw_serial || parsed.serial_number_primary || parsed.best_serial || "";
    let literalSerial = cleanPrefixOnly(rawPrimary);

    // 1. 다중 후보(serial_candidates) 및 원문 정밀 수집
    const candidatesList: string[] = [];

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

    // 전체 JSON 응답에서 발견되는 유효 패턴들(윈도우키, 날짜-순번시리얼, PC시리얼, 모듈태그) 누락 방지 수집
    const fullJsonStr = JSON.stringify(parsed);
    const winMatch = fullJsonStr.match(/\b([A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5})\b/i);
    if (winMatch && !candidatesList.includes(winMatch[1].toUpperCase())) {
      candidatesList.push(winMatch[1].toUpperCase());
    }
    const dateMatch = fullJsonStr.match(/\b([0-9]{6}-[0-9]{1,4})\b/);
    if (dateMatch && !candidatesList.includes(dateMatch[1])) {
      candidatesList.push(dateMatch[1]);
    }
    const pcMatch = fullJsonStr.match(/\b(KSA[0-9]{6,10})\b/i);
    if (pcMatch && !candidatesList.includes(pcMatch[1].toUpperCase())) {
      candidatesList.push(pcMatch[1].toUpperCase());
    }
    const conMatch = fullJsonStr.match(/\b(CON-[A-Z0-9]+)\b/i);
    if (conMatch && !candidatesList.includes(conMatch[1].toUpperCase())) {
      candidatesList.push(conMatch[1].toUpperCase());
    }
    const snNumMatch = fullJsonStr.match(/(?:SN|S\/N|SERIAL)\s*[:.\-|=;#\s]*([0-9]{6,14})\b/i);
    if (snNumMatch && !candidatesList.includes(snNumMatch[1])) {
      candidatesList.push(snNumMatch[1]);
    }

    // 2. 특정 포맷을 편애하지 않고, 현재 작업자가 점검 중인 부품(targetPart) 컨텍스트에 맞게 자연스럽게 기본 선택
    const targetText = `${context?.partName || ""} ${context?.spec || ""} ${context?.subSpec || ""}`.toUpperCase();
    const isWindowsTarget = /WIN|WINDOWS|OS|라이선스|라이센스|SW|소프트웨어|KEY/i.test(targetText);
    const isPcTarget = /PC|IPC|본체|컴퓨터|산업용|HW|메인/i.test(targetText);

    if (isWindowsTarget) {
      const winKey = candidatesList.find((c) => /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(c));
      if (winKey) literalSerial = winKey;
    } else if (isPcTarget) {
      const pcSerial = candidatesList.find((c) => /^KSA[0-9]{6,10}$/i.test(c));
      if (pcSerial) literalSerial = pcSerial;
    }

    // 기본 시리얼을 맨 앞으로 정렬하되, 감지된 모든 후보 번호를 빠짐없이 보존
    if (literalSerial) {
      const others = candidatesList.filter((c) => c !== literalSerial);
      candidatesList.length = 0;
      candidatesList.push(literalSerial, ...others);
    } else if (candidatesList.length > 0) {
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

    const finalCandidates = candidatesList.slice(0, 5);
    const candidateDetails: OcrCandidateDetail[] = finalCandidates.map((cand) => {
      let sourceLabel = "SN";
      if (/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(cand)) {
        sourceLabel = "WIN11 S/N";
      } else if (/^KSA[0-9]{6,10}$/i.test(cand)) {
        sourceLabel = "PC S/N";
      } else if (/^[0-9]{6,14}$/.test(cand)) {
        sourceLabel = "SN";
      } else if (cand.includes("-")) {
        sourceLabel = "S/N";
      }
      return {
        serial: cand,
        sourceLabel,
      };
    });

    const detectedLabel = candidateDetails[0]?.sourceLabel || "SN";

    return {
      rawText: JSON.stringify(parsed, null, 2),
      cleanedSerial: literalSerial,
      confidence: confidenceNumeric,
      lines,
      candidates: finalCandidates,
      candidateDetails,
      detectedLabel,
    };
  }

  // 3. API Key 미등록 또는 네트워크 실패 시: 로컬 Tesseract 5 + Barcode 엔진으로 100% 무중단 페일오버
  onProgress?.(60, "⚡ 고정밀 로컬 광학 OCR 및 분산 텍스트 분석 중...");
  return await performInMemoryOcr(canvas, onProgress, context);
}

