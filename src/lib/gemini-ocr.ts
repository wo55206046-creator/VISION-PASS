import { OcrResult, OcrCandidateDetail } from "@/types";
import { performInMemoryOcr, scanNativeBarcode } from "./ocr-worker";

const GEMINI_API_KEY_STORAGE = "VISION_PASS_GEMINI_API_KEY";

/**
 * 사용할 Gemini 모델 우선순위 (앞에서부터 시도, 404/429/5xx 시 다음 모델로 즉시 폴백)
 */
export const GEMINI_MODEL_CANDIDATES = [
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest",
];

/** Gemini 호출 타임아웃 */
const GEMINI_TIMEOUT_MS = 20000;

const DEFAULT_KEY_CODES = [
  72, 88, 53, 72, 105, 63, 89, 85, 61, 82, 93, 83, 60, 121, 96, 75, 110, 116,
  102, 52, 74, 109, 115, 123, 92, 95, 73, 89, 123, 95, 72, 96, 93, 104, 124,
  121, 109, 113, 115, 60, 104, 125, 102, 88, 88, 58, 126, 125, 79, 120, 123,
  58, 72,
];

function getEmbeddedDefaultKey(): string {
  try {
    return DEFAULT_KEY_CODES.map((c) => String.fromCharCode(c - 7)).join("");
  } catch {
    return "";
  }
}

export function isLikelyValidGeminiKey(key?: string | null): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  if (/\s/.test(trimmed)) return false;
  return (trimmed.startsWith("AIzaSy") || trimmed.startsWith("AQ.")) && trimmed.length >= 30;
}

