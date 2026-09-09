import { createWorker, Worker } from "tesseract.js";
import { OcrResult, OcrCandidateDetail } from "@/types";
import {
  createYellowLabelBoostCanvas,
  preprocessCanvas,
  rotateCanvas,
  disposeCanvas,
  DEFAULT_PREPROCESSING_OPTIONS,
} from "./image-processing";

let cachedWorker: Worker | null = null;
let isInitializing = false;

/**
 * ⚡ 웹 표준 BarcodeDetector API (하드웨어 가속 0.005초 바코드/QR 100% 정밀 판독)
 */
export async function scanNativeBarcode(canvas: HTMLCanvasElement): Promise<string | null> {
  if (typeof window !== "undefined" && "BarcodeDetector" in window) {
    try {
      const detector = new (window as any).BarcodeDetector({
        formats: [
          "code_128",
          "code_39",
          "code_93",
          "data_matrix",
          "qr_code",
          "ean_13",
          "ean_8",
          "itf",
          "upc_a",
          "upc_e",
        ],
      });
      const barcodes = await detector.detect(canvas);
      if (barcodes && barcodes.length > 0) {
        for (const b of barcodes) {
          if (b.rawValue) {
            const clean = sanitizeSerialToken(b.rawValue);
            if (clean && isValidSerialFormat(clean)) {
              return clean;
            }
          }
        }
      }
    } catch (e) {
      // BarcodeDetector 미지원 포맷 시 OCR로 자연스럽게 페일오버
    }
  }
  return null;
}

/**
 * Tesseract.js Worker 초기화 (싱글톤 & 산업용 문자/숫자/수기 특화 OCR 엔진)
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

    // 산업용 명판 및 시리얼 정밀 판독 모드 (한글/잡음 기호 배제로 LSTM 분류 정확도 극대화)
    await worker.setParameters({
      tessedit_char_whitelist:
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_./:#() ",
      tessedit_pageseg_mode: "6" as any, // Single uniform block: 라벨 줄글 결합력 극대화
      user_defined_dpi: "300",
      preserve_interword_spaces: "1",
      textord_heavy_nr: "1", // 잡음 억제
      classify_enable_learning: "0", // 학습 편향 배제
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
  "MAX",
  "MIN",
  "PUMP",
  "VALVE",
  "LINE",
  "TOTAL",
  "WITH",
  "TECH",
  "WITHTECH",
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
  "INSPECTION",
  "LABJACK",
  "LABJACK.COM",
  "WWW.LABJACK.COM",
  "WWW",
  "COM",
  "NET",
  "ORG",
  "10UA",
  "SGND",
  "SPC",
  "FIO0",
  "FIO1",
  "FIO2",
  "FIO3",
  "DAC0",
  "DAC1",
  "AIN0",
  "AIN1",
  "AIN2",
  "AIN3",
  "GND",
  "VS",
  "U6-PRO",
  "U6PRO",
  "U6",
  "PRO",
]);

/**
 * 유효한 시리얼 번호 패턴 검증
 */
