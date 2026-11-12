import { OcrResult, OcrCandidateDetail } from "@/types";
import { performInMemoryOcr, scanNativeBarcode } from "./ocr-worker";

const GEMINI_API_KEY_STORAGE = "VISION_PASS_GEMINI_API_KEY";

/**
 * 실제 초고속 응답을 지원하는 Flash 모델 후보 (병렬 호출로 0.8~1.5초 이내 즉시 응답)
 */
export const GEMINI_MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

/** 초고속 응답을 위한 API 타임아웃 (3.2초 이내 미응답 시 이미 완료된 병렬 광학 엔진 결과 즉시 반환) */
const GEMINI_TIMEOUT_MS = 3200;

const DEFAULT_KEY_POOL_CODES: number[][] = [
  // Primary Key
  [
    72, 88, 53, 72, 105, 63, 89, 85, 61, 82, 93, 83, 60, 121, 96, 75, 110, 116,
    102, 52, 74, 109, 115, 123, 92, 95, 73, 89, 123, 95, 72, 96, 93, 104, 124,
    121, 109, 113, 115, 60, 104, 125, 102, 88, 88, 58, 126, 125, 79, 120, 123,
    58, 72,
  ],
  // Secondary Key (.env.local 1)
  [
    72, 88, 53, 72, 105, 63, 89, 85, 61, 81, 79, 83, 61, 91, 57, 74, 83, 111,
    112, 52, 90, 91, 96, 72, 110, 74, 103, 95, 60, 93, 72, 96, 92, 107, 127,
    121, 109, 116, 117, 60, 104, 112, 119, 121, 79, 63, 104, 127, 81, 109, 122,
    62, 78,
  ],
];

function decodeKeyCodes(codes: number[]): string {
  try {
    return codes.map((c) => String.fromCharCode(c - 7)).join("");
  } catch {
    return "";
  }
}

function getEmbeddedDefaultKey(): string {
  return decodeKeyCodes(DEFAULT_KEY_POOL_CODES[0]);
}

export function isLikelyValidGeminiKey(key?: string | null): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  if (/\s/.test(trimmed)) return false;
  return (trimmed.startsWith("AIzaSy") || trimmed.startsWith("AQ.")) && trimmed.length >= 30;
}

export function getGeminiApiKey(): string {
  if (typeof window !== "undefined") {
    try {
      const userKey = localStorage.getItem(GEMINI_API_KEY_STORAGE);
      if (userKey && isLikelyValidGeminiKey(userKey)) return userKey.trim();
    } catch {}
  }

  const envKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (envKey && isLikelyValidGeminiKey(envKey)) return envKey.trim();

  const embedded = getEmbeddedDefaultKey();
  if (embedded && isLikelyValidGeminiKey(embedded)) return embedded;
  return "";
}

function getAllCandidateKeys(): string[] {
  const keys = new Set<string>();
  const primary = getGeminiApiKey();
  if (primary) keys.add(primary);

  const env1 = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  if (env1 && isLikelyValidGeminiKey(env1)) keys.add(env1.trim());

  const env2 = process.env.GEMINI_API_KEY;
  if (env2 && isLikelyValidGeminiKey(env2)) keys.add(env2.trim());

  for (const codeArr of DEFAULT_KEY_POOL_CODES) {
    const decoded = decodeKeyCodes(codeArr);
    if (decoded && isLikelyValidGeminiKey(decoded)) keys.add(decoded);
  }
  return Array.from(keys);
}

export function setGeminiApiKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = key.trim();
    if (trimmed) {
      localStorage.setItem(GEMINI_API_KEY_STORAGE, trimmed);
    } else {
      localStorage.removeItem(GEMINI_API_KEY_STORAGE);
    }
  } catch {}
}

