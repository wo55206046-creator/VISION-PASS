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

// 명판 고정 단어 (시리얼 번호가 아닌 노이즈 단어 블랙리스트)
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
]);

interface ScoredCandidate {
  serial: string;
  score: number;
}

/**
 * 유효한 시리얼 번호 형태인지 엄격히 검증 (허상값/노이즈 방지)
 */
function isValidSerialFormat(token: string): boolean {
  if (!token || token.length < 3 || token.length > 35) return false;
  if (IGNORE_WORDS.has(token)) return false;

  // 1. 단순 반복 문자열 방지 (예: "------", "11111", "AAAAA", ".....")
  if (/^(.)\1+$/.test(token)) return false;

  // 2. 특수기호만으로 구성된 노이즈 방지
  if (!/[A-Za-z0-9]/.test(token)) return false;

  // 3. 최소 2자 이상의 영문/숫자가 포함되어야 함
  const alphanumericCount = (token.match(/[A-Za-z0-9]/g) || []).length;
  if (alphanumericCount < 2) return false;

  // 4. 모음이 없는 단순 1~2글자 영문 노이즈 방지
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
 * 텍스트에서 산업용 시리얼 번호(Serial Number, S/N 등)를 최우선 순위로 추출 및 정제
 * (허상값 철저 필터링 & 추천 단어 최대 3개)
 */
export function extractSerialCandidates(rawText: string): {
  bestSerial: string;
  candidates: string[];
  lines: string[];
} {
  const rawLines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const scoredMap = new Map<string, number>();

  const addCandidate = (token: string, score: number) => {
    const cleaned = sanitizeSerialToken(token);
    if (!cleaned) return;
    if (!isValidSerialFormat(cleaned)) return;

    // 이미 등록된 후보라면 더 높은 점수로 갱신
    const currentScore = scoredMap.get(cleaned) || 0;
    if (score > currentScore) {
      scoredMap.set(cleaned, score);
    }
  };

  // [1] 최우선 패턴: Serial Number, S/N, S-N, SN 등의 키워드 바로 뒤의 값 매칭 (150점)
  const strongPrefixRegex =
    /(?:SERIAL\s*(?:NUMBER|NO\.?|#|CODE)?|S\s*[/\\|\-.]\s*N|S\s*N|SER\.?\s*(?:NO\.?|#))\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // [2] OCR 오인식 보정 패턴: "SIN:", "5/N:", "S1N:", "SER1AL NO:" (120점)
  const fuzzyPrefixRegex =
    /(?:S[I1|l]N|5\s*[/\\|\-.]\s*N|SER[I1|l]AL\s*(?:NO\.?|#)?)\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // [3] 일반 NO:, ID:, BARCODE: 매칭 (90점)
  const generalPrefixRegex =
    /(?:NO\.?|ID|BARCODE|LOT\s*NO|PROD\s*NO)\s*[:.\-|=]\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // [4] 줄 단독 S/N 헤더 패턴 (예: Line 1 = "SERIAL NO.", Line 2 = "STEC-2026-001") (140점)
  const headerOnlyRegex =
    /^(?:SERIAL\s*(?:NUMBER|NO\.?|#|CODE)?|S\s*[/\\|\-.]\s*N|S\s*N|SER\.?\s*(?:NO\.?|#)|S[I1|l]N)\s*[:.\-|=]?$/i;

  // [5] 전형적인 반도체/산업 설비 시리얼 패턴 (영문+숫자+하이픈 조합 4~25자) (80점)
  const industrialCodeRegex = /\b([A-Z0-9]{2,10}[-_/][A-Z0-9\-_./]{2,20})\b/gi;

  // [6] 영문+숫자가 혼합된 5자 이상의 고유 코드 토큰 (60점)
  const mixedAlphaNumRegex = /\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9\-_]{5,25}\b/gi;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // --- A. 같은 줄에서 명시적 S/N 키워드 추출 (150점) ---
    let match: RegExpExecArray | null;
    while ((match = strongPrefixRegex.exec(line)) !== null) {
      if (match[1]) {
        addCandidate(match[1], 150);
      }
    }

    // --- B. OCR 오인식 키워드 추출 (120점) ---
    while ((match = fuzzyPrefixRegex.exec(line)) !== null) {
      if (match[1]) {
        addCandidate(match[1], 120);
      }
    }

    // --- C. 헤더가 위 줄에 있고 실제 시리얼이 다음 줄에 있는 경우 (140점) ---
    if (headerOnlyRegex.test(line.trim()) && i + 1 < rawLines.length) {
      const nextLine = rawLines[i + 1];
      addCandidate(nextLine, 140);
    }

    // --- D. 일반 NO. / ID. 키워드 (90점) ---
    while ((match = generalPrefixRegex.exec(line)) !== null) {
      if (match[1]) {
        addCandidate(match[1], 90);
      }
    }

    // --- E. 하이픈/슬래시 포함 산업용 코드 패턴 (80점) ---
    while ((match = industrialCodeRegex.exec(line)) !== null) {
      if (match[1]) {
        addCandidate(match[1], 80);
      }
    }

    // --- F. 영문+숫자 혼합 토큰 (60점) ---
    while ((match = mixedAlphaNumRegex.exec(line)) !== null) {
      if (match[0]) {
        addCandidate(match[0], 60);
      }
    }
  }

  // 점수 내림차순 정렬
  const sortedCandidates: ScoredCandidate[] = Array.from(scoredMap.entries())
    .map(([serial, score]) => ({ serial, score }))
    .filter((c) => c.score >= 50) // 허상값 노이즈(낮은 점수) 완전 제외
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
  onProgress?: (progress: number, status: string) => void
): Promise<OcrResult> {
  const worker = await getOcrWorker(onProgress);
  const result = await worker.recognize(canvas);

  const rawText = result.data.text || "";
  const confidence = Math.round(result.data.confidence || 0);

  const { bestSerial, candidates, lines } = extractSerialCandidates(rawText);

  // 신뢰도가 지나치게 낮고 추출된 시리얼도 없으면 인식 불가 처리
  const finalSerial = confidence >= 25 || candidates.length > 0 ? bestSerial : "";
  const finalCandidates = confidence >= 25 || candidates.length > 0 ? candidates : [];

  return {
    rawText,
    cleanedSerial: finalSerial,
    confidence,
    lines,
    candidates: finalCandidates,
  };
}