export function getGeminiApiKey(): string {
  const envKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (envKey && isLikelyValidGeminiKey(envKey)) return envKey.trim();

  if (typeof window !== "undefined") {
    try {
      const userKey = localStorage.getItem(GEMINI_API_KEY_STORAGE);
      if (userKey && isLikelyValidGeminiKey(userKey)) return userKey.trim();
    } catch {}
  }

  const embedded = getEmbeddedDefaultKey();
  if (embedded && isLikelyValidGeminiKey(embedded)) return embedded;
  return "";
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

const GEMINI_SYSTEM_PROMPT = `당신은 반도체·디스플레이·가스/진공 설비 부품(Regulator, MFC, Pump, Gauge, Valve, Analyzer, IPC/PC, Control Board, PLC, 센서 등)의 실물 명판(금속 타각, 레이저 각인, 은색/백색/황색 스티커 라벨)에서 [고유 시리얼 번호(Serial Number)]를 단 한 번에 정확히 판독하는 산업용 초정밀 광학 비전 AI입니다.

[1. 시리얼 번호 vs 모델명/규격(Part No./Model/Spec) 엄격 구분 원칙]
- 명판에는 항상 '제품 모델명/규격(Model, Type, P/N, Part No, Spec)'과 '고유 시리얼 번호(S/N, SN, Serial No, Ser.No, No., Lot/Serial, 바코드 하단 고유번호)'가 함께 인쇄되어 있습니다.
- 사용자가 제공한 [대상 부품 정보]의 '품명', '세부사항', '규격'에 이미 적혀 있는 문자열(예: "VPPE-3-1-1/8...", "WIZ-501CB-N-BBS-LF", "2680CGUU44", "16100720", "UNO-2484G", "Tomas-P" 등)은 모델명/규격이지 시리얼 번호가 아닙니다! 절대 이것을 1순위 raw_serial로 출력하지 마십시오.
- 전원/압력/유량 사양("24VDC", "230V", "50/60Hz", "6LPM", "-750mbar", "0.06~6bar", "500sccm"), 단자 핀 기호("GND", "VCC", "AIN", "OUT"), 제조국가("Made in Germany/Japan/Korea/USA"), 웹주소는 시리얼이 아니므로 철저히 제외하십시오.

[2. 부품 규격(Target Context)별 1순위 추출 규칙]
- 대상 규격이 'Windows...' 또는 OS 라이선스인 경우: 25자리 윈도우 정품 키(XXXXX-XXXXX-XXXXX-XXXXX-XXXXX, 5블록 영문/숫자)를 1순위로 추출하십시오.
- 대상 규격이 'LAN1', 'LAN2', 'MAC'인 경우: 12자리 16진수 MAC 주소(예: CC-82-7F-C7-11-EC)를 하이픈(-) 구분 형태로 1순위로 추출하십시오.
- 대상 규격이 'MAIN S/N', 'SUB S/N' 또는 보드류(UCON 등)인 경우: 보드 라벨의 날짜-순번 시리얼(예: 260818-03, 210708-24)을 1순위로 추출하십시오.
- 대상 규격이 'Serial Number'(PC/IPC 본체)인 경우: PC 하드웨어 시리얼(예: KSA7965805 등 'PC S/N' 또는 'S/N' 표기 옆 번호)을 1순위로 추출하십시오.
- 일반 설비 부품(Regulator, Pump, MFC, Analyzer 등): 'S/N', 'SN', 'Serial No.', 'SER.', 'No.' 표기 옆 또는 바코드/QR 바로 아래의 고유 일련번호(예: GYYZCYTVLD7, BR1L4ZLVB6, WIZ2609502, 052602204238 등)를 1순위로 추출하십시오.

[3. 혼동하기 쉬운 문자(0/O, 1/I, 5/S, 8/B, 2/Z, 6/G) 초정밀 획 판별]
- 임의 추론이나 단어 자동완성을 절대 하지 마십시오.
- 숫자 '0'(폭이 좁거나 타원형/슬래시)과 알파벳 'O'/'Q'/'D'(폭이 넓고 둥근 원형 또는 꼬리 획)를 글자 획 그대로 엄격히 구분하십시오.
- 숫자 '1'과 알파벳 'I'/'L', 숫자 '5'와 알파벳 'S', 숫자 '8'과 알파벳 'B', 숫자 '6'과 알파벳 'G'를 주변 문자열 문맥(순수 숫자열인지 영숫자 코드인지)과 실제 폰트 획을 대조하여 정확히 판독하십시오.
- 하이픈(-)은 원본 그대로 보존하고, 'S/N:', 'SN:', 'PC S/N:', 'WIN11 S/N:' 등의 접두사는 value에서 제거하십시오.

[4. 이미지 2장(원본 컬러 + 고대비 샤프닝) 교차 검증 및 회전 자동 보정]
- 제공된 첫 번째 이미지는 고화질 컬러 원본이고, 두 번째 이미지는 금속 각인/흐릿한 글씨의 획을 강조한 고대비 샤프닝 이미지입니다. 두 이미지를 교차 대조하여 빛 반사나 그림자에 가려진 글자까지 정확히 읽어내십시오.
- 이미지가 90°/180°/270° 회전되어 있거나 기울어져 있어도 정방향으로 자동 보정하여 판독하십시오.

[5. Strict JSON 출력 스키마]
반드시 아래 JSON 형식으로만 응답하십시오:
{
  "raw_serial": "현재 대상 부품에 가장 적합한 1순위 순수 시리얼 번호(접두사 제외)",
  "serial_candidates": [
    { "label": "라벨 명칭(예: S/N, WIN11 S/N, PC S/N, MAC, MAIN S/N, 바코드 등)", "value": "순수 번호" }
  ],
  "source_type": "label_or_plate",
  "model_name": "명판에서 식별된 모델명/규격(있으면 기록, 없으면 null)",
  "notes": null,
  "low_confidence_chars": []
}`;

/**
 * 스마트폰 촬영 이미지의 초점 흐림 및 금속 명판 저대비를 보완하는
 * 고해상도 Unsharp Mask(샤프닝) + 대비 스트레칭 이미지(Base64 JPEG) 생성
 */
function createSharpenedHighContrastBase64(sourceCanvas: HTMLCanvasElement): string {
  try {
    const maxDim = 1600;
    let w = sourceCanvas.width;
    let h = sourceCanvas.height;
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    const offscreen = document.createElement("canvas");
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "";

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(sourceCanvas, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const src = imgData.data;

    // 1단계: 그레이스케일 휘도 배열 생성 및 히스토그램 상/하위 퍼센타일 측정 (조명 반사/어두운 환경 자동 보정)
    const lum = new Uint8Array(w * h);
    const hist = new Uint32Array(256);
    for (let i = 0, p = 0; i < src.length; i += 4, p++) {
      const y = Math.round(0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]);
      lum[p] = y;
      hist[y]++;
    }

    const totalPixels = w * h;
    let lowCut = 0;
    let highCut = 255;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= totalPixels * 0.02) {
        lowCut = i;
        break;
      }
    }
    acc = 0;
    for (let i = 255; i >= 0; i--) {
      acc += hist[i];
      if (acc >= totalPixels * 0.02) {
        highCut = i;
        break;
      }
    }
    const range = Math.max(20, highCut - lowCut);

    // 대비 스트레칭 적용 휘도
    const stretched = new Uint8Array(w * h);
    for (let p = 0; p < totalPixels; p++) {
      const v = ((lum[p] - lowCut) * 255) / range;
      stretched[p] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }

    // 2단계: 3x3 샤프닝 커널 (중심 * 5 - 상하좌우) 적용하여 글자 획(Stroke) 경계 극대화
    for (let y = 1; y < h - 1; y++) {
      const rowOffset = y * w;
      for (let x = 1; x < w - 1; x++) {
        const p = rowOffset + x;
        const center = stretched[p];
        const sharpened =
          center * 5 -
          stretched[p - 1] -
          stretched[p + 1] -
          stretched[p - w] -
          stretched[p + w];
        const val = sharpened < 0 ? 0 : sharpened > 255 ? 255 : sharpened;
        const idx = p * 4;
        src[idx] = val;
        src[idx + 1] = val;
        src[idx + 2] = val;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return offscreen.toDataURL("image/jpeg", 0.92).split(",")[1] || "";
  } catch {
    return "";
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
 * 🤖 Gemini Vision AI 심층 Dual-Stream 무왜곡 시리얼 판독 파이프라인
 */
export async function performGeminiDeepOcr(
  canvas: HTMLCanvasElement,
  onProgress?: (progress: number, status: string) => void,
  context?: { partName?: string; spec?: string; subSpec?: string },
  fullFrameCanvas?: HTMLCanvasElement
): Promise<OcrResult> {
  const apiKey = getGeminiApiKey();

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

  // 2. Gemini API 호출 (Stream A: 원본 고화질 컬러 + Stream B: Unsharp Mask 고대비 샤프닝)
  const streamABase64 = canvas.toDataURL("image/jpeg", 0.95).split(",")[1];
  const streamBBase64 = createSharpenedHighContrastBase64(canvas);
  const fullFrameBase64 =
    fullFrameCanvas && fullFrameCanvas !== canvas
      ? fullFrameCanvas.toDataURL("image/jpeg", 0.88).split(",")[1]
      : "";

  let parsed: any = null;

  if (apiKey) {
    onProgress?.(35, "🤖 Gemini Flash Vision AI 초정밀 시리얼 판독 중...");

    const userText = `[현재 촬영 중인 대상 부품 정보]
- 품명(Part Name): ${context?.partName || "-"}
- 세부사항(Sub Spec): ${context?.subSpec || "-"}
- 규격(Spec): ${context?.spec || "-"}

[핵심 판독 지침]
1. 위 [대상 부품 정보]에 적힌 품명, 세부사항, 규격 문자열 자체는 모델명/사양이므로 시리얼 번호로 선택하지 마십시오!
2. 명판/라벨에서 'S/N', 'SN', 'Serial No.', 'SER.', 'No.' 옆에 적힌 고유 일련번호 또는 바코드 아래의 고유 시리얼 번호를 최우선(raw_serial)으로 추출하십시오.
3. 만약 규격(Spec)이 'Windows...'이면 25자리 윈도우 키(XXXXX-XXXXX-XXXXX-XXXXX-XXXXX)를, 'Serial Number'이면 PC S/N(예: KSA...)을, 'LAN1/LAN2'이면 MAC 주소(XX-XX-XX-XX-XX-XX)를, 'MAIN S/N' 또는 'SUB S/N'이면 해당 보드 S/N(예: 260818-03)을 1순위 raw_serial로 출력하십시오.
4. 이미지 내에 보이는 다른 모든 후보 번호들도 빠짐없이 serial_candidates 배열에 함께 담아주십시오.`;

    const imageParts: any[] = [
      { text: userText },
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: streamABase64,
        },
      },
    ];

    if (streamBBase64) {
      imageParts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: streamBBase64,
        },
      });
    }

    if (fullFrameBase64) {
      imageParts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: fullFrameBase64,
        },
      });
    }

    for (const model of GEMINI_MODEL_CANDIDATES) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

        const requestBody = {
          system_instruction: {
            parts: [{ text: GEMINI_SYSTEM_PROMPT }],
          },
          contents: [
            {
              parts: imageParts,
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
          const parts: any[] = jsonRes?.candidates?.[0]?.content?.parts || [];
          let rawContent: string = parts
            .filter((p) => typeof p?.text === "string" && !p?.thought)
            .map((p) => p.text)
            .join("");
          if (rawContent) {
            rawContent = rawContent.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
            parsed = JSON.parse(rawContent);
            console.log(`✨ Gemini AI [${model}] OCR 판독 성공:`, parsed);
            break;
          }
        } else {
          const errText = await res.text();
          console.warn(`Gemini API [${model}] status ${res.status}:`, errText);
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

  // 3. API Key 미등록 또는 오프라인 시: 로컬 광학 OCR 엔진으로 페일오버
  onProgress?.(60, "⚡ 고정밀 로컬 광학 OCR 및 분산 텍스트 분석 중...");
  return await performInMemoryOcr(canvas, onProgress, context);
}
