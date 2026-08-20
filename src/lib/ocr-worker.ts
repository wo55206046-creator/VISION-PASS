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

    // 산업용 금속 명판 문자셋 및 기호 화이트리스트
    await worker.setParameters({
      tessedit_char_whitelist:
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_./:#()|\\= ",
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

// 시리얼 번호가 아닌 명판 고정 단어 (필터링 블랙리스트)
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
]);

interface ScoredCandidate {
  serial: string;
  score: number;
}

/**
 * 텍스트에서 산업용 시리얼 번호(Serial Number, S/N 등)를 최우선 순위로 추출 및 정제
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
    if (!cleaned || cleaned.length < 3) return;
    if (IGNORE_WORDS.has(cleaned)) return;

    // 이미 등록된 후보라면 더 높은 점수로 갱신
    const currentScore = scoredMap.get(cleaned) || 0;
    if (score > currentScore) {
      scoredMap.set(cleaned, score);
    }
  };

  // [1] 최우선 패턴: Serial Number, S/N, S-N, SN 등의 키워드 바로 뒤의 값 매칭
  // 예: "Serial No. : AB-12345", "S/N: 2026-X99", "SERIAL NUMBER : 88210"
  const strongPrefixRegex =
    /(?:SERIAL\s*(?:NUMBER|NO\.?|#|CODE)?|S\s*[/\\|\-.]\s*N|S\s*N|SER\.?\s*(?:NO\.?|#))\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // [2] OCR 오인식 보정 패턴: "SIN:", "5/N:", "S1N:", "SER1AL NO:"
  const fuzzyPrefixRegex =
    /(?:S[I1|l]N|5\s*[/\\|\-.]\s*N|SER[I1|l]AL\s*(?:NO\.?|#)?)\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // [3] 일반 NO:, ID:, BARCODE: 매칭
  const generalPrefixRegex =
    /(?:NO\.?|ID|BARCODE|LOT\s*NO|PROD\s*NO)\s*[:.\-|=]\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // [4] 줄 단독 S/N 헤더 패턴 (예: Line 1 = "SERIAL NO.", Line 2 = "STEC-2026-001")
  const headerOnlyRegex =
    /^(?:SERIAL\s*(?:NUMBER|NO\.?|#|CODE)?|S\s*[/\\|\-.]\s*N|S\s*N|SER\.?\s*(?:NO\.?|#)|S[I1|l]N)\s*[:.\-|=]?$/i;

  // [5] 전형적인 반도체/산업 설비 시리얼 패턴 (영문+숫자+하이픈 조합 4~25자)
  const industrialCodeRegex = /\b([A-Z0-9]{2,10}[-_/][A-Z0-9\-_./]{2,20})\b/gi;

  // [6] 영문+숫자가 혼합된 6자 이상의 고유 코드 토큰
  const mixedAlphaNumRegex = /\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*[0-9])[A-Z0-9\-_]{6,25}\b/gi;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // --- A. 같은 줄에서 명시적 S/N 키워드 추출 (최고 점수 150점) ---
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

    // --- E. 하이픈/슬래시 포함 산업용 코드 패턴 (70점) ---
    while ((match = industrialCodeRegex.exec(line)) !== null) {
      if (match[1]) {
        addCandidate(match[1], 70);
      }
    }

    // --- F. 영문+숫자 혼합 토큰 (50점) ---
    while ((match = mixedAlphaNumRegex.exec(line)) !== null) {
      if (match[0]) {
        addCandidate(match[0], 50);
      }
    }
  }

  // 매칭된 후보가 없거나 부족한 경우, 라인 전체를 후보로 탐색 (30점)
  if (scoredMap.size === 0) {
    for (const line of rawLines) {
      const sanitized = sanitizeSerialToken(line);
      if (sanitized && sanitized.length >= 4) {
        addCandidate(sanitized, 30);
      }
    }
  }

  // 점수 내림차순 정렬
  const sortedCandidates: ScoredCandidate[] = Array.from(scoredMap.entries())
    .map(([serial, score]) => ({ serial, score }))
    .sort((a, b) => b.score - a.score);

  const candidates = sortedCandidates.map((c) => c.serial);
  const bestSerial = candidates.length > 0 ? candidates[0] : "";

  return {
    bestSerial,
    candidates,
    lines: rawLines,
  };
}

/**
 * 개별 시리얼 토큰 정제
 */
export function sanitizeSerialToken(token: string): string {
  if (!token) return "";
  let clean = token.toUpperCase().trim();

  // 1. 앞뒤 콜론, 세미콜론, 쉼표, 점, 따옴표, 괄호, 슬래시 등 불필요한 특수문자 제거
  clean = clean.replace(/^[^A-Z0-9]+/, "").replace(/[^A-Z0-9]+$/, "");

  // 2. 내부 다중 공백 제거
  clean = clean.replace(/\s+/g, "");

  return clean;
}

/**
 * 캔버스 메모리 상에서 직접 OCR 인식 수행
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

  return {
    rawText,
    cleanedSerial: bestSerial,
    confidence,
    lines,
    candidates,
  };
}
