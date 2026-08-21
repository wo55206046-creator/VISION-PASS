import { createWorker, Worker } from "tesseract.js";
import { OcrResult } from "@/types";

let cachedWorker: Worker | null = null;
let isInitializing = false;

/**
 * Tesseract.js Worker 초기화 (싱글톤 & 고정밀 산업용 설정)
 */
export async function getOcrWorker(
  onProgress?: (progress: number, status: string) => void
): Promise<Worker> {
  if (cachedWorker) {
    return cachedWorker;
  }

  if (isInitializing) {
    while (isInitializing) {
      await new Promise((res) => setTimeout(res, 50));
      if (cachedWorker) return cachedWorker;
    }
  }

  isInitializing = true;
  try {
    const worker = await createWorker("eng", 1, {
      logger: (m: { status?: string; progress: number }) => {
        if (onProgress && m.status === "recognizing text") {
          onProgress(Math.round(m.progress * 100), m.status);
        } else if (onProgress && m.status) {
          onProgress(0, m.status);
        }
      },
    });

    // 산업용 금속 명판 문자셋 화이트리스트 & 300 DPI 최적화
    await worker.setParameters({
      tessedit_char_whitelist:
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_./:#()= ",
      tessedit_pageseg_mode: "6" as any, // Single uniform block of text
      user_defined_dpi: "300",
      preserve_interword_spaces: "1",
    });

    cachedWorker = worker;
    return worker;
  } finally {
    isInitializing = false;
  }
}

/**
 * Worker 명시적 종료
 */
export async function terminateOcrWorker() {
  if (cachedWorker) {
    try {
      await cachedWorker.terminate();
    } catch {
      // ignore
    }
    cachedWorker = null;
  }
}

// 명판 고정 단어 (시리얼 번호가 아닌 단어 블랙리스트)
const IGNORE_WORDS = new Set([
  "MODEL",
  "MADE",
  "KOREA",
  "JAPAN",
  "CHINA",
  "USA",
  "GERMANY",
  "TAIWAN",
  "VOLT",
  "VOLTAGE",
  "WATT",
  "AMP",
  "AMPERE",
  "PHASE",
  "HERTZ",
  "HZ",
  "DATE",
  "MFG",
  "MANUFACTURE",
  "WEIGHT",
  "RATING",
  "NAMEPLATE",
  "SERIAL",
  "NUMBER",
  "SER",
  "NO",
  "TYPE",
  "SPEC",
  "CLASS",
  "CLASS2",
  "CE",
  "KC",
  "UL",
  "INSPECTED",
  "PASSED",
  "WARNING",
  "CAUTION",
  "INPUT",
  "OUTPUT",
  "POWER",
  "PART",
  "NONE",
  "NULL",
  "TEMP",
  "BARCODE",
  "CODE",
  "ROHS",
  "FLOW",
  "PRESSURE",
  "BAR",
  "PSI",
  "VDC",
  "VAC",
  "RANGE",
  "GAS",
  "ADVANTECH",
  "MITSUBISHI",
  "ELECTRIC",
  "MOXA",
  "INDUSTRIAL",
  "ETHERNET",
  "SWITCH",
  "FACTORY",
  "FCC",
  "RULES",
  "DEVICE",
  "ATTENTION",
  "LISTED",
  "E180881",
  "MSIP",
  "EAC",
  "UKCA",
  "PIN",
  "ASSIGNMENT",
  "REV",
  "UPORT",
  "MELSEC",
]);

interface ScoredCandidate {
  serial: string;
  score: number;
}

export interface PartOcrContext {
  partName?: string;
  spec?: string;
  subSpec?: string;
}

/**
 * 유효한 시리얼 번호 형태인지 검증
 */
function isValidSerialFormat(token: string): boolean {
  if (!token || token.length < 3 || token.length > 35) return false;
  if (IGNORE_WORDS.has(token)) return false;

  // 1. 단순 반복 문자열 방지 (예: "------", "11111", "AAAAA", ".....", "||||||")
  if (/^(.)\1+$/.test(token)) return false;

  // 2. 바코드 노이즈 라인 방지
  if (/^[|\-=_/\\.]+$/.test(token)) return false;

  // 3. 특수기호만으로 구성된 노이즈 방지
  if (!/[A-Za-z0-9]/.test(token)) return false;

  // 4. 최소 2자 이상의 영문/숫자 포함
  const alphanumericCount = (token.match(/[A-Za-z0-9]/g) || []).length;
  if (alphanumericCount < 2) return false;

  // 5. 모음이 없는 단순 1~3글자 영문 노이즈 방지
  if (token.length <= 3 && !/[0-9]/.test(token)) return false;

  return true;
}

/**
 * 개별 시리얼 토큰 정제
 */
export function sanitizeSerialToken(token: string): string {
  if (!token) return "";
  let clean = token.toUpperCase().trim();

  // 앞뒤 특수문자, 바코드 라인 잔여물 제거
  clean = clean.replace(/^[^A-Z0-9]+/, "").replace(/[^A-Z0-9]+$/, "");
  clean = clean.replace(/\s+/g, "");

  return clean;
}