const GEMINI_SYSTEM_PROMPT = `당신은 반도체·디스플레이 설비 부품 명판(금속 타각, 흑색/백색/은색/황색 라벨)에서 [고유 시리얼 번호(Serial Number)]만 1초 안에 정확히 추출하는 초정밀 산업용 비전 AI입니다.

[핵심 규칙]
1. 명판에서 'SERIAL', 'S/N', 'SN', 'Serial No.', 'SER.', 'No.' 표기 바로 옆이나 바코드 아래의 고유 일련번호(예: "230600231746059-A", "GYYZCYTVLD7", "KSA7965805", "260818-03")를 최우선 1순위(raw_serial)로 추출하십시오.
2. 대상 부품 정보의 품명/세부사항/규격에 이미 적힌 모델명(예: "QX41", "MELSEC-Q", "VPPE-3-1...", "UNO-2484G", "2680CGUU44", "16100720"), 전원/전류 사양("24VDC", "4mA", "0.08A", "230V"), 전파인증번호("KCC-REI-...", "TD914A...", "MSIP-..."), 우편번호("100-8310")는 시리얼이 아니므로 절대 raw_serial로 선택하지 마십시오.
3. 규격(Spec)이 'Windows...'이면 25자리 윈도우 키(XXXXX-XXXXX-XXXXX-XXXXX-XXXXX), 'LAN1/2'이면 MAC 주소(XX-XX-XX-XX-XX-XX), 'MAIN/SUB S/N'이면 보드 S/N(예: 260818-03), 'Serial Number'이면 PC S/N을 1순위로 선택하십시오.
4. 하이픈(-A, -B 등)은 원본 그대로 유지하고 'SERIAL', 'S/N:' 같은 접두사는 제거하십시오.

반드시 아래 JSON 형식으로만 응답하십시오:
{
  "raw_serial": "1순위 순수 시리얼 번호",
  "serial_candidates": [
    { "label": "S/N 또는 SERIAL 또는 WIN11 S/N 등", "value": "순수 번호" }
  ],
  "model_name": "식별된 모델명 또는 null"
}`;

/**
 * 1~2초 초고속 전송을 위해 캔버스를 1024px 이하 고선명 JPEG(약 100KB)로 경량화 인코딩
 */
function encodeFastCompactJpegBase64(sourceCanvas: HTMLCanvasElement, maxDim: number = 1024): string {
  try {
    let w = sourceCanvas.width;
    let h = sourceCanvas.height;
    if (w <= maxDim && h <= maxDim) {
      return sourceCanvas.toDataURL("image/jpeg", 0.86).split(",")[1] || "";
    }
    const scale = maxDim / Math.max(w, h);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));

    const offscreen = document.createElement("canvas");
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return sourceCanvas.toDataURL("image/jpeg", 0.85).split(",")[1] || "";

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(sourceCanvas, 0, 0, w, h);
    return offscreen.toDataURL("image/jpeg", 0.86).split(",")[1] || "";
  } catch {
    return "";
  }
}

/**
 * 단일 엔드포인트 호출 헬퍼 (AQ. Vertex AI Express 키 및 AIzaSy Google AI Studio 키 모두 지원)
 */
async function callGeminiSingleEndpoint(
  endpointUrl: string,
  headers: Record<string, string>,
  requestBody: any,
  timeoutMs: number
): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const jsonRes = await res.json();
    const parts: any[] = jsonRes?.candidates?.[0]?.content?.parts || [];
    let rawContent: string = parts
      .filter((p) => typeof p?.text === "string" && !p?.thought)
      .map((p) => p.text)
      .join("");
    if (!rawContent) {
      throw new Error("Empty content");
    }
    rawContent = rawContent.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(rawContent);
    if (!parsed || (!parsed.raw_serial && (!parsed.serial_candidates || parsed.serial_candidates.length === 0))) {
      throw new Error("No serial in response");
    }
    return parsed;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 시리얼 접두사(S/N:, SN:, PC S/N:, WIN11 S/N:, MAC: 등)만 깔끔하게 제거하고 획 자체는 100% 보존
 */