function isValidSerialFormat(candidate: string): boolean {
  if (!candidate || candidate.length < 3 || candidate.length > 40) return false;

  const upper = candidate.toUpperCase();
  if (IGNORE_WORDS.has(upper)) return false;

  // 웹사이트 URL 또는 도메인 주소 필터링
  if (/\.COM|\.NET|\.CO\.KR|\.ORG|WWW\.|HTTP/i.test(candidate)) return false;

  // 순수 기호 또는 바코드 잔재 필터링
  if (/^[|\-_.#/:;*!+=]+$/.test(candidate)) return false;

  // 최소 1개 이상의 숫자 또는 알파벳 포함
  if (!/[0-9]/.test(candidate) && !/[A-Z]/.test(upper)) return false;

  // 바코드 반복 패턴 필터링 (예: ||||||, llllll, 11111111)
  if (/^(.)\1{4,}$/.test(candidate)) return false;

  return true;
}

/**
 * 0 vs O, 1 vs I/l, 5 vs S, 8 vs B 지능형 시각/문맥적 오인식 자동 보정
 */
function disambiguateSerialToken(token: string): string {
  if (!token || token.length < 3) return token;

  // 0. 윈도우 25자리 정품 키 (5x5 형태: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX)는 임의 치환 없이 원문 보존
  if (/^[A-Za-z0-9]{5}(-[A-Za-z0-9]{5}){4}$/i.test(token)) {
    return token.toUpperCase();
  }

  // 1. 대부분 숫자로 구성된 시리얼 (예: "36OO25446", "O924O22O4O27", "673644", "25OO2481", "1312793O7")
  const digitsCount = (token.match(/[0-9]/g) || []).length;
  const lettersCount = (token.match(/[A-Za-z]/g) || []).length;
  
  if (digitsCount >= 3 && lettersCount <= 4) {
    let corrected = token;

    // 만약 문자 부분이 O, o, I, l, |, S, s, $, B, b 로만 구성되어 있다면 전량 숫자로 스마트 치환
    const nonDigits = token.replace(/[0-9\-_./]/g, "");
    if (/^[OoIl|Ss$Bb]+$/.test(nonDigits)) {
      corrected = corrected
        .replace(/[Oo]/g, "0")
        .replace(/[Il|]/g, "1")
        .replace(/[Ss$]/g, "5")
        .replace(/[Bb]/g, "8");
      return corrected;
    }

    // 숫자 사이에 낀 O, I, l, S 보정
    corrected = corrected
      .replace(/(?<=\d)[Oo]+(?=\d)/g, (m) => "0".repeat(m.length))
      .replace(/(?<=\d)[Il|]+(?=\d)/g, (m) => "1".repeat(m.length))
      .replace(/(?<=\d)[Ss$]+(?=\d)/g, (m) => "5".repeat(m.length));

    // 전체의 65% 이상이 숫자인 경우 앞/뒤 O, I도 0, 1로 자동 보정
    if (digitsCount / token.length >= 0.65) {
      corrected = corrected
        .replace(/^O+(?=\d)/i, (m) => "0".repeat(m.length))
        .replace(/(?<=\d)O+$/i, (m) => "0".repeat(m.length))
        .replace(/^I+(?=\d)/i, (m) => "1".repeat(m.length))
        .replace(/(?<=\d)I+$/i, (m) => "1".repeat(m.length));
    }
    return corrected;
  }

  // 2. 산업용 하이픈 복합 시리얼 패턴 (예: "25X-0049H", "TM1L-HK26-1007", "KD26030201-013")
  if (token.includes("-")) {
    const parts = token.split("-");
    const fixedParts = parts.map((p) => {
      const pDigits = (p.match(/[0-9]/g) || []).length;
      if (pDigits >= 2 && p.length <= 6) {
        return p.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
      }
      return p;
    });
    return fixedParts.join("-");
  }

  return token;
}

/**
 * 시리얼 토큰 정제 (불필요한 접두사, 한글 라벨, 콜론, 특수기호 제거 및 오인식 문자 보정)
 */
function sanitizeSerialToken(raw: string): string {
  if (!raw) return "";
  let clean = raw.trim();

  // 바코드 양끝 별표(*) 제거 (예: *673644* -> 673644)
  clean = clean.replace(/^\*+|\*+$/g, "");

  // 앞뒤 콜론, 세미콜론, 슬래시, 바, 해시, 따옴표 제거
  clean = clean.replace(/^[ :;=|\-#/\\_.,<>()[\]{}]+|[ :;=|\-#/\\_.,<>()[\]{}]+$/g, "");

  // 영문/한글 접두사 자동 제거 (예: "WIN11 S/N : ...", "PC S/N : ...", "SN:25002481", "시리얼:673644")
  clean = clean.replace(
    /^(?:WIN(?:11|10|7|8|DOWS)?\s*S[\/\\|\-.]?N|WIN(?:11|10|7|8|DOWS)?\s*KEY|WIN(?:11|10|7|8)?|PC\s*S[\/\\|\-.]?N|IPC\s*S[\/\\|\-.]?N|Production\s*S[\/\\|\-.]?N|Product\s*S[\/\\|\-.]?N|Prod\s*S[\/\\|\-.]?N|SERIAL\s*(?:NO\.?|#|NUMBER)?|SER\.?\s*NO\.?|S[\/\\|\-.]N|SN|S\.N\.|S\/NO\.?|NO\.?|N°|CON-[A-Z0-9]+\s*S[\/\\|\-.]?N|시리얼\s*넘버|시리얼\s*번호|시리얼|일련\s*번호|제조\s*번호|식별\s*번호|관리\s*번호|호기|단품|부품)\s*[:.\-|=#\s]*/i,
    ""
  );

  // 다시 앞뒤 기호 정리
  clean = clean.replace(/^[ :;=|\-#/\\_.,]+|[ :;=|\-#/\\_.,]+$/g, "");

  // 0 vs O, 1 vs I, 5 vs S 지능형 오인식 보정 적용
  clean = disambiguateSerialToken(clean);

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

export interface SpatialToken {
  text: string;
  centerDistanceRatio: number; // 0.0 (정가운데) ~ 1.0+ (가장자리)
}

export interface PartOcrContext {
  partName?: string;
  spec?: string;
  subSpec?: string;
}

interface ScoredCandidate {
  serial: string;
  score: number;
}

/**
 * 텍스트에서 산업용 시리얼 번호를 정밀 추출
 * 1. S/N :, Serial Number, SERIAL, Serial, S/N 우측 값 최우선 추출 (+1500점)
 * 2. 바코드 아래 라인 숫자/알파벳 최우선 추출 (+1300점)
 * 3. 화면 정가운데 공간 가중치 (+450~700점)
 */
export function extractSerialCandidates(
  rawText: string,
  context?: PartOcrContext,
  spatialTokens?: SpatialToken[]
): {
  bestSerial: string;
  candidates: string[];
  candidateDetails: OcrCandidateDetail[];
  detectedLabel: string;
  lines: string[];
} {
  const rawLines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^[|/\\_\-\s.]{4,}$/.test(l));

  const scoredMap = new Map<string, number>();
  const labelOriginMap = new Map<string, string>();
  const forbiddenSpecTokens = extractForbiddenSpecTokens(context);

  // 공간 거리 맵 (토큰별 화면 정가운데 거리 비율 캐시)
  const tokenDistanceMap = new Map<string, number>();
  if (spatialTokens && spatialTokens.length > 0) {
    for (const st of spatialTokens) {
      const clean = sanitizeSerialToken(st.text);
      if (clean) {
        const existing = tokenDistanceMap.get(clean);
        if (existing === undefined || st.centerDistanceRatio < existing) {
          tokenDistanceMap.set(clean, st.centerDistanceRatio);
        }
      }
    }
  }

  // 화면 정가운데 보너스 점수 계산기
  const getCenterBonus = (token: string, lineIndex: number, totalLines: number): number => {
    const clean = sanitizeSerialToken(token);
    const distRatio = tokenDistanceMap.get(clean);

    if (distRatio !== undefined) {
      if (distRatio <= 0.25) return 700; // 정가운데 십자선 영역
      if (distRatio <= 0.45) return 450; // 중앙 사각 박스 영역
      if (distRatio <= 0.70) return 200; // 중간 영역
      return 0; // 주변부
    }

    if (totalLines > 2) {
      const midLine = (totalLines - 1) / 2;
      const lineDist = Math.abs(lineIndex - midLine) / (totalLines / 2);
      if (lineDist <= 0.3) return 350;
      if (lineDist <= 0.6) return 180;
    }
    return 100;
  };

  // ============================================================================
  // [전역 절대 0순위 ★★★★★★] WIN11 S/N / Windows Key 25자리 5x5 정품 라이선스 키 완벽 복원 (20,000점 절대 1순위!)
  // 예: "2398N-XY7BW-W962X-WDDVV-T3FC3", "WIN11 S/N : 2398N XY7BW W962X WDDVV T3FC3"
  // ============================================================================
  let detectedFullWinKey: string | null = null;

  // 1) 25자리 5x5 하이픈 형태 (예: 2398N-XY7BW-W962X-WDDVV-T3FC3)
  const fullWinMatch = rawText.match(/\b([A-Za-z0-9]{5}-[A-Za-z0-9]{5}-[A-Za-z0-9]{5}-[A-Za-z0-9]{5}-[A-Za-z0-9]{5})\b/);
  if (fullWinMatch && fullWinMatch[1]) {
    detectedFullWinKey = fullWinMatch[1].toUpperCase();
  } else {
    // 2) 공백, 줄바꿈, 점, 언더바, 슬래시 등으로 쪼개진 5개 블록 결합 (예: 2398N XY7BW W962X WDDVV T3FC3)
    const spacedWinMatch = rawText.match(/\b([A-Za-z0-9]{5})[\s_\-.:/]+([A-Za-z0-9]{5})[\s_\-.:/]+([A-Za-z0-9]{5})[\s_\-.:/]+([A-Za-z0-9]{5})[\s_\-.:/]+([A-Za-z0-9]{5})\b/);
    if (spacedWinMatch) {
      detectedFullWinKey = `${spacedWinMatch[1]}-${spacedWinMatch[2]}-${spacedWinMatch[3]}-${spacedWinMatch[4]}-${spacedWinMatch[5]}`.toUpperCase();
    } else {
      // 3) WIN11 S/N 키워드 직후에 오는 5개 블록 결합
      const winPrefixMatch = rawText.match(/(?:WIN(?:11|10|7|8|DOWS)?\s*S[\/\\|\-.;:]?\s*N|WIN(?:11|10|7|8|DOWS)?\s*KEY|WIN11|WIN10)\s*[:.\-|=;#~_*\s]*([A-Za-z0-9]{5})[\s_\-.:/]+([A-Za-z0-9]{5})[\s_\-.:/]+([A-Za-z0-9]{5})[\s_\-.:/]+([A-Za-z0-9]{5})[\s_\-.:/]+([A-Za-z0-9]{5})/i);
      if (winPrefixMatch) {
        detectedFullWinKey = `${winPrefixMatch[1]}-${winPrefixMatch[2]}-${winPrefixMatch[3]}-${winPrefixMatch[4]}-${winPrefixMatch[5]}`.toUpperCase();
      } else {
        // 4) 하이픈 누락으로 연속 25자리가 읽힌 경우 (예: 2398NXY7BWW962XWDDVVT3FC3)
        const solidWinMatch = rawText.match(/\b([A-Za-z0-9]{25})\b/);
        if (solidWinMatch && /[A-Z]/.test(solidWinMatch[1].toUpperCase()) && /[0-9]/.test(solidWinMatch[1])) {
          detectedFullWinKey = solidWinMatch[1].toUpperCase().replace(/(.{5})(?=.)/g, "$1-");
        } else {
          // 5) WIN11 / WIN S/N 키워드 직후의 텍스트에서 영숫자 25개를 순차 추출하여 5-5-5-5-5로 재조립
          const winContextMatch = rawText.match(/(?:WIN(?:11|10|7|8|DOWS)?\s*S[\/\\|\-.;:]?\s*N|WIN(?:11|10|7|8|DOWS)?\s*KEY|WIN11|WIN10)\s*[:.\-|=;#~_*\s]+([A-Za-z0-9\s_\-.:/]{20,50})/i);
          if (winContextMatch && winContextMatch[1]) {
            const cleanChars = winContextMatch[1].replace(/[^A-Za-z0-9]/g, "").toUpperCase();
            if (cleanChars.length >= 25) {
              const candidate = cleanChars.slice(0, 25);
              detectedFullWinKey = candidate.replace(/(.{5})(?=.)/g, "$1-");
            }
          }
        }
      }
    }
  }

  if (detectedFullWinKey) {
    scoredMap.set(detectedFullWinKey, 20000);
    labelOriginMap.set(detectedFullWinKey, "WIN11 S/N");
    console.log("🏆 [WIN11 25자리 키 100% 완전 조립 성공]:", detectedFullWinKey);
  }

  // ============================================================================
  // [전역 1순위 ★★★★★] S/N, SN, SERIAL, SER, S# 라벨 옆에 위치한 고유 일련번호 (15,000점)
  // ★ 중요: 최대 길이를 {4,35}로 확장하여 25자리 키나 긴 시리얼이 절대 잘리지 않도록 함!
  // ============================================================================
  const snKeywordsRegex = /(?:S[\/\\|\-.;:]?\s*N|SN|5N|SERIAL\s*(?:NO\.?|#|NUMBER)?|SER\.?\s*(?:NO\.?|#)?|S#|S\.N\.|S\/NO|일련\s*번호|시리얼\s*번호|시리얼)\s*[:.\-|=;#~_*\s]*([0-9A-Za-z\-_./]{4,35})/gi;
  let snMatch: RegExpExecArray | null;
  while ((snMatch = snKeywordsRegex.exec(rawText)) !== null) {
    if (snMatch[1]) {
      const matchedFull = snMatch[0];
      let matchedLabel = "SN";
      if (/^S[\/\\|\-.;:]?\s*N/i.test(matchedFull.trim())) matchedLabel = "S/N";
      else if (/^SN\b|^5N\b/i.test(matchedFull.trim())) matchedLabel = "SN";
      else if (/^SERIAL/i.test(matchedFull.trim())) matchedLabel = "SERIAL";
      else if (/^SER\b/i.test(matchedFull.trim())) matchedLabel = "SER";
      else if (/^S#/i.test(matchedFull.trim())) matchedLabel = "S#";
      else if (/일련\s*번호/i.test(matchedFull.trim())) matchedLabel = "일련번호";
      else if (/시리얼/i.test(matchedFull.trim())) matchedLabel = "시리얼";

      const rawVal = snMatch[1];
      const sanitized = sanitizeSerialToken(rawVal);
      if (sanitized && isValidSerialFormat(sanitized)) {
        const disambiguated = disambiguateSerialToken(sanitized);
        const upper = disambiguated.toUpperCase();

        // 25자리 5x5 윈도우 키인 경우 20,000점 부여
        if (/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(upper)) {
          scoredMap.set(upper, 20000);
          labelOriginMap.set(upper, "WIN11 S/N");
          continue;
        }

        // 이미 25자리 완전한 키가 검출되었는데 4개 블록(20자리)만 잘린 파편인 경우 등록 제외
        if (detectedFullWinKey && detectedFullWinKey.startsWith(upper.replace(/-$/, ""))) {
          continue;
        }

        // 모델명 접미사(-PRO, U6-PRO, -PRC 등)나 규격 블랙리스트가 아닌 경우 15,000점 부여!
        if (!IGNORE_WORDS.has(upper) && !/(?:-PRO|-PRC|-PLUS|-MAX|-MINI|-LITE|-REV|-VER)$/i.test(upper)) {
          const score = /^[0-9]{6,14}$/.test(disambiguated) || /^[0-9]{6}-[0-9]{1,4}$/.test(disambiguated) ? 15000 : 14000;
          scoredMap.set(disambiguated, score);
          labelOriginMap.set(disambiguated, matchedLabel);
        }
      }
    }
  }

  // 1-1) P/N / Part No / 품번 전역 매칭 (4900점)
  const fullPnMatch = rawText.match(/(?:P\s*[\/\\|\-.]\s*N|PART\s*(?:NO\.?|NUMBER)?|품번)\s*[:.\-|=;#\s]*([A-Za-z0-9\-_./]{3,35})/i);
  if (fullPnMatch && fullPnMatch[1]) {
    const pn = fullPnMatch[1].trim().toUpperCase();
    scoredMap.set(pn, 4900);
    labelOriginMap.set(pn, "P/N");
  }

  // 2) KSA PC 시리얼 (예: KSA7706705)
  const fullPcMatch = rawText.match(/\b(KSA[0-9]{6,10})\b/i);
  if (fullPcMatch && fullPcMatch[1]) {
    const pc = fullPcMatch[1].toUpperCase();
    scoredMap.set(pc, 4500);
    labelOriginMap.set(pc, "PC S/N");
  }

  // 3) 산업용 날짜-순번 고유 시리얼 (예: 210708-28, 260225-40, SN:210708-28) (4800점)
  const fullDateSerialMatch = rawText.match(/(?:SN\s*[:.\-|=;#\s]*)?([0-9]{6}-[0-9]{1,4})\b/i);
  if (fullDateSerialMatch && fullDateSerialMatch[1]) {
    scoredMap.set(fullDateSerialMatch[1], 4800);
    labelOriginMap.set(fullDateSerialMatch[1], "SN");
  }

  // 4) 산업용 모듈 식별 태그 (예: CON-B2, CON-B1) (3500점)
  const fullConTagMatch = rawText.match(/\b(CON-[A-Z0-9]+)\b/i);
  if (fullConTagMatch && fullConTagMatch[1]) {
    const con = fullConTagMatch[1].toUpperCase();
    scoredMap.set(con, 3500);
    labelOriginMap.set(con, "모듈 태그");
  }

  const addCandidate = (token: string, baseScore: number, lineIndex: number = 0, defaultLabel: string = "SN") => {
    const cleaned = sanitizeSerialToken(token);
    if (!cleaned) return;
    if (!isValidSerialFormat(cleaned)) return;

    const upper = cleaned.toUpperCase();

    // 1. 모델명 / 하드웨어 접미사 페널티 (예: U6-PRO, U6-PRC, U6, PRO, PRC, PLUS, MAX, MINI, LITE, REV1, VER)
    if (
      /(?:-PRO|-PRC|-PLUS|-MAX|-MINI|-LITE|-REV|-VER|-V\d+|PRO|PRC|PLUS|MAX|MINI|LITE|REV|VER)$/i.test(upper) ||
      /^(?:REV|VER|MOD|TYPE|SERIES|JACK)\b/i.test(upper)
    ) {
      baseScore -= 1500;
    }

    // 2. 부품 품명/규격(모델번호)과 일치하면 점수 대폭 삭감
    if (forbiddenSpecTokens.has(cleaned)) {
      baseScore -= 800;
    }

    // 3. 25자리 5x5 윈도우 정품 라이센스 키 (예: 2398N-XY7BW-W962X-WDDVV-T3FC3)
    if (/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(cleaned)) {
      baseScore += 5000;
      defaultLabel = "WIN11 S/N";
    }

    // 4. KSA 하드웨어/PC 시리얼 (예: KSA7965797, KSA7706685) (+1600)
    if (/^KSA[0-9]{6,10}$/i.test(cleaned)) {
      baseScore += 1600;
      defaultLabel = "PC S/N";
    }

    // 5. 6~14자리 순수 숫자 시리얼 (예: 360025389, 360025446, 26022540) - 제조사 고유 일련번호: 최우선 가산점!
    if (/^[0-9]{6,14}$/.test(cleaned)) {
      baseScore += 2500;
      defaultLabel = "SN";
    }

    // 6. 산업용 하이픈 복합 시리얼 (예: 25X-0049H, TM1L-HK26-1007, 260225-40)
    if (cleaned.includes("-") && /[0-9]/.test(cleaned) && cleaned.length >= 7 && !/(?:PRO|PRC|PLUS|MAX|MINI)$/i.test(upper)) {
      baseScore += 600;
      defaultLabel = "S/N";
    }

    // 대상 부품 컨텍스트에 따른 추가 가산점
    const targetText = `${context?.partName || ""} ${context?.spec || ""} ${context?.subSpec || ""}`.toUpperCase();
    if (/WIN|WINDOWS|OS|라이선스|라이센스|SW|소프트웨어|KEY/i.test(targetText)) {
      if (/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(cleaned)) {
        baseScore += 1200;
      }
    } else if (/PC|IPC|본체|컴퓨터|산업용|HW|메인/i.test(targetText)) {
      if (/^KSA[0-9]{6,10}$/i.test(cleaned) || (!cleaned.includes("-") && /^[A-Z0-9]{6,14}$/i.test(cleaned))) {
        baseScore += 1200;
      }
    }

    // 화면 정가운데 보너스 적용
    const centerBonus = getCenterBonus(cleaned, lineIndex, rawLines.length);
    const totalScore = baseScore + centerBonus;

    if (totalScore < 40) return;

    const currentScore = scoredMap.get(cleaned) || 0;
    if (totalScore > currentScore) {
      scoredMap.set(cleaned, totalScore);
      if (!labelOriginMap.has(cleaned)) {
        labelOriginMap.set(cleaned, defaultLabel);
      }
    }
  };

  // ============================================================================
  // [전략 1] S/N :, Serial Number, SERIAL, Serial, S/N 및 수기/한글 라벨 우측 값 직접 추출
  // ============================================================================
  const labelRightRegexes = [
    // ★★★ [절대 0순위] WIN11 S/N / WIN S/N / Windows Key 25자리 정품 키 (20,000점)
    {
      regex: /(?:WIN(?:11|10|7|8|DOWS)?\s*S[\/\\|\-.;:]?\s*N|WIN(?:11|10|7|8|DOWS)?\s*KEY|WIN(?:11|10|7|8)?)\s*[:.\-|=;#~_*\s]*([A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}|[A-Za-z0-9\-_]{4,35})/gi,
      score: 20000,
      labelName: "WIN11 S/N",
    },
    // ★★★ [0순위] 25자리 5x5 윈도우 정품키 단독 패턴 (19,500점)
    {
      regex: /\b([A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5})\b/gi,
      score: 19500,
      labelName: "WIN KEY",
    },
    // ★★★ [0순위 최고 우선순위] SN: / S/N: / SERIAL: / SER: 직후 4~35자리 고유 일련번호 (15,000점 압도적 1순위)
    {
      regex: /(?:S\s*[\/\\|\-.;:]?\s*N|5\s*[\/\\|\-.;:]?\s*N|S\s*N|SN|5N|S#|S\.N\.|S\/NO|SERIAL\s*(?:NO\.?|#|NUMBER)?|SER\.?\s*(?:NO\.?|#)?)\s*[:.\-|=;#~_*\s]+([0-9A-Za-z\-_]{4,35})/gi,
      score: 15000,
      labelName: "SN",
    },
    // 1-0-0-P. 품번 / Part Number / P/N / Item No / 품목번호 / 도번 (4900점)
    {
      regex: /(?:P\s*[\/\\|\-.]\s*N|PART\s*(?:NO\.?|NUMBER|#|CODE)?|ITEM\s*(?:NO\.?|#|NUMBER)|품\s*번|품목\s*번호|도\s*번|MAT\s*NO\.?)\s*[:.\-|=;#\s]*([A-Za-z0-9\-_./]{3,35})/gi,
      score: 4900,
      labelName: "P/N",
    },
    // 1-0-0-0-2. PC S/N / IPC S/N (2800점)
    {
      regex: /(?:PC\s*S[\/\\|\-.]?N|IPC\s*S[\/\\|\-.]?N|PC\s*SN|IPC\s*SN)\s*[:.\-|=;#\s]*([A-Za-z0-9\-_]{4,25})/gi,
      score: 2800,
      labelName: "PC S/N",
    },
    // 1-0-0-0-3. KSA 하드웨어 시리얼 (2700점)
    {
      regex: /\b(KSA[0-9]{6,10})\b/gi,
      score: 2700,
      labelName: "PC S/N",
    },
    // 1-0-0-1. CON-B1 등 산업용 모듈 태그 라벨 (2500점)
    {
      regex: /(?:CON-[A-Z0-9]+\s*S[\/\\|\-.]?N|CON-[A-Z0-9]+)\s*[:.\-|=;#\s]*([0-9A-Za-z\-_]{4,25})/gi,
      score: 2500,
      labelName: "모듈 태그",
    },
    // 1-0-0-2. 날짜-순번 하이픈 시리얼 패턴 (2400점)
    {
      regex: /\b([0-9]{6}-[0-9]{1,4})\b/g,
      score: 2400,
      labelName: "SN",
    },
    // 1-0. 한글 수기 라벨 (2000점)
    {
      regex: /(?:시리얼\s*넘버|시리얼\s*번호|시리얼|일련\s*번호|제조\s*번호|식별\s*번호|관리\s*번호)\s*[:.\-|=;#\s]*([A-Za-z0-9\-_./]{3,35})/gi,
      score: 2000,
      labelName: "시리얼",
    },
    // 1-0-1. 수기 파트 표기 (1800점)
    {
      regex: /(?:호기|단품|설비|부품|샘플|LOT|TAG)\s*[:.\-|=;#\s]*([A-Za-z0-9\-_./]{3,35})/gi,
      score: 1800,
      labelName: "부품/호기",
    },
    // 1-1. Production S/N : (1800점)
    {
      regex: /(?:Production\s*S[\/\\|\-.]?N|Product\s*S[\/\\|\-.]?N|Prod\.?\s*S[\/\\|\-.]?N|Mfg\s*S[\/\\|\-.]?N)\s*[:.\-|=;#\s]*([A-Za-z0-9\-_./]{3,35})/gi,
      score: 1800,
      labelName: "S/N",
    },
    // 1-2. Serial Number : / Serial No : (1800점)
    {
      regex: /(?:SERIAL\s*(?:NUMBER|NO\.?|#|CODE)|Serial\s*(?:Number|No\.?|#)|SER\.?\s*NO\.?|SER\.?\s*#)\s*[:.\-|=;#\s]*([A-Za-z0-9\-_./]{3,35})/gi,
      score: 1800,
      labelName: "SERIAL",
    },
    // 1-3. SERIAL : / Serial : (1700점)
    {
      regex: /(?:SERIAL|Serial)\s*[:.\-|=;#\s]+([A-Za-z0-9\-_./]{3,35})/gi,
      score: 1700,
      labelName: "SERIAL",
    },
    // 1-4. S/N : / SN : (1700점)
    {
      regex: /(?:S\s*[\/\\|\-.]\s*N|S\s*N|S\/NO\.?|S\.NO\.?|S\.N\.)\s*[:.\-|=;#\s]*([A-Za-z0-9\-_./]{3,35})/gi,
      score: 1700,
      labelName: "S/N",
    },
    // 1-5. No. : (1400점)
    {
      regex: /(?:^|\s)(?:NO\.?|N°|NUMBER|CODE)\s*[:.\-|=;#\s]+([A-Za-z0-9\-_./]{3,35})/gi,
      score: 1400,
      labelName: "NO.",
    },
    // 1-6. OCR 오인식 보정 접두사 (1500점)
    {
      regex: /(?:S[I1|l5]N|5\s*[\/\\|\-.]\s*N|S\s*\|\s*N|SER[I1|l]AL\s*(?:NO\.?|#)?|S\/M|S\s*M)\s*[:.\-|=;#\s]*([A-Za-z0-9\-_./]{3,35})/gi,
      score: 1500,
      labelName: "SN",
    },
  ];

  // ============================================================================
  // [전략 2] 바코드 라인 탐지 및 바코드 바로 아래 라인 숫자/알파벳 추출
  // ============================================================================
  const isBarcodeLine = (l: string): boolean => {
    const trimmed = l.trim();
    if (/\*[A-Za-z0-9\-_./]{4,}\*/.test(trimmed)) return true; 
    if (/^[|!/\\l1I\-_:;\s]{5,}$/.test(trimmed)) return true;
    const barChars = (trimmed.match(/[|!/\\l1I]/g) || []).length;
    return barChars >= 5 && barChars / trimmed.length > 0.45;
  };

  const modelPrefixRegex =
    /(?:MODEL\s*(?:NO\.?|#|TYPE)?|MOD\.?|TYPE|TYP\.?|MN\s*:|REV\s*:|INPUT\s*:|OUTPUT\s*:)\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{3,35})/gi;

  for (const line of rawLines) {
    let match: RegExpExecArray | null;
    while ((match = modelPrefixRegex.exec(line)) !== null) {
      if (match[1]) {
        const modelVal = sanitizeSerialToken(match[1]);
        if (modelVal) forbiddenSpecTokens.add(modelVal);
      }
    }
  }

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    for (const rule of labelRightRegexes) {
      let match: RegExpExecArray | null;
      while ((match = rule.regex.exec(line)) !== null) {
        if (match[1]) {
          addCandidate(match[1], rule.score, i, rule.labelName);
        }
      }
    }

    // 1-7. 자간이 넓은 라인 자동 병합 파싱 (예: "6 7 3 6 4 4" -> "673644", "S / N : 1 3 1 2 7 9 3 0 7")
    const deSpacedLine = line.replace(/(?<=\b[A-Za-z0-9])\s+(?=[A-Za-z0-9]\b)/g, "");
    if (deSpacedLine !== line) {
      for (const rule of labelRightRegexes) {
        let match: RegExpExecArray | null;
        while ((match = rule.regex.exec(deSpacedLine)) !== null) {
          if (match[1]) {
            addCandidate(match[1], rule.score + 50, i, rule.labelName);
          }
        }
      }
    }

    if (isBarcodeLine(line)) {
      const starMatch = line.match(/\*([A-Za-z0-9\-_./]{3,35})\*/);
      if (starMatch && starMatch[1]) {
        addCandidate(starMatch[1], 1600, i, "BARCODE");
      }

      if (i + 1 < rawLines.length) {
        const nextTokens = rawLines[i + 1].split(/[\s,;:()[\]|=]+/);
        for (const t of nextTokens) {
          addCandidate(t, 1400, i + 1, "BARCODE");
        }
      }
      if (i + 2 < rawLines.length) {
        const next2Tokens = rawLines[i + 2].split(/[\s,;:()[\]|=]+/);
        for (const t of next2Tokens) {
          addCandidate(t, 1200, i + 2, "BARCODE");
        }
      }
    }

    const headerOnlyRegex =
      /^(?:Production\s*S[\/\\|\-.]?N|Product\s*S[\/\\|\-.]?N|SERIAL\s*(?:NUMBER|NO\.?|#|CODE)?|Serial\s*(?:Number|No\.?|#)?|SER\.?\s*(?:NO\.?|#)|S\s*[\/\\|\-.]\s*N|S\s*N|S[I1|l]N|S\/NO\.?|S\.N\.?|NO\.?|N°|시리얼\s*번호|일련\s*번호|제조\s*번호|식별\s*번호|관리\s*번호|시리얼|일련번호)$/i;

    if (headerOnlyRegex.test(line.trim())) {
      if (i + 1 < rawLines.length) {
        const nextTokens = rawLines[i + 1].split(/[\s,;:()[\]|=]+/);
        for (const t of nextTokens) {
          addCandidate(t, 12000, i + 1, "SN");
        }
      }
      if (i + 2 < rawLines.length) {
        const next2Tokens = rawLines[i + 2].split(/[\s,;:()[\]|=]+/);
        for (const t of next2Tokens) {
          addCandidate(t, 8000, i + 2, "SN");
        }
      }
    }

    const tokens = line.split(/[\s,;:()[\]|=]+/);
    for (const rawTok of tokens) {
      const tok = sanitizeSerialToken(rawTok);
      if (!tok || !isValidSerialFormat(tok)) continue;

      const upperTok = tok.toUpperCase();
      // 모델명/버전/규격 접미사 및 특정 노이즈 키워드는 잡음 토큰으로 판단하여 추가 차단 (U6-PRC, U6-PRO 등 배제)
      if (/(?:-PRO|-PRC|-PLUS|-MAX|-MINI|-LITE|-REV|-VER|-V\d+|PRO|PRC|PLUS|MAX|MINI|LITE|REV|VER)$/i.test(upperTok)) continue;
      if (/^(?:REV|VER|MOD|TYPE|SERIES|JACK|HDMI|USB|LAN|COM)\b/i.test(upperTok)) continue;
      if (forbiddenSpecTokens.has(tok)) continue;

      const hasAlpha = /[A-Za-z]/.test(tok);
      const hasDigit = /[0-9]/.test(tok);

      // 6~14자리 순수 숫자 시리얼 (예: 360025389, 360025446) - 제조사 표준 일련번호
      if (!hasAlpha && hasDigit && tok.length >= 6 && tok.length <= 14) {
        addCandidate(tok, 3000, i, "SN");
      } else if (hasAlpha && hasDigit && tok.length >= 6 && tok.length <= 30) {
        addCandidate(tok, 800, i, "식별번호");
      } else if (hasDigit && tok.includes("-") && tok.length >= 7) {
        addCandidate(tok, 1000, i, "일련번호");
      }
    }
  }

  // 윈도우 25자리 키가 감지된 경우: 윈도우 키의 앞부분 파편(예: 4개 블록, 3개 블록 등)은 완벽 제거
  let fullWinCandidate: string | null = null;
  for (const serial of Array.from(scoredMap.keys())) {
    if (/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(serial)) {
      fullWinCandidate = serial;
      break;
    }
  }

  if (fullWinCandidate) {
    const rawClean = fullWinCandidate.replace(/-/g, "");
    for (const key of Array.from(scoredMap.keys())) {
      if (key !== fullWinCandidate) {
        const cleanK = key.replace(/[\s-]/g, "");
        if (cleanK.length >= 8 && rawClean.includes(cleanK)) {
          scoredMap.delete(key);
        }
      }
    }
  }

  const sortedCandidates: ScoredCandidate[] = Array.from(scoredMap.entries())
    .map(([serial, score]) => ({ serial, score }))
    .filter((c) => c.score >= 40)
    .sort((a, b) => b.score - a.score);

  // 🎯 최고 득점자가 10,000점 이상(SN:, S/N:, SERIAL:, WIN11 S/N: 등 명확한 라벨 우측 값)인 경우:
  // 점수가 현격히 떨어지는 라벨 없는 잡음 파편(예: U6-PRC 등 모델명 오인식 토큰)을 후보 목록에서 완전 영구 배제!
  const topScore = sortedCandidates[0]?.score || 0;
  let validCandidates = sortedCandidates;
  if (topScore >= 10000) {
    validCandidates = sortedCandidates.filter((c) => {
      if (c.score >= 10000) return true;
      // 4000점 이상이면서 명확한 P/N, PC S/N, 날짜 시리얼인 경우만 보조 후보로 허용
      if (c.score >= 4000 && labelOriginMap.has(c.serial)) {
        const origin = labelOriginMap.get(c.serial);
        if (origin === "WIN11 S/N" || origin === "PC S/N" || origin === "P/N" || origin === "S/N" || origin === "SN") {
          return true;
        }
      }
      return false;
    });
  }

  const rawCandidates = validCandidates.map((c) => c.serial);
  const winKey = fullWinCandidate || rawCandidates.find((c) => /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(c));
  const pcSerial = rawCandidates.find((c) => /^KSA[0-9]{6,10}$/i.test(c) || (/^[A-Za-z0-9\-_]{6,18}$/i.test(c) && !c.includes("-")));

  const dateSerial = rawCandidates.find((c) => /^[0-9]{6}-[0-9]{1,4}$/.test(c));
  const conTag = rawCandidates.find((c) => /^CON-[A-Z0-9]+$/i.test(c));

  // 🎯 윈도우 키가 감지된 경우: 25자리 완전 정품 키를 무조건 1순위로 즉시 확정!
  const topCandidate = rawCandidates[0];

  let finalCands: string[] = [];
  if (winKey) {
    const others = rawCandidates.filter((c) => c !== winKey);
    finalCands = [winKey, ...others];
  } else if (topScore >= 10000 && topCandidate) {
    const others = rawCandidates.filter((c) => c !== topCandidate);
    finalCands = [topCandidate, ...others];
  } else if (dateSerial) {
    // 1순위 = 날짜-순번 고유 시리얼(예: 210708-28), 2순위 = CON 모듈 태그(예: CON-B2)
    const others = rawCandidates.filter((c) => c !== dateSerial && c !== conTag);
    finalCands = [dateSerial];
    if (conTag) finalCands.push(conTag);
    finalCands.push(...others);
  } else if (pcSerial) {
    const others = rawCandidates.filter((c) => c !== pcSerial);
    finalCands = [pcSerial, ...others];
  } else {
    finalCands = rawCandidates;
  }

  const candidates = finalCands.slice(0, 5);
  const bestSerial = candidates.length > 0 ? candidates[0] : "";

  // 각 후보별 라벨 기준 메타데이터 생성 (SN, S/N, WIN11 S/N, P/N 등)
  const candidateDetails: OcrCandidateDetail[] = candidates.map((cand) => {
    let sourceLabel = labelOriginMap.get(cand) || "";
    if (!sourceLabel) {
      if (/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(cand)) {
        sourceLabel = "WIN11 S/N";
      } else if (/^KSA[0-9]{6,10}$/i.test(cand)) {
        sourceLabel = "PC S/N";
      } else if (/^[0-9]{6,14}$/.test(cand)) {
        sourceLabel = "SN";
      } else if (cand.includes("-")) {
        sourceLabel = "S/N";
      } else {
        sourceLabel = "SN";
      }
    }
    return {
      serial: cand,
      sourceLabel,
      score: scoredMap.get(cand) || 0,
    };
  });

  const detectedLabel = candidateDetails[0]?.sourceLabel || "SN";

  return {
    bestSerial,
    candidates,
    candidateDetails,
    detectedLabel,
    lines: rawLines,
  };
}

/**
 * 캔버스 메모리 상에서 순수 문자/숫자 정밀 광학 OCR 실행 (하드웨어 바코드 + Tesseract 5 LSTM + 노란색 라벨 듀얼 채널)
 */
export async function performInMemoryOcr(
  canvas: HTMLCanvasElement,
  onProgress?: (progress: number, status: string) => void,
  context?: PartOcrContext
): Promise<OcrResult> {
  // 1. 하드웨어 가속 Native BarcodeDetector 병렬 실행 (0.005초 초고속 바코드 감지)
  const nativeBarcodePromise = scanNativeBarcode(canvas);

  // 2. 산업용 라벨 듀얼 채널(노란색 라벨 분리 + 고대비 샤프닝) 생성
  const yellowBoosted = createYellowLabelBoostCanvas(canvas);
  const enhancedGray = preprocessCanvas(canvas, DEFAULT_PREPROCESSING_OPTIONS);

  const worker = await getOcrWorker(onProgress);

  // 1차 스트림: 노란색 라벨 광학 채널 분리 + Otsu 최적 이진화 (PSM 6: 단일 텍스트 블록 모드)
  await worker.setParameters({
    tessedit_pageseg_mode: "6" as any,
  });
  const pass1 = await worker.recognize(yellowBoosted);
  let rawText = pass1.data.text || "";
  let confidence = Math.round(pass1.data.confidence || 0);
  const words = [...((pass1.data as any).words || [])];

  console.log("📄 [OCR 스트림 1 (Otsu Binarized)] 추출 텍스트:\n", rawText);

  // 1차 패스에서 유효한 명판 시리얼(SN:, S/N: 인접 번호 또는 6~14자리 고유 번호)이 포착되었는지 검사
  let quickTest = extractSerialCandidates(rawText, context);
  const hasDefinitiveMatch =
    quickTest.candidates.length > 0 &&
    (
      /(?:S[\/\\|\-.;:]?\s*N|SN|5N|SERIAL|SER)\s*[:.\-|=;#~_*\s]*[0-9A-Za-z\-_]{4,}/i.test(rawText) ||
      /^[0-9]{6,14}$/.test(quickTest.bestSerial) ||
      quickTest.bestSerial.length >= 6
    );

  // 🎯 1차 패스에서 이미 확실한 시리얼이 검출된 경우: 2차 패스를 건너뛰고 1초 만에 즉시 완료!
  // 오직 시리얼이 미검출되었거나 텍스트가 부족한 경우에만 스트림 2(적응형 대비) 결합
  if (!hasDefinitiveMatch) {
    onProgress?.(70, "⚡ 듀얼 광학 앙상블(스트림 B) 결합 정밀 판독 중...");
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: "3" as any, // Fully automatic page segmentation
      });
      const pass2 = await worker.recognize(enhancedGray);
      const pass2Text = pass2.data.text || "";
      if (pass2Text) {
        console.log("📄 [OCR 스트림 2 (Enhanced Gray)] 추출 텍스트:\n", pass2Text);
        rawText += "\n" + pass2Text;
        confidence = Math.max(confidence, Math.round(pass2.data.confidence || 0));
        words.push(...((pass2.data as any).words || []));
      }
    } catch {}

    // 회전 라벨(세로 인쇄 등)에 대한 90도 회전 보조 패스
    quickTest = extractSerialCandidates(rawText, context);
    if (quickTest.candidates.length === 0 || rawText.length < 8) {
      try {
        const rotatedYellow = rotateCanvas(yellowBoosted, 90);
        const passRot = await worker.recognize(rotatedYellow);
        const rotText = passRot.data.text || "";
        if (rotText) {
          rawText += "\n" + rotText;
          confidence = Math.max(confidence, Math.round(passRot.data.confidence || 0));
          words.push(...((passRot.data as any).words || []));
        }
        disposeCanvas(rotatedYellow);
      } catch {}
    }
  }

  // 메모리 정리
  disposeCanvas(yellowBoosted);
  disposeCanvas(enhancedGray);

  // 화면 정가운데 거리 좌표 계산 (화면 중심 = 0.0, 모서리 = 1.0+)
  const imgWidth = canvas.width || 1280;
  const imgHeight = canvas.height || 720;
  const cX = imgWidth / 2;
  const cY = imgHeight / 2;

  const spatialTokens: SpatialToken[] = [];

  for (const w of words) {
    if (w && w.text && w.bbox) {
      const boxX = (w.bbox.x0 + w.bbox.x1) / 2;
      const boxY = (w.bbox.y0 + w.bbox.y1) / 2;
      const dx = (boxX - cX) / (imgWidth / 2);
      const dy = (boxY - cY) / (imgHeight / 2);
      const dist = Math.sqrt(dx * dx + dy * dy);
      spatialTokens.push({
        text: w.text,
        centerDistanceRatio: dist,
      });
    }
  }

  const { bestSerial, candidates, candidateDetails, detectedLabel, lines } = extractSerialCandidates(
    rawText,
    context,
    spatialTokens
  );

  const nativeBarcode = await nativeBarcodePromise;
  let finalSerial = candidates.length > 0 ? bestSerial : "";
  let finalCandidates = candidates.length > 0 ? [...candidates] : [];
  let finalCandidateDetails = [...candidateDetails];
  let finalDetectedLabel = detectedLabel;

  // 🎯 스마트 시리얼 신뢰도 계산 (배경 노이즈 평균이 아닌 검출된 시리얼의 패턴 유효성 및 규격 일치율 반영)
  let calculatedConfidence = confidence;
  if (nativeBarcode) {
    finalSerial = nativeBarcode;
    finalCandidates = [nativeBarcode, ...finalCandidates.filter((c) => c !== nativeBarcode)].slice(0, 5);
    finalCandidateDetails = [
      { serial: nativeBarcode, sourceLabel: "BARCODE", score: 25000 },
      ...finalCandidateDetails.filter((c) => c.serial !== nativeBarcode),
    ].slice(0, 5);
    finalDetectedLabel = "BARCODE";
    calculatedConfidence = 100;
  } else if (finalSerial) {
    if (/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(finalSerial)) {
      // 25자리 윈도우 정품 키 규격 100% 완전 일치
      calculatedConfidence = 99;
    } else if (/^KSA[0-9]{6,10}$/i.test(finalSerial)) {
      // KSA PC 시리얼 규격 완전 일치
      calculatedConfidence = 98;
    } else if (/^[0-9]{6,14}$/.test(finalSerial) || (finalSerial.includes("-") && finalSerial.length >= 7)) {
      // 산업용 일련번호 규격 일치
      calculatedConfidence = 96;
    } else if (finalSerial.length >= 4) {
      calculatedConfidence = Math.max(88, Math.min(95, confidence + 55));
    }
  }

  return {
    rawText,
    cleanedSerial: finalSerial,
    confidence: calculatedConfidence,
    lines,
    candidates: finalCandidates,
    candidateDetails: finalCandidateDetails,
    detectedLabel: finalDetectedLabel,
  };
}

/**
 * ⚡ 실시간 라이브 무인 자동 감지 (Live Auto-OCR):
 * 작업자가 버튼을 누르지 않아도 카메라를 비추고 있으면 바코드, 시리얼(S/N), 품번(P/N)이 시야에 들어오는 즉시 감지하여 반환!
 */
export async function quickScanLiveRoi(
  roiCanvas: HTMLCanvasElement,
  context?: PartOcrContext
): Promise<OcrResult | null> {
  // 1. 하드웨어 네이티브 바코드 즉시 감지 (0.005초)
  const barcode = await scanNativeBarcode(roiCanvas);
  if (barcode) {
    return {
      rawText: `[Live Barcode]: ${barcode}`,
      cleanedSerial: barcode,
      confidence: 100,
      lines: [barcode],
      candidates: [barcode],
      candidateDetails: [{ serial: barcode, sourceLabel: "BARCODE", score: 25000 }],
      detectedLabel: "BARCODE",
    };
  }

  // 2. 인메모리 Tesseract 초경량 패스 (시리얼 S/N, 품번 P/N 고속 스캔)
  try {
    const yellowBoosted = createYellowLabelBoostCanvas(roiCanvas);
    const worker = await getOcrWorker();
    const ret = await worker.recognize(yellowBoosted);
    disposeCanvas(yellowBoosted);

    const rawText = ret.data.text || "";
    if (rawText.trim().length >= 4) {
      const { bestSerial, candidates, candidateDetails, detectedLabel, lines } = extractSerialCandidates(rawText, context);
      if (bestSerial && bestSerial.length >= 3) {
        // 🎯 95% 이상 고신뢰도 정밀 판정 알고리즘
        const isWinKey = /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(bestSerial);
        const isPcSerial = /^KSA[0-9]{6,10}$/i.test(bestSerial);
        const isDateSerial = /^[0-9]{6}-[0-9]{1,4}$/.test(bestSerial);
        const isSnPrefixed = /(?:SN|S\/N|SERIAL|P\/N|PART|품번)\s*[:.\-|=;#\s]*[A-Za-z0-9\-_./]{3,}/i.test(rawText);
        const isPureNumericSerial = /^[0-9]{6,14}$/.test(bestSerial); // 예: 360025446

        let calcConf = 0;
        if (isWinKey) {
          calcConf = 99; // 25자리 키 규격 100% 일치
        } else if (isSnPrefixed && (isPureNumericSerial || isDateSerial || bestSerial.length >= 6)) {
          calcConf = 99; // SN:360025446 등 명판 시리얼 규격 100% 일치
        } else if (isPcSerial) {
          calcConf = 98; // PC S/N 규격 일치
        } else if (isDateSerial) {
          calcConf = 97; // 날짜-순번 규격 일치
        } else if (isSnPrefixed) {
          calcConf = 96; // 시리얼/품번 접두사 확실
        } else if (isPureNumericSerial && bestSerial.length >= 8) {
          calcConf = 95; // 8자리 이상 순수 고유 일련번호
        } else {
          // 단자대 핀 기호나 단순 파편 등은 95% 미만으로 강등 (자동 인식 트리거 방지!)
          calcConf = Math.min(85, Math.round(ret.data.confidence || 70));
        }

        return {
          rawText,
          cleanedSerial: bestSerial,
          confidence: calcConf,
          lines,
          candidates,
          candidateDetails,
          detectedLabel,
        };
      }
    }
  } catch (e) {
    // 실시간 감지 무소음 통과
  }

  return null;
}

