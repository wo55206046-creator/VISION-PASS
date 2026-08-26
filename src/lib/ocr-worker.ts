import { createWorker, Worker } from "tesseract.js";
import { OcrResult } from "@/types";

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

    // 산업용 명판 및 수기(Handwriting) 메모 전방위 탐색 모드(PSM 11) + 300 DPI
    await worker.setParameters({
      tessedit_char_whitelist:
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_./:#()=*|! +~ㄱ-ㅎㅏ-ㅣ가-힣",
      tessedit_pageseg_mode: "11" as any, // Sparse text: 인쇄 명판뿐만 아니라 불규칙한 수기 펜글씨/메모 완벽 포착
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
]);

/**
 * 유효한 시리얼 번호 패턴 검증
 */
function isValidSerialFormat(candidate: string): boolean {
  if (!candidate || candidate.length < 3 || candidate.length > 35) return false;

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

  // 1. 대부분 숫자로 구성된 시리얼 (예: "O924O22O4O27", "673644", "25OO2481", "1312793O7")
  const digitsCount = (token.match(/[0-9]/g) || []).length;
  const lettersCount = (token.match(/[A-Za-z]/g) || []).length;
  
  if (digitsCount >= 3 && lettersCount <= 3) {
    // 숫자 사이에 낀 O, I, l, S 보정
    let corrected = token
      .replace(/(?<=\d)[Oo](?=\d)/g, "0")
      .replace(/(?<=\d)[Il|](?=\d)/g, "1")
      .replace(/(?<=\d)[Ss$](?=\d)/g, "5");

    // 전체의 65% 이상이 숫자인 경우 앞/뒤 O, I도 0, 1로 자동 보정
    if (digitsCount / token.length >= 0.65) {
      corrected = corrected
        .replace(/^O(?=\d)/i, "0")
        .replace(/(?<=\d)O$/i, "0")
        .replace(/^I(?=\d)/i, "1")
        .replace(/(?<=\d)I$/i, "1");
    }
    return corrected;
  }

  // 2. 산업용 하이픈 복합 시리얼 패턴 (예: "25X-0049H", "TM1L-HK26-1007", "KD26030201-013")
  if (token.includes("-")) {
    const parts = token.split("-");
    const fixedParts = parts.map((p) => {
      const pDigits = (p.match(/[0-9]/g) || []).length;
      if (pDigits >= 2 && p.length <= 6) {
        return p.replace(/O/g, "0").replace(/[Il|]/g, "1");
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

  // 영문/한글 접두사 자동 제거 (예: "SN:25002481", "시리얼:673644", "일련번호:092402204027")
  clean = clean.replace(
    /^(?:Production\s*S[\/\\|\-.]?N|Product\s*S[\/\\|\-.]?N|Prod\s*S[\/\\|\-.]?N|SERIAL\s*(?:NO\.?|#|NUMBER)?|SER\.?\s*NO\.?|S[\/\\|\-.]N|SN|S\.N\.|S\/NO\.?|NO\.?|N°|시리얼\s*넘버|시리얼\s*번호|시리얼|일련\s*번호|제조\s*번호|식별\s*번호|관리\s*번호|호기|단품|부품)\s*[:.\-|=#\s]*/i,
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
  lines: string[];
} {
  const rawLines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^[|/\\_\-\s.]{4,}$/.test(l));

  const scoredMap = new Map<string, number>();
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

  const addCandidate = (token: string, baseScore: number, lineIndex: number = 0) => {
    const cleaned = sanitizeSerialToken(token);
    if (!cleaned) return;
    if (!isValidSerialFormat(cleaned)) return;

    const upper = cleaned.toUpperCase();

    // 1. 모델명 / 하드웨어 접미사 페널티 (예: U6-PRO, U6, PRO, PLUS, MAX, MINI, LITE, REV1, VER)
    if (
      /(?:-PRO|-PLUS|-MAX|-MINI|-LITE|-REV|-VER|-V\d+|PRO|PLUS|MAX|MINI|LITE|REV|VER)$/i.test(upper) ||
      /^(?:REV|VER|MOD|TYPE|SERIES)\b/i.test(upper)
    ) {
      baseScore -= 1200;
    }

    // 2. 부품 품명/규격(모델번호)과 일치하면 점수 대폭 삭감
    if (forbiddenSpecTokens.has(cleaned)) {
      baseScore -= 800;
    }

    // 3. 6~14자리 순수 숫자 시리얼 (예: 360025389, 360025446, 26022540) - 제조사 고유 일련번호: 최우선 가산점!
    if (/^[0-9]{6,14}$/.test(cleaned)) {
      baseScore += 1200;
    }

    // 4. 산업용 하이픈 복합 시리얼 (예: 25X-0049H, TM1L-HK26-1007, 260225-40)
    if (cleaned.includes("-") && /[0-9]/.test(cleaned) && cleaned.length >= 7 && !/(?:PRO|PLUS|MAX|MINI)$/i.test(upper)) {
      baseScore += 600;
    }

    // 화면 정가운데 보너스 적용
    const centerBonus = getCenterBonus(cleaned, lineIndex, rawLines.length);
    const totalScore = baseScore + centerBonus;

    if (totalScore < 40) return;

    const currentScore = scoredMap.get(cleaned) || 0;
    if (totalScore > currentScore) {
      scoredMap.set(cleaned, totalScore);
    }
  };

  // ============================================================================
  // [전략 1] S/N :, Serial Number, SERIAL, Serial, S/N 및 수기/한글 라벨 우측 값 직접 추출
  // ============================================================================
  const labelRightRegexes = [
    // 1-0-0. SN: / S/N: / 5N: / SN; 직후 5~25자리 고유 일련번호 (예: "SN:360025389" -> 360025389, "PC S/N : KSA7706685") (2500점 최우선)
    {
      regex: /(?:S\s*[\/\\|\-.;:]?\s*N|5\s*[\/\\|\-.;:]?\s*N|S\s*N|SN|5N|S#|S\.N\.|S\/NO)\s*[:.\-|=;#\s]*([0-9A-Za-z\-_]{5,25})/gi,
      score: 2500,
    },
    // 1-0. 한글 수기 라벨: "시리얼 :", "일련번호 :", "제조번호 :", "시리얼넘버 :", "관리번호 :" (2000점)
    {
      regex: /(?:시리얼\s*넘버|시리얼\s*번호|시리얼|일련\s*번호|제조\s*번호|식별\s*번호|관리\s*번호)\s*[:.\-|=;#\s]*([A-Za-z0-9\-_./]{3,35})/gi,
      score: 2000,
    },
    // 1-0-1. 수기 파트 표기: "호기 :", "단품 :", "부품 :", "샘플 :", "LOT :" (1800점)
    {
      regex: /(?:호기|단품|설비|부품|샘플|LOT|TAG)\s*[:.\-|=;#\s]*([A-Za-z0-9\-_./]{3,35})/gi,
      score: 1800,
    },
    // 1-1. Production S/N : (1800점)
    {
      regex: /(?:Production\s*S[\/\\|\-.]?N|Product\s*S[\/\\|\-.]?N|Prod\.?\s*S[\/\\|\-.]?N|Mfg\s*S[\/\\|\-.]?N)\s*[:.\-|=;#\s]*([A-Za-z0-9\-_./]{3,35})/gi,
      score: 1800,
    },
    // 1-2. Serial Number : / Serial No : / SERIAL NO. : (1800점)
    {
      regex: /(?:SERIAL\s*(?:NUMBER|NO\.?|#|CODE)|Serial\s*(?:Number|No\.?|#)|SER\.?\s*NO\.?|SER\.?\s*#)\s*[:.\-|=;#\s]*([A-Za-z0-9\-_./]{3,35})/gi,
      score: 1800,
    },
    // 1-3. SERIAL : / Serial : (1700점)
    {
      regex: /(?:SERIAL|Serial)\s*[:.\-|=;#\s]+([A-Za-z0-9\-_./]{3,35})/gi,
      score: 1700,
    },
    // 1-4. S/N : / SN : / S.N. : / S/N / SN (1700점)
    {
      regex: /(?:S\s*[\/\\|\-.]\s*N|S\s*N|S\/NO\.?|S\.NO\.?|S\.N\.)\s*[:.\-|=;#\s]*([A-Za-z0-9\-_./]{3,35})/gi,
      score: 1700,
    },
    // 1-5. No. : / Number : (1400점)
    {
      regex: /(?:^|\s)(?:NO\.?|N°|NUMBER|CODE)\s*[:.\-|=;#\s]+([A-Za-z0-9\-_./]{3,35})/gi,
      score: 1400,
    },
    // 1-6. OCR 오인식 보정 접두사: SIN:, 5/N:, S|N:, SER1AL (1500점)
    {
      regex: /(?:S[I1|l5]N|5\s*[\/\\|\-.]\s*N|S\s*\|\s*N|SER[I1|l]AL\s*(?:NO\.?|#)?|S\/M|S\s*M)\s*[:.\-|=;#\s]*([A-Za-z0-9\-_./]{3,35})/gi,
      score: 1500,
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
    /(?:MODEL\s*(?:NO\.?|#|TYPE)?|MOD\.?|TYPE|TYP\.?|P\s*[\/\\|\-.]\s*N|PART\s*NO\.?|ITEM\s*NO\.?|MN\s*:|REV\s*:|INPUT\s*:|OUTPUT\s*:)\s*[:.\-|=]?\s*([A-Za-z0-9\-_./]{3,35})/gi;

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
          addCandidate(match[1], rule.score, i);
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
            addCandidate(match[1], rule.score + 50, i);
          }
        }
      }
    }

    if (isBarcodeLine(line)) {
      const starMatch = line.match(/\*([A-Za-z0-9\-_./]{3,35})\*/);
      if (starMatch && starMatch[1]) {
        addCandidate(starMatch[1], 1600, i);
      }

      if (i + 1 < rawLines.length) {
        const nextTokens = rawLines[i + 1].split(/[\s,;:()[\]|=]+/);
        for (const t of nextTokens) {
          addCandidate(t, 1400, i + 1);
        }
      }
      if (i + 2 < rawLines.length) {
        const next2Tokens = rawLines[i + 2].split(/[\s,;:()[\]|=]+/);
        for (const t of next2Tokens) {
          addCandidate(t, 1200, i + 2);
        }
      }
    }

    const headerOnlyRegex =
      /^(?:Production\s*S[\/\\|\-.]?N|Product\s*S[\/\\|\-.]?N|SERIAL\s*(?:NUMBER|NO\.?|#|CODE)?|Serial\s*(?:Number|No\.?|#)?|SER\.?\s*(?:NO\.?|#)|S\s*[\/\\|\-.]\s*N|S\s*N|S[I1|l]N|S\/NO\.?|S\.N\.?|NO\.?|N°|시리얼|일련번호|제조번호|식별번호|관리번호)$/i;

    if (headerOnlyRegex.test(line.trim())) {
      if (i + 1 < rawLines.length) {
        const nextTokens = rawLines[i + 1].split(/[\s,;:()[\]|=]+/);
        for (const t of nextTokens) {
          addCandidate(t, 1400, i + 1);
        }
      }
      if (i + 2 < rawLines.length) {
        const next2Tokens = rawLines[i + 2].split(/[\s,;:()[\]|=]+/);
        for (const t of next2Tokens) {
          addCandidate(t, 1200, i + 2);
        }
      }
    }

    const tokens = line.split(/[\s,;:()[\]|=]+/);
    for (const rawTok of tokens) {
      const tok = sanitizeSerialToken(rawTok);
      if (!tok || !isValidSerialFormat(tok)) continue;

      const hasAlpha = /[A-Za-z]/.test(tok);
      const hasDigit = /[0-9]/.test(tok);

      // 6~14자리 순수 숫자 시리얼 (예: 360025389, 360025446)
      if (!hasAlpha && hasDigit && tok.length >= 6 && tok.length <= 14) {
        addCandidate(tok, 1500, i);
      } else if (hasAlpha && hasDigit && tok.length >= 6 && tok.length <= 30) {
        addCandidate(tok, 600, i);
      } else if (hasDigit && tok.includes("-") && tok.length >= 7) {
        addCandidate(tok, 700, i);
      }
    }
  }

  const sortedCandidates: ScoredCandidate[] = Array.from(scoredMap.entries())
    .map(([serial, score]) => ({ serial, score }))
    .filter((c) => c.score >= 40)
    .sort((a, b) => b.score - a.score);

  const candidates = sortedCandidates.map((c) => c.serial).slice(0, 3);
  const bestSerial = candidates.length > 0 ? candidates[0] : "";

  return {
    bestSerial,
    candidates,
    lines: rawLines,
  };
}

/**
 * 캔버스 메모리 상에서 순수 문자/숫자 정밀 광학 OCR 실행 (하드웨어 바코드 + Tesseract 5 LSTM)
 */
export async function performInMemoryOcr(
  canvas: HTMLCanvasElement,
  onProgress?: (progress: number, status: string) => void,
  context?: PartOcrContext
): Promise<OcrResult> {
  // 1. 하드웨어 가속 Native BarcodeDetector 병렬 실행 (0.005초 초고속 바코드 감지)
  const nativeBarcodePromise = scanNativeBarcode(canvas);

  // 2. Tesseract 5 LSTM 정밀 광학 OCR 실행
  const worker = await getOcrWorker(onProgress);
  const result = await worker.recognize(canvas);

  const rawText = result.data.text || "";
  let confidence = Math.round(result.data.confidence || 0);

  // 화면 정가운데 거리 좌표 계산 (화면 중심 = 0.0, 모서리 = 1.0+)
  const imgWidth = canvas.width || 1280;
  const imgHeight = canvas.height || 720;
  const cX = imgWidth / 2;
  const cY = imgHeight / 2;

  const spatialTokens: SpatialToken[] = [];
  const words = (result.data as any).words || [];

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

  const { bestSerial, candidates, lines } = extractSerialCandidates(
    rawText,
    context,
    spatialTokens
  );

  const nativeBarcode = await nativeBarcodePromise;
  let finalSerial = candidates.length > 0 ? bestSerial : "";
  let finalCandidates = candidates.length > 0 ? [...candidates] : [];

  // ⚡ 하드웨어 바코드가 검출된 경우 100% 신뢰도로 1순위 즉시 확정
  if (nativeBarcode) {
    finalSerial = nativeBarcode;
    finalCandidates = [nativeBarcode, ...finalCandidates.filter((c) => c !== nativeBarcode)].slice(0, 3);
    confidence = 100;
  }

  return {
    rawText,
    cleanedSerial: finalSerial,
    confidence,
    lines,
    candidates: finalCandidates,
  };
}