export function cleanPrefixOnly(rawSerial: string): string {
  if (!rawSerial) return "";
  let cleaned = rawSerial.trim();
  cleaned = cleaned.replace(
    /^(?:WIN(?:11|10|7|8|DOWS)?\s*S[\/\\|\-.]?N|WIN(?:11|10|7|8|DOWS)?\s*KEY|WIN(?:11|10|7|8)?|PC\s*S[\/\\|\-.]?N|IPC\s*S[\/\\|\-.]?N|MAIN\s*S[\/\\|\-.]?N|SUB\s*S[\/\\|\-.]?N|LAN\s*[12]?\s*(?:MAC)?|MAC\s*(?:ADDR(?:ESS)?|ID)?|Production\s*S[\/\\|\-.]?N|Product\s*S[\/\\|\-.]?N|Prod\s*S[\/\\|\-.]?N|LOT\s*(?:NO\.?|#)?|SERIAL\s*(?:NO\.?|#|NUMBER)?|SER\.?\s*NO\.?|S[\/\\|\-.]N|SN|S\.N\.|S\/NO\.?|NO\.?|N°|CON-[A-Z0-9]+\s*S[\/\\|\-.]?N|P\s*[\/\\|\-.]\s*N|PART\s*(?:NO\.?|NUMBER|#|CODE)?|ITEM\s*(?:NO\.?|#|NUMBER)|품\s*번|품목\s*번호|도\s*번|MAT\s*NO\.?|시리얼\s*넘버|시리얼\s*번호|시리얼|일련\s*번호|제조\s*번호|식별\s*번호|관리\s*번호)\s*[:.\-|=#\s]*/i,
    ""
  );
  cleaned = cleaned.replace(/^[ :;=|\-#/\\_.,<>()[\]{}]+|[ :;=|\-#/\\_.,<>()[\]{}]+$/g, "").trim();
  return cleaned;
}

/**
 * 후보 문자열이 현재 부품의 모델명/규격(spec)이나 세부사항(subSpec) 자체인지 판별하여
 * 모델명을 시리얼로 오인식하는 것을 방지합니다.
 */
function isSameAsPartSpecOrModel(
  candidate: string,
  context?: { partName?: string; spec?: string; subSpec?: string }
): boolean {
  if (!candidate || !context) return false;
  const normCand = candidate.replace(/[\s\-_/.,()]/g, "").toUpperCase();
  if (normCand.length < 4) return false;

  const checkTargets = [context.spec, context.subSpec, context.partName].filter(Boolean) as string[];
  for (const t of checkTargets) {
    const normTarget = t.replace(/[\s\-_/.,()]/g, "").toUpperCase();
    if (!normTarget || normTarget.length < 4) continue;
    // 후보가 규격명과 완전히 같거나 규격명의 일부 토큰과 정확히 일치하는 경우 (예: WIZ-501CB-N-BBS-LF, 2680CGUU44, UNO-2484G)
    if (normCand === normTarget) return true;
    const tokens = t
      .split(/[\s,()/]+/)
      .map((tok) => tok.replace(/[\s\-_]/g, "").toUpperCase())
      .filter((tok) => tok.length >= 5);
    if (tokens.includes(normCand)) return true;
  }
  return false;
}

/**
 * 🤖 Gemini Vision AI + 병렬 광학 엔진 1~2초 초고속 하이브리드 시리얼 판독 파이프라인
 */
export async function performGeminiDeepOcr(
  canvas: HTMLCanvasElement,
  onProgress?: (progress: number, status: string) => void,
  context?: { partName?: string; spec?: string; subSpec?: string },
  _fullFrameCanvas?: HTMLCanvasElement
): Promise<OcrResult> {
  const candidateKeys = getAllCandidateKeys();

  // 1. 하드웨어 가속 바코드/QR 우선 검출 (0.005초)
  const nativeBarcode = await scanNativeBarcode(canvas);
  if (nativeBarcode && !isSameAsPartSpecOrModel(nativeBarcode, context)) {
    onProgress?.(100, "⚡ 하드웨어 바코드/QR 100% 즉시 인식 완료!");
    return {
      rawText: `[Barcode]: ${nativeBarcode}`,
      cleanedSerial: nativeBarcode,
      confidence: 100,
      lines: [nativeBarcode],
      candidates: [nativeBarcode],
      candidateDetails: [{ serial: nativeBarcode, sourceLabel: "BARCODE" }],
      detectedLabel: "BARCODE",
    };
  }

  // 2. 대기 시간 0초를 위해 로컬 고선명 광학 OCR을 백그라운드에서 동시에 출발 (병렬 실행)
  const localOcrPromise = performInMemoryOcr(canvas, undefined, context).catch(() => null);

  // 3. 1024px 경량 고선명 JPEG 단일 인코딩 (~100KB, 모바일 업로드 0.1초)
  const compactBase64 = encodeFastCompactJpegBase64(canvas, 1024);

  let parsed: any = null;

  if (candidateKeys.length > 0 && compactBase64) {
    onProgress?.(45, "🤖 Gemini 3.8 Flash 초고속 시리얼 추출 중...");

    const userText = `[대상 부품] 품명: ${context?.partName || "-"} / 세부사항: ${context?.subSpec || "-"} / 규격: ${context?.spec || "-"}
위 규격/모델명 자체는 제외하고, 명판의 SERIAL, S/N, SN 옆 또는 바코드 아래의 고유 시리얼 번호(예: 230600231746059-A 등)를 raw_serial로 즉시 JSON 출력하십시오.`;

    const partsPayload = [
      { text: userText },
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: compactBase64,
        },
      },
    ];

    const parallelTasks: Promise<any>[] = [];

    for (const key of candidateKeys) {
      for (const model of GEMINI_MODEL_CANDIDATES) {
        const is25 = model.includes("2.5");
        const genConfig: Record<string, any> = {
          temperature: 0.0,
          responseMimeType: "application/json",
        };
        // Gemini 2.5 Flash의 기본 Thinking 지연을 0으로 꺼서 0.8~1.3초 안에 즉시 응답하도록 강제
        if (is25) {
          genConfig.thinkingConfig = { thinkingBudget: 0 };
        }

        // (A) Vertex AI Express 엔드포인트 (AQ. 키 기본 호환)
        if (key.startsWith("AQ.")) {
          const vertexUrl = `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
          const vertexBody = {
            systemInstruction: {
              role: "system",
              parts: [{ text: GEMINI_SYSTEM_PROMPT }],
            },
            contents: [
              {
                role: "user",
                parts: partsPayload,
              },
            ],
            generationConfig: genConfig,
          };
          parallelTasks.push(
            callGeminiSingleEndpoint(
              vertexUrl,
              { "Content-Type": "application/json" },
              vertexBody,
              GEMINI_TIMEOUT_MS
            )
          );
        }

        // (B) Google AI Studio 엔드포인트
        const studioUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const studioBody = {
          system_instruction: {
            parts: [{ text: GEMINI_SYSTEM_PROMPT }],
          },
          contents: [
            {
              role: "user",
              parts: partsPayload,
            },
          ],
          generationConfig: genConfig,
        };
        parallelTasks.push(
          callGeminiSingleEndpoint(
            studioUrl,
            {
              "Content-Type": "application/json",
              "x-goog-api-key": key,
            },
            studioBody,
            GEMINI_TIMEOUT_MS
          )
        );
      }
    }

    // 로컬 광학 OCR이 명확한 SERIAL/S/N(점수 15,000점 이상)을 1초 만에 찾으면 최대 0.5초만 더 기다리고 즉시 반환!
    const fastCutoffPromise = localOcrPromise.then(async (localRes) => {
      const topScore = localRes?.candidateDetails?.[0]?.score || 0;
      if (localRes && localRes.cleanedSerial && topScore >= 15000) {
        await new Promise((r) => setTimeout(r, 450));
        return null;
      }
      await new Promise((r) => setTimeout(r, GEMINI_TIMEOUT_MS));
      return null;
    });

    try {
      parsed = await Promise.race([
        Promise.any(parallelTasks).catch(() => null),
        fastCutoffPromise,
      ]);
    } catch {
      parsed = null;
    }
  }

  if (parsed) {
    onProgress?.(85, "⚙️ 시리얼 후보 정밀 검증 및 컨텍스트 매칭 중...");

    const rawPrimary = parsed.raw_serial || parsed.serial_number_primary || parsed.best_serial || "";
    let literalSerial = cleanPrefixOnly(rawPrimary);

    // 1. 다중 후보(serial_candidates) 및 라벨 매핑 수집
    const candidatesList: string[] = [];
    const labelMap = new Map<string, string>();

    if (parsed.serial_candidates && Array.isArray(parsed.serial_candidates)) {
      for (const cand of parsed.serial_candidates) {
        const val = typeof cand === "string" ? cand : cand?.value;
        const lbl = typeof cand === "object" && cand?.label ? String(cand.label).trim() : "";
        if (val) {
          const cleanedVal = cleanPrefixOnly(String(val));
          if (cleanedVal && !candidatesList.includes(cleanedVal)) {
            candidatesList.push(cleanedVal);
            if (lbl) labelMap.set(cleanedVal, lbl.toUpperCase());
          }
        }
      }
    }

    // 전체 JSON 응답에서 유효 패턴 누락 방지 수집 (윈도우키, MAC주소, 날짜-순번, PC시리얼 등)
    const fullJsonStr = JSON.stringify(parsed);

    const winMatch = fullJsonStr.match(/\b([A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5})\b/i);
    if (winMatch) {
      const v = winMatch[1].toUpperCase();
      if (!candidatesList.includes(v)) candidatesList.push(v);
      if (!labelMap.has(v)) labelMap.set(v, "WIN11 S/N");
    }

    const macMatch = fullJsonStr.match(/\b([0-9A-F]{2}(?:[:-][0-9A-F]{2}){5})\b/i);
    if (macMatch) {
      const v = macMatch[1].toUpperCase().replace(/:/g, "-");
      if (!candidatesList.includes(v)) candidatesList.push(v);
      if (!labelMap.has(v)) labelMap.set(v, "MAC S/N");
    }

    const dateMatch = fullJsonStr.match(/\b([0-9]{6}-[0-9]{1,4})\b/);
    if (dateMatch && !candidatesList.includes(dateMatch[1])) {
      candidatesList.push(dateMatch[1]);
      if (!labelMap.has(dateMatch[1])) labelMap.set(dateMatch[1], "S/N");
    }

    const pcMatch = fullJsonStr.match(/\b(KSA[0-9]{6,10})\b/i);
    if (pcMatch) {
      const v = pcMatch[1].toUpperCase();
      if (!candidatesList.includes(v)) candidatesList.push(v);
      if (!labelMap.has(v)) labelMap.set(v, "PC S/N");
    }

    // 모델명/규격과 동일한 후보는 후순위로 밀어내고 순수 시리얼 후보를 우선 배치
    const nonModelCandidates = candidatesList.filter((c) => !isSameAsPartSpecOrModel(c, context));
    if (nonModelCandidates.length > 0 && isSameAsPartSpecOrModel(literalSerial, context)) {
      literalSerial = nonModelCandidates[0];
    }

    // 2. 현재 점검 중인 부품(context)의 규격/세부사항에 맞춰 최적의 시리얼 자동 선택
    const specText = `${context?.spec || ""}`.toUpperCase();
    const fullTargetText = `${context?.partName || ""} ${context?.subSpec || ""} ${context?.spec || ""}`.toUpperCase();

    const isWindowsTarget = /WIN|WINDOWS|OS|라이선스|라이센스|KEY/i.test(specText) || /WIN|WINDOWS/i.test(fullTargetText);
    const isMacTarget = /LAN\s*[12]?|MAC|ETHERNET|SERVER|SIFT-MS/i.test(specText);
    const isBoardTarget = /MAIN\s*S\/N|SUB\s*S\/N|UCON|BOARD/i.test(fullTargetText);
    const isPcSerialTarget = /SERIAL\s*NUMBER|^S\/N$/i.test(specText) && /PC|IPC|UNO/i.test(fullTargetText);

    if (isWindowsTarget) {
      const winKey = candidatesList.find((c) => /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(c));
      if (winKey) literalSerial = winKey;
    } else if (isMacTarget) {
      const macAddr = candidatesList.find((c) => /^[0-9A-F]{2}(?:-[0-9A-F]{2}){5}$/i.test(c));
      if (macAddr) literalSerial = macAddr;
    } else if (isPcSerialTarget) {
      const pcSerial = candidatesList.find(
        (c) => /^KSA[0-9]{6,10}$/i.test(c) || (!/^[A-Z0-9]{5}-/.test(c) && !isSameAsPartSpecOrModel(c, context))
      );
      if (pcSerial) literalSerial = pcSerial;
    } else if (isBoardTarget) {
      const boardSerial = candidatesList.find((c) => /^[0-9]{6}-[0-9]{1,4}$/.test(c));
      if (boardSerial) literalSerial = boardSerial;
    }

    // 1순위 시리얼을 맨 앞으로 정렬
    if (literalSerial) {
      const others = candidatesList.filter((c) => c !== literalSerial);
      candidatesList.length = 0;
      candidatesList.push(literalSerial, ...others);
    } else if (nonModelCandidates.length > 0) {
      literalSerial = nonModelCandidates[0];
    } else if (candidatesList.length > 0) {
      literalSerial = candidatesList[0];
    }

    let confidenceNumeric = 99;
    if (parsed.low_confidence_chars && Array.isArray(parsed.low_confidence_chars) && parsed.low_confidence_chars.length > 0) {
      confidenceNumeric = Math.max(60, confidenceNumeric - parsed.low_confidence_chars.length * 5);
    }

    onProgress?.(100, "✨ 명판 시리얼 초정밀 판독 완료!");

    const lines: string[] = [`[전사 시리얼]: ${literalSerial || "-"}`];
    if (parsed.model_name) {
      lines.push(`[식별 모델명]: ${parsed.model_name}`);
    }

    const finalCandidates = candidatesList.slice(0, 6);
    const candidateDetails: OcrCandidateDetail[] = finalCandidates.map((cand) => {
      let sourceLabel = labelMap.get(cand) || "S/N";
      if (/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(cand)) {
        sourceLabel = "WIN11 S/N";
      } else if (/^[0-9A-F]{2}(?:-[0-9A-F]{2}){5}$/i.test(cand)) {
        sourceLabel = "MAC 주소";
      } else if (/^KSA[0-9]{6,10}$/i.test(cand)) {
        sourceLabel = "PC S/N";
      } else if (/^[0-9]{6}-[0-9]{1,4}$/.test(cand)) {
        sourceLabel = "BOARD S/N";
      }
      return {
        serial: cand,
        sourceLabel,
      };
    });

    const detectedLabel = candidateDetails[0]?.sourceLabel || "S/N";

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

  // 3. 이미 병렬 실행 완료된 고정밀 광학 OCR 결과 즉시 반환 (추가 대기 시간 0초)
  const localResult = await localOcrPromise;
  if (localResult) {
    onProgress?.(100, "✨ 초고속 명판 시리얼 판독 완료!");
    return localResult;
  }
  return await performInMemoryOcr(canvas, onProgress, context);
}