/**
 * 부품 규격/품명에서 모델명 키워드 추출 (규격이 시리얼로 오인되는 것 방지)
 */
function extractForbiddenSpecTokens(context?: PartOcrContext): Set<string> {
  const forbidden = new Set<string>();
  if (!context) return forbidden;

  const rawText = `${context.partName || ""} ${context.spec || ""} ${context.subSpec || ""}`.toUpperCase();
  const tokens = rawText.split(/[\s,()/:;.\-_]+/);

  for (const t of tokens) {
    const clean = sanitizeSerialToken(t);
    if (clean && clean.length >= 2) {
      forbidden.add(clean);
    }
  }

  return forbidden;
}

/**
 * 1D 바코드 네이티브 하드웨어 스캐닝 (BarcodeDetector 지원 시 100% 신뢰도 즉시 추출)
 */
async function tryDetectNativeBarcode(
  canvas: HTMLCanvasElement
): Promise<string[]> {
  const detected: string[] = [];
  try {
    const BarcodeDetectorClass = (window as unknown as { BarcodeDetector?: any })
      .BarcodeDetector;
    if (BarcodeDetectorClass) {
      const barcodeDetector = new BarcodeDetectorClass({
        formats: [
          "code_128",
          "code_39",
          "code_93",
          "ean_13",
          "ean_8",
          "upc_a",
          "upc_e",
          "qr_code",
          "data_matrix",
        ],
      });
      const barcodes = await barcodeDetector.detect(canvas);
      for (const b of barcodes) {
        const val = sanitizeSerialToken(b.rawValue);
        if (val && isValidSerialFormat(val)) {
          detected.push(val);
        }
      }
    }
  } catch {
    // ignore
  }
  return detected;
}

/**
 * 텍스트 및 바코드에서 산업용 시리얼 번호를 정밀 추출 (모든 영문+숫자 및 순수 숫자 지원)
 */
