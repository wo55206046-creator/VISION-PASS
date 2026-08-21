import { createWorker, Worker } from "tesseract.js";
import { OcrResult } from "@/types";

let cachedWorker: Worker | null = null;
let isInitializing = false;

/**
 * Tesseract.js Worker 초기화 (싱글톤)
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

    // 산업용 금속 명판 문자셋 화이트리스트
    await worker.setParameters({
      tessedit_char_whitelist:
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_./:#()= ",
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

  // 1. 단순 반복 문자열 방지 (예: "------", "11111", "AAAAA", ".....")
  if (/^(.)\1+$/.test(token)) return false;

  // 2. 특수기호만으로 구성된 노이즈 방지
  if (!/[A-Za-z0-9]/.test(token)) return false;

  // 3. 최소 2자 이상의 영문/숫자 포함
  const alphanumericCount = (token.match(/[A-Za-z0-9]/g) || []).length;
  if (alphanumericCount < 2) return false;

  // 4. 모음이 없는 단순 1~3글자 영문 노이즈 방지
  if (token.length <= 3 && !/[0-9]/.test(token)) return false;

  return true;
}

/**
 * 개별 시리얼 토큰 정제
 */
export function sanitizeSerialToken(token: string): string {
  if (!token) return "";
  let clean = token.toUpperCase().trim();

  // 앞뒤 콜론, 세미콜론, 쉼표, 점, 따옴표, 괄호, 슬래시 등 불필요한 특수문자 제거
  clean = clean.replace(/^[^A-Z0-9]+/, "").replace(/[^A-Z0-9]+$/, "");

  // 내부 다중 공백 제거
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
 * 텍스트에서 산업용 시리얼 번호(Serial Number, S/N 등)를 100%에 가까운 신뢰도로 정밀 추출
 * (규격/모델명 오인식 자동 배제 + S/N 가중치 극대화 + 최대 3개 정렬)
 */
export function extractSerialCandidates(
  rawText: string,
  context?: PartOcrContext
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

    // 해당 부품의 품명/규격(모델번호)과 일치하면 시리얼이 아니므로 점수 대폭 삭감 또는 제외
    if (forbiddenSpecTokens.has(cleaned)) {
      score -= 400;
    }

    if (score < 50) return;

    // 이미 등록된 후보라면 더 높은 점수로 갱신
    const currentScore = scoredMap.get(cleaned) || 0;
    if (score > currentScore) {
      scoredMap.set(cleaned, score);
    }
  };

  // [1] 최우선 패턴: Serial Number, S/N, S-N, SN, SER NO 키워드 바로 뒤의 값 (+350점)
  // 예: "Serial No. : 673644", "S/N: 25X-0049H", "SERIAL NUMBER : TM1L-HK26-1007", "SER NO 092402204027"
  const strongPrefixRegex =
    /(?:SERIAL\s*(?:NUMBER|NO\.?|#|CODE)?|S\s*[/\\|\-.]\s*N|S\s*N|SER\.?\s*(?:NO\.?|#)|S\/NO\.?|S\.NO\.?)\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // [2] OCR 오인식 보정 패턴: "SIN:", "5/N:", "S1N:", "S|N:", "SER1AL NO:" (+300점)
  const fuzzyPrefixRegex =
    /(?:S[I1|l]N|5\s*[/\\|\-.]\s*N|S\s*\|\s*N|SER[I1|l]AL\s*(?:NO\.?|#)?)\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // [3] 줄 단독 S/N 헤더 패턴 (예: Line 1 = "SERIAL NO.", Line 2 = "673644" 또는 "TM1L-HK26-1007") (+320점)
  const headerOnlyRegex =
    /^(?:SERIAL\s*(?:NUMBER|NO\.?|#|CODE)?|S\s*[/\\|\-.]\s*N|S\s*N|SER\.?\s*(?:NO\.?|#)|S[I1|l]N|S\/NO\.?)\s*[:.\-|=]?$/i;

  // [4] 일반 NO:, ID:, BARCODE: 매칭 (+150점)
  const generalPrefixRegex =
    /(?:(?:^|\s)NO\.?|ID|BARCODE|LOT\s*NO|PROD\s*NO)\s*[:.\-|=]\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // [5] 명판 상의 모델/규격 접두사 (MODEL, P/N, TYPE, SPEC) - 이 뒤의 값은 시리얼이 아닌 모델명이므로 제외/감점
  const modelPrefixRegex =
    /(?:MODEL|MOD\.?|TYPE|TYP\.?|P\s*[/\\|\-.]\s*N|PART\s*NO\.?|ITEM\s*NO\.?)\s*[:.\-|=]\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // [6] 전형적인 산업용 시리얼 코드 패턴 (영문+숫자+하이픈 조합 4~25자, 예: TM1L-HK26-1007, 25X-0049H) (+180점)
  const industrialCodeRegex = /\b([A-Z0-9]{2,10}[-_/][A-Z0-9\-_./]{2,20})\b/gi;

  // [7] 영문으로 시작하는 알파벳+숫자 혼합 시리얼 (예: Z0065234, M26044740) (+170점)
  const alphaNumSerialRegex = /\b([A-Z]{1,4}[0-9]{4,15}[A-Z0-9]?)\b/gi;

  // [8] 순수 5~15자리 숫자 시리얼 (예: 673644, 092402204027, 8821034) (+160점)
  const pureNumberSerialRegex = /\b([0-9]{5,15})\b/g;

  // A. 라인별 정밀 분석
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // --- 1. 같은 줄에서 명시적 S/N 키워드 추출 (최고 점수 350점) ---
    let match: RegExpExecArray | null;
    while ((match = strongPrefixRegex.exec(line)) !== null) {
      if (match[1]) {
        addCandidate(match[1], 350);
      }
    }

    // --- 2. OCR 오인식 S/N 키워드 추출 (300점) ---
    while ((match = fuzzyPrefixRegex.exec(line)) !== null) {
      if (match[1]) {
        addCandidate(match[1], 300);
      }
    }

    // --- 3. 헤더가 위 줄에 있고 실제 시리얼이 바로 다음 줄에 있는 경우 (320점) ---
    if (headerOnlyRegex.test(line.trim()) && i + 1 < rawLines.length) {
      const nextLine = rawLines[i + 1];
      addCandidate(nextLine, 320);
    }

    // --- 4. 일반 NO. / ID. 키워드 (150점) ---
    while ((match = generalPrefixRegex.exec(line)) !== null) {
      if (match[1]) {
        addCandidate(match[1], 150);
      }
    }

    // --- 5. 모델명/규격명 감지 (시리얼에서 배제하기 위해 감점 등록) ---
    while ((match = modelPrefixRegex.exec(line)) !== null) {
      if (match[1]) {
        const modelVal = sanitizeSerialToken(match[1]);
        if (modelVal) {
          forbiddenSpecTokens.add(modelVal);
        }
      }
    }

    // --- 6. 하이픈/슬래시 포함 산업용 코드 패턴 (180점) ---
    while ((match = industrialCodeRegex.exec(line)) !== null) {
      if (match[1]) {
        addCandidate(match[1], 180);
      }
    }

    // --- 7. 영문+숫자 혼합 시리얼 (170점) ---
    while ((match = alphaNumSerialRegex.exec(line)) !== null) {
      if (match[1]) {
        addCandidate(match[1], 170);
      }
    }

    // --- 8. 순수 5~15자리 숫자 시리얼 (160점) ---
    while ((match = pureNumberSerialRegex.exec(line)) !== null) {
      if (match[1]) {
        addCandidate(match[1], 160);
      }
    }
  }

  // 점수 내림차순 정렬
  const sortedCandidates: ScoredCandidate[] = Array.from(scoredMap.entries())
    .map(([serial, score]) => ({ serial, score }))
    .filter((c) => c.score >= 50)
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
 * 캔버스 메모리 상에서 직접 OCR 인식 수행 (Storage Zero)
 */
export async function performInMemoryOcr(
  canvas: HTMLCanvasElement,
  onProgress?: (progress: number, status: string) => void,
  context?: PartOcrContext
): Promise<OcrResult> {
  const worker = await getOcrWorker(onProgress);
  const result = await worker.recognize(canvas);

  const rawText = result.data.text || "";
  const confidence = Math.round(result.data.confidence || 0);

  const { bestSerial, candidates, lines } = extractSerialCandidates(rawText, context);

  // 신뢰도 또는 유효 후보 존재 여부 확인
  const finalSerial = candidates.length > 0 ? bestSerial : "";
  const finalCandidates = candidates.length > 0 ? candidates : [];

  return {
    rawText,
    cleanedSerial: finalSerial,
    confidence,
    lines,
    candidates: finalCandidates,
  };
}
