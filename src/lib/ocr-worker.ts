import { createWorker, Worker } from "tesseract.js";
import { OcrResult } from "@/types";

let cachedWorker: Worker | null = null;
let isInitializing = false;

/**
 * Tesseract.js Worker 초기화 (싱글톤 & 순수 문자/숫자 특화 OCR 엔진)
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

    // 산업용 문자/숫자 전용 화이트리스트 & 단일 텍스트 블록/가변 컬럼 모드(PSM 6/4) + 300 DPI
    await worker.setParameters({
      tessedit_char_whitelist:
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_./:#()= ",
      tessedit_pageseg_mode: "6" as any,
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
  "WITHTECH",
  "INSPECTION",
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
 * 유효한 시리얼 번호(문자+숫자 또는 순수 숫자) 형식 검증
 */
function isValidSerialFormat(token: string): boolean {
  if (!token || token.length < 3 || token.length > 35) return false;
  if (IGNORE_WORDS.has(token)) return false;

  // 1. 단순 반복 문자열 방지 (예: "------", "11111", "AAAAA", ".....", "||||||")
  if (/^(.)\1+$/.test(token)) return false;

  // 2. 바코드 노이즈 선 (수직선, 슬래시 잔여물) 방지
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
 * 개별 시리얼 토큰 정제 (접두사 기호 및 노이즈 제거)
 */
export function sanitizeSerialToken(token: string): string {
  if (!token) return "";
  let clean = token.toUpperCase().trim();

  // "SN:", "S/N:", "NO:", "SERIAL:" 접두어가 딸려온 경우 잘라내기
  clean = clean.replace(/^(?:SERIAL|SER\.?NO\.?|S\/N|S\.N\.|SN|NO|N°|CODE)[\s:.\-|=]+/i, "");

  // 앞뒤 특수문자, 노이즈 기호 제거
  clean = clean.replace(/^[^A-Z0-9]+/, "").replace(/[^A-Z0-9]+$/, "");
  clean = clean.replace(/\s+/g, "");

  return clean;
}

/**
 * 부품 규격/품명에서 모델명 키워드 추출 (규격/모델명이 시리얼로 오인되는 것 방지)
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
 * 텍스트에서 산업용 시리얼 번호를 정밀 추출 (SN, Serial Number, S/N 키워드 최우선)
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
    .filter((l) => l.length > 0 && !/^[|/\\_\-\s.]{4,}$/.test(l));

  const scoredMap = new Map<string, number>();
  const forbiddenSpecTokens = extractForbiddenSpecTokens(context);

  const addCandidate = (token: string, score: number) => {
    const cleaned = sanitizeSerialToken(token);
    if (!cleaned) return;
    if (!isValidSerialFormat(cleaned)) return;

    // 부품 품명/규격(모델번호)과 일치하면 시리얼이 아니므로 점수 삭감
    if (forbiddenSpecTokens.has(cleaned)) {
      score -= 400;
    }

    if (score < 40) return;

    const currentScore = scoredMap.get(cleaned) || 0;
    if (score > currentScore) {
      scoredMap.set(cleaned, score);
    }
  };

  // [1] 명판 고유 S/N 패턴 정규식 목록:
  // A. Production S/N (Moxa 등): "Production S/N: TBAJB1112637" (+1000점)
  const productionSnRegex =
    /(?:Production\s*S[\/\\|\-.]?N|Product\s*S[\/\\|\-.]?N|Prod\.?\s*S[\/\\|\-.]?N|Mfg\s*S[\/\\|\-.]?N)\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // B. Serial Number / Serial No / SERIAL (Mitsubishi, Thomas 등): "Serial Number: 673644", "SERIAL 230600231746059-A" (+950점)
  const serialWordRegex =
    /(?:SERIAL\s*(?:NUMBER|NO\.?|#|CODE)?|SER\.?\s*NO\.?|SER\.?\s*#)\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // C. S/N, SN, S.N. (Advantech, Horiba, Brooks 등): "S/N: KMA9011219", "SN: 092402204027", "S/N 25002481" (+900점)
  const snPrefixRegex =
    /(?:S\s*[\/\\|\-.]\s*N|S\s*N|S\/NO\.?|S\.NO\.?|S\.N\.)\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // D. No. / Number: "No. 131279307", "NO : 25X-0049H" (+800점)
  const noPrefixRegex =
    /(?:^|\s)(?:NO\.?|N°|NUMBER|CODE)\s*[:.\-|=]\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // E. OCR 오인식 보정 패턴: "SIN:", "5/N:", "S|N:", "SER1AL", "S/M" (+850점)
  const fuzzyPrefixRegex =
    /(?:S[I1|l5]N|5\s*[\/\\|\-.]\s*N|S\s*\|\s*N|SER[I1|l]AL\s*(?:NO\.?|#)?|S\/M|S\s*M)\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // F. 줄 단독 헤더 (아래 1~2줄에 시리얼 번호가 위치한 경우) (+880점)
  const headerOnlyRegex =
    /^(?:Production\s*S[\/\\|\-.]?N|Product\s*S[\/\\|\-.]?N|SERIAL\s*(?:NUMBER|NO\.?|#|CODE)?|SER\.?\s*(?:NO\.?|#)|S\s*[\/\\|\-.]\s*N|S\s*N|S[I1|l]N|S\/NO\.?|S\.N\.?|NO\.?|N°)$/i;

  // G. 모델/파트번호 접두사 (사전 배제용)
  const modelPrefixRegex =
    /(?:MODEL\s*(?:NO\.?|#|TYPE)?|MOD\.?|TYPE|TYP\.?|P\s*[\/\\|\-.]\s*N|PART\s*NO\.?|ITEM\s*NO\.?|MN\s*:|REV\s*:|INPUT\s*:|OUTPUT\s*:)\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{3,35})/gi;

  // 1차 패스: 모델명 추출하여 시리얼 후보에서 사전 배제
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

  // 2차 패스: 키워드 기반 시리얼 정밀 추출
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // 1. Production S/N (1000점)
    let match: RegExpExecArray | null;
    while ((match = productionSnRegex.exec(line)) !== null) {
      if (match[1]) addCandidate(match[1], 1000);
    }

    // 2. Serial Number / Serial No / SERIAL (950점)
    while ((match = serialWordRegex.exec(line)) !== null) {
      if (match[1]) addCandidate(match[1], 950);
    }

    // 3. SN: / S/N: / S.N. (900점)
    while ((match = snPrefixRegex.exec(line)) !== null) {
      if (match[1]) addCandidate(match[1], 900);
    }

    // 4. No. / Number: (800점)
    while ((match = noPrefixRegex.exec(line)) !== null) {
      if (match[1]) addCandidate(match[1], 800);
    }

    // 5. OCR 오인식 보정 (850점)
    while ((match = fuzzyPrefixRegex.exec(line)) !== null) {
      if (match[1]) addCandidate(match[1], 850);
    }

    // 6. 헤더 아래 1~2줄 위치 시리얼 추적 (880점 / 820점)
    if (headerOnlyRegex.test(line.trim())) {
      if (i + 1 < rawLines.length) {
        const nextTokens = rawLines[i + 1].split(/[\s,;:()[\]|=]+/);
        for (const t of nextTokens) {
          addCandidate(t, 880);
        }
      }
      if (i + 2 < rawLines.length) {
        const next2Tokens = rawLines[i + 2].split(/[\s,;:()[\]|=]+/);
        for (const t of next2Tokens) {
          addCandidate(t, 820);
        }
      }
    }

    // 7. 모든 일반 영문+숫자 혼합 또는 연속 숫자 시리얼 토큰 추출
    const tokens = line.split(/[\s,;:()[\]|=]+/);
    for (const rawTok of tokens) {
      const tok = sanitizeSerialToken(rawTok);
      if (!tok || !isValidSerialFormat(tok)) continue;

      const hasAlpha = /[A-Z]/.test(tok);
      const hasDigit = /[0-9]/.test(tok);

      // A. 영문+숫자 혼합 (예: KMA9011219, TBAJB1112637, Z0065234, 25X-0049H, 230600231746059-A, TM1L-HK26-1007, KD26030201-013)
      if (hasAlpha && hasDigit && tok.length >= 4 && tok.length <= 30) {
        addCandidate(tok, 420);
      }
      // B. 5~18자리 연속 숫자 (예: 673644, 092402204027, 25309826, 260518269, 25002481, 131279307)
      else if (!hasAlpha && hasDigit && tok.length >= 5 && tok.length <= 18) {
        addCandidate(tok, 380);
      }
      // C. 특수 패턴: 16.24893336, 260225-09, 251021-49
      else if (hasDigit && (tok.includes("-") || tok.includes(".")) && tok.length >= 5) {
        addCandidate(tok, 400);
      }
    }
  }

  // 점수 내림차순 정렬
  const sortedCandidates: ScoredCandidate[] = Array.from(scoredMap.entries())
    .map(([serial, score]) => ({ serial, score }))
    .filter((c) => c.score >= 40)
    .sort((a, b) => b.score - a.score);

  // 최대 3개 추천
  const candidates = sortedCandidates.map((c) => c.serial).slice(0, 3);
  const bestSerial = candidates.length > 0 ? candidates[0] : "";

  return {
    bestSerial,
    candidates,
    lines: rawLines,
  };
}

/**
 * 캔버스 메모리 상에서 순수 문자/숫자 정밀 광학 OCR 실행 (Storage Zero)
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

  const { bestSerial, candidates, lines } = extractSerialCandidates(
    rawText,
    context
  );

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