export function extractSerialCandidates(
  rawText: string,
  context?: PartOcrContext,
  nativeBarcodes: string[] = []
): {
  bestSerial: string;
  candidates: string[];
  lines: string[];
} {
  const rawLines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const scoredMap = new Map<string, number>();
  const forbiddenSpecTokens = extractForbiddenSpecTokens(context);

  const addCandidate = (token: string, score: number) => {
    const cleaned = sanitizeSerialToken(token);
    if (!cleaned) return;
    if (!isValidSerialFormat(cleaned)) return;

    // 부품 품명/규격(모델번호)과 일치하면 시리얼이 아니므로 점수 대폭 삭감
    if (forbiddenSpecTokens.has(cleaned)) {
      score -= 500;
    }

    if (score < 40) return;

    const currentScore = scoredMap.get(cleaned) || 0;
    if (score > currentScore) {
      scoredMap.set(cleaned, score);
    }
  };

  // [0] 바코드 리더에서 직접 인식된 100% 신뢰도 시리얼 (+1000점)
  for (const bar of nativeBarcodes) {
    addCandidate(bar, 1000);
  }

  // [1] 명판 고유 S/N 패턴:
  // A. Moxa 스타일: "Production S/N: TBAJB1112637", "Product S/N : ..." (+480점)
  const productionSnRegex =
    /(?:Production\s*S\s*[/\\|\-.]\s*N|Product\s*S\s*[/\\|\-.]\s*N|Prod\s*S\s*[/\\|\-.]\s*N|Mfg\s*S\s*[/\\|\-.]\s*N)\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{4,35})/gi;

  // B. Mitsubishi 스타일: "SERIAL 230600231746059-A" (+480점)
  const spaceSerialRegex =
    /(?:^|\s)(?:SERIAL|SER\.?\s*NO\.?|S\/N|SN)\s+([A-Za-z0-9\-_./]{4,35})/gi;

  // C. Advantech 스타일: "SN: KMA9011219", "S/N: 2026-X88", "SERIAL NO. : TM1L-HK26-1007" (+460점)
  const strongPrefixRegex =
    /(?:SERIAL\s*(?:NUMBER|NO\.?|#|CODE)?|S\s*[/\\|\-.]\s*N|S\s*N|SER\.?\s*(?:NO\.?|#)|S\/NO\.?|S\.NO\.?)\s*[:.\-|=]\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // D. OCR 오인식 보정 패턴: "SIN:", "5/N:", "S|N:", "SER1AL" (+400점)
  const fuzzyPrefixRegex =
    /(?:S[I1|l]N|5\s*[/\\|\-.]\s*N|S\s*\|\s*N|SER[I1|l]AL\s*(?:NO\.?|#)?)\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // E. 줄 단독 S/N 헤더 (아래 1~2줄에 시리얼/바코드가 위치한 경우) (+430점)
  const headerOnlyRegex =
    /^(?:Production\s*S\s*[/\\|\-.]\s*N|Product\s*S\s*[/\\|\-.]\s*N|SERIAL\s*(?:NUMBER|NO\.?|#|CODE)?|S\s*[/\\|\-.]\s*N|S\s*N|SER\.?\s*(?:NO\.?|#)|S[I1|l]N|S\/NO\.?)\s*[:.\-|=]?$/i;

  // F. 모델/파트번호 접두사 (MODEL, P/N, TYPE, REV, INPUT)
  const modelPrefixRegex =
    /(?:MODEL\s*(?:NO\.?|#|TYPE)?|MOD\.?|TYPE|TYP\.?|P\s*[/\\|\-.]\s*N|PART\s*NO\.?|ITEM\s*NO\.?|MN\s*:|REV\s*:|INPUT\s*:|OUTPUT\s*:)\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // 1차 패스: 라인별 모델명/규격명 감지하여 시리얼 후보에서 사전 배제
  for (const line of rawLines) {
    let match: RegExpExecArray | null;
    while ((match = modelPrefixRegex.exec(line)) !== null) {
      if (match[1]) {
        const modelVal = sanitizeSerialToken(match[1]);
        if (modelVal) {
          forbiddenSpecTokens.add(modelVal);
        }
      }
    }
  }

  // 2차 패스: 시리얼 정밀 추출
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // 1. Production S/N (480점)
    let match: RegExpExecArray | null;
    while ((match = productionSnRegex.exec(line)) !== null) {
      if (match[1]) addCandidate(match[1], 480);
    }

    // 2. SERIAL <번호> (480점)
    while ((match = spaceSerialRegex.exec(line)) !== null) {
      if (match[1]) addCandidate(match[1], 480);
    }

    // 3. SN: / S/N: (460점)
    while ((match = strongPrefixRegex.exec(line)) !== null) {
      if (match[1]) addCandidate(match[1], 460);
    }

    // 4. OCR 오인식 보정 (400점)
    while ((match = fuzzyPrefixRegex.exec(line)) !== null) {
      if (match[1]) addCandidate(match[1], 400);
    }

    // 5. 헤더 아래 1~2줄 위치 시리얼 추적 (430점)
    if (headerOnlyRegex.test(line.trim())) {
      if (i + 1 < rawLines.length) {
        const nextTokens = rawLines[i + 1].split(/[\s,;:()[\]|]+/);
        for (const t of nextTokens) {
          addCandidate(t, 430);
        }
      }
      if (i + 2 < rawLines.length) {
        const next2Tokens = rawLines[i + 2].split(/[\s,;:()[\]|]+/);
        for (const t of next2Tokens) {
          addCandidate(t, 410);
        }
      }
    }

    // 6. 모든 일반 영문+숫자 혼합 또는 연속 숫자 시리얼 토큰 유연 추출
    const tokens = line.split(/[\s,;:()[\]|]+/);
    for (const rawTok of tokens) {
      const tok = sanitizeSerialToken(rawTok);
      if (!tok || !isValidSerialFormat(tok)) continue;

      const hasAlpha = /[A-Z]/.test(tok);
      const hasDigit = /[0-9]/.test(tok);

      // A. 영문+숫자 혼합 (예: KMA9011219, TBAJB1112637, Z0065234, 25X-0049H, 230600231746059-A, TM1L-HK26-1007)
      if (hasAlpha && hasDigit && tok.length >= 4 && tok.length <= 30) {
        addCandidate(tok, 290);
      }
      // B. 5~18자리 연속 숫자 (예: 673644, 092402204027, 8821034)
      else if (!hasAlpha && hasDigit && tok.length >= 5 && tok.length <= 18) {
        addCandidate(tok, 260);
      }
    }
  }

  // 점수 내림차순 정렬
  const sortedCandidates: ScoredCandidate[] = Array.from(scoredMap.entries())
    .map(([serial, score]) => ({ serial, score }))
    .filter((c) => c.score >= 40)
    .sort((a, b) => b.score - a.score);

  // 최대 3개 추천으로 제한
  const candidates = sortedCandidates.map((c) => c.serial).slice(0, 3);
  const bestSerial = candidates.length > 0 ? candidates[0] : "";

  return {
    bestSerial,
    candidates,
    lines: rawLines,
  };
}

/**
 * 캔버스 메모리 상에서 직접 OCR 및 바코드 복합 인식 수행 (Storage Zero)
 */
export async function performInMemoryOcr(
  canvas: HTMLCanvasElement,
  onProgress?: (progress: number, status: string) => void,
  context?: PartOcrContext
): Promise<OcrResult> {
  // 1. 네이티브 바코드 스캔 시도 (Advantech, Moxa 등 바코드 100% 인식)
  const nativeBarcodes = await tryDetectNativeBarcode(canvas);

  // 2. Tesseract OCR 실행
  const worker = await getOcrWorker(onProgress);
  const result = await worker.recognize(canvas);

  const rawText = result.data.text || "";
  const confidence = Math.round(result.data.confidence || 0);

  const { bestSerial, candidates, lines } = extractSerialCandidates(
    rawText,
    context,
    nativeBarcodes
  );

  const finalSerial = candidates.length > 0 ? bestSerial : "";
  const finalCandidates = candidates.length > 0 ? candidates : [];
  const finalConfidence = nativeBarcodes.length > 0 ? 100 : confidence;

  return {
    rawText,
    cleanedSerial: finalSerial,
    confidence: finalConfidence,
    lines,
    candidates: finalCandidates,
  };
}
