import { PartItem } from "@/types";
import { generateId } from "./utils";

/**
 * 셀 내부의 줄바꿈(Alt+Enter)을 한 줄 텍스트로 깔끔하게 정리합니다.
 * 하이픈(-)으로 끝나는 줄바꿈은 공백 없이 이어붙이고, 그 외에는 공백 1칸으로 이어붙입니다.
 */
function normalizeCellText(raw: string): string {
  if (!raw) return "";
  const lines = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return "";
  if (lines.length === 1) return lines[0];

  let result = lines[0];
  for (let i = 1; i < lines.length; i++) {
    if (result.endsWith("-")) {
      result += lines[i];
    } else {
      result += " " + lines[i];
    }
  }
  return result.trim();
}

/**
 * 클립보드의 TSV(탭 구분 텍스트)를 파싱하여 엑셀의 따옴표("...") 내부 줄바꿈을 보존한 2차원 행렬로 변환합니다.
 */
export function parseClipboardTsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  const clean = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];

    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else {
      if (ch === '"' && currentCell.length === 0) {
        inQuotes = true;
      } else if (ch === "\t") {
        currentRow.push(normalizeCellText(currentCell));
        currentCell = "";
      } else if (ch === "\n") {
        currentRow.push(normalizeCellText(currentCell));
        rows.push(currentRow);
        currentRow = [];
        currentCell = "";
      } else {
        currentCell += ch;
      }
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(normalizeCellText(currentCell));
    rows.push(currentRow);
  }

  // 모든 셀이 비어있는 빈 행 제거 (엑셀 세로 2행 병합 등으로 생기는 빈 줄 제거)
  return rows.filter((row) => row.some((c) => c && c.trim().length > 0));
}

/**
 * 클립보드의 HTML(<table>) 데이터를 파싱하여 2차원 행렬로 변환합니다.
 */
function parseClipboardHtmlTable(html: string): string[][] | null {
  if (!html || !html.includes("<table") || typeof DOMParser === "undefined") {
    return null;
  }
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = doc.querySelector("table");
    if (!table) return null;

    const trs = Array.from(table.querySelectorAll("tr"));
    if (trs.length === 0) return null;

    const grid: string[][] = [];
    const occupied: boolean[][] = [];

    for (let r = 0; r < trs.length; r++) {
      if (!grid[r]) grid[r] = [];
      if (!occupied[r]) occupied[r] = [];

      const cells = Array.from(trs[r].querySelectorAll("td, th"));
      let colCursor = 0;

      for (const cell of cells) {
        while (occupied[r][colCursor]) {
          colCursor++;
        }

        const clone = cell.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
        const text = normalizeCellText(clone.textContent || "");

        const rowSpan = Math.max(1, parseInt(cell.getAttribute("rowspan") || "1", 10) || 1);
        const colSpan = Math.max(1, parseInt(cell.getAttribute("colspan") || "1", 10) || 1);

        for (let dr = 0; dr < rowSpan; dr++) {
          for (let dc = 0; dc < colSpan; dc++) {
            const nr = r + dr;
            const nc = colCursor + dc;
            if (!grid[nr]) grid[nr] = [];
            if (!occupied[nr]) occupied[nr] = [];
            occupied[nr][nc] = true;
            grid[nr][nc] = dr === 0 && dc === 0 ? text : "";
          }
        }

        colCursor += colSpan;
      }
    }

    const nonEmptyRows = grid.filter((row) => row && row.some((c) => c && c.trim().length > 0));
    return nonEmptyRows.length > 0 ? nonEmptyRows : null;
  } catch {
    return null;
  }
}

export type PasteColumnField = "category" | "partName" | "subSpec" | "spec";

/**
 * 2차원 행렬(rawRows)에서 가로 병합(colSpan)으로 인해 모든 데이터 행에서 항상 비어있는 열을 제거하고
 * 품명 / 세부사항 / 규격으로 정확하게 매핑하여 PartItem 배열로 반환합니다.
 */
export function convertRowsToParts(
  rawRows: string[][],
  defaultCategory: string = "[ MAIN ]",
  targetField: PasteColumnField = "partName"
): { parts: PartItem[]; detectedModelName?: string } | null {
  if (!rawRows || rawRows.length === 0) return null;

  // 단일 셀(1행 1열) 일반 텍스트 붙여넣기인 경우 기본 input 동작에 맡김
  if (rawRows.length === 1 && rawRows[0].filter((c) => c && c.trim().length > 0).length <= 1 && rawRows[0].length <= 1) {
    return null;
  }

  let detectedModelName: string | undefined;
  let currentCategory = defaultCategory && defaultCategory.trim() ? defaultCategory.trim() : "[ MAIN ]";

  // 1. 먼저 제목/메타데이터/카테고리 단독 행/헤더 행을 분리하고 순수 데이터 행들을 식별
  const contentRows: string[][] = [];

  for (let r = 0; r < rawRows.length; r++) {
    const row = (rawRows[r] || []).map((c) => (c !== undefined && c !== null ? String(c).trim() : ""));
    const nonEmpty = row.filter((c) => c.length > 0);
    if (nonEmpty.length === 0) continue;

    const firstVal = nonEmpty[0];
    const firstValCompact = firstVal.replace(/\s+/g, "");
    const compactedRow = row.map((c) => c.replace(/\s+/g, ""));

    // 상단 '모델명 | VOICE200ultra-...' 감지
    const modelLabelIdx = compactedRow.findIndex((c) => /^(모델명|설비명|장비명)$/i.test(c));
    if (modelLabelIdx !== -1) {
      for (let k = modelLabelIdx + 1; k < row.length; k++) {
        if (row[k] && !/^(s\/n|sn|작성자)$/i.test(compactedRow[k])) {
          detectedModelName = row[k].trim();
          break;
        }
      }
      continue;
    }

    // 문서 제목/메타데이터 행 건너뛰기
    if (
      firstValCompact.includes("시리얼리스트") ||
      firstValCompact === "작성자" ||
      firstValCompact === "비고"
    ) {
      continue;
    }

    // 모듈 구분 단독 행 감지 (예: [ MAIN ])
    if (firstVal.startsWith("[") && nonEmpty.length === 1) {
      const inner = firstVal.replace(/^\[|\]$/g, "").trim();
      currentCategory = `[ ${inner} ]`;
      continue;
    }

    // 테이블 헤더 행 건너뛰기 (예: 품명 | 세부 사항 | 규격 | Serial No.)
    if (
      /^(no\.?|순번|품명|부품명|partname|모듈구분|파트구분)$/i.test(firstValCompact) &&
      nonEmpty.some((c) => /^(규격|세부사항|세부사양|spec|serialno\.?|시리얼)$/i.test(c.replace(/\s+/g, "")))
    ) {
      continue;
    }

    contentRows.push(row);
  }

  if (contentRows.length === 0) return null;

  // 2. 엑셀 가로 병합 셀(colSpan)로 인해 모든 데이터 행에서 100% 비어있는 열(empty column)을 자동 제거!
  // 예: Regulator \t \t N2 Carrier gas \t \t VPPE-... \t \t GYYZ... -> 빈 열(1, 3, 5)을 제거하면 정확히 [품명, 세부사항, 규격, 시리얼] 4열이 됨!
  const maxCols = Math.max(...contentRows.map((r) => r.length));
  const activeColIndices: number[] = [];
  for (let c = 0; c < maxCols; c++) {
    const hasAnyValue = contentRows.some((r) => r[c] && r[c].trim().length > 0);
    if (hasAnyValue) {
      activeColIndices.push(c);
    }
  }

  if (activeColIndices.length === 0) return null;

  const normalizedRows = contentRows.map((r) => activeColIndices.map((cIdx) => r[cIdx] || ""));

  // 3. 각 행에서 품명 / 세부사항 / 규격 추출 및 세로 병합 셀(PC, Control Board 등) 자동 상속
  const extracted: PartItem[] = [];
  let lastPartName = "";
  let lastSubSpec = "";

  for (let r = 0; r < normalizedRows.length; r++) {
    const cols = normalizedRows[r];
    const nonEmpty = cols.filter((c) => c.length > 0);
    if (nonEmpty.length === 0) continue;

    // 만약 데이터 중간에 [ SUB ] 같은 카테고리 행이 끼어 있는 경우
    if (nonEmpty.length === 1 && nonEmpty[0].startsWith("[")) {
      const inner = nonEmpty[0].replace(/^\[|\]$/g, "").trim();
      currentCategory = `[ ${inner} ]`;
      lastPartName = "";
      lastSubSpec = "";
      continue;
    }

    // 맨 앞 열이 순번(1, 2, 3...)인지 확인
    const hasLeadingIndex = cols.length >= 4 && /^\d+$/.test(cols[0] || "");
    const dataCols = hasLeadingIndex ? cols.slice(1) : cols;

    // 첫 번째 열이 [ MAIN ] 같은 파트 구분인지 확인
    const firstColIsCategory = /^\[.*\]$/.test(dataCols[0] || "");
    let rawPartName = "";
    let rawSubSpec = "";
    let rawSpec = "";
    let rawSerial = "";

    if (firstColIsCategory) {
      const inner = (dataCols[0] || "").replace(/^\[|\]$/g, "").trim();
      currentCategory = `[ ${inner} ]`;
      rawPartName = dataCols[1] || "";
      rawSubSpec = dataCols[2] || "";
      rawSpec = dataCols[3] || "";
      rawSerial = dataCols[4] || "";
    } else if (targetField === "subSpec" && activeColIndices.length <= 2) {
      rawPartName = lastPartName;
      rawSubSpec = dataCols[0] || "";
      rawSpec = dataCols[1] || "";
    } else if (targetField === "spec" && activeColIndices.length === 1) {
      rawPartName = lastPartName;
      rawSubSpec = lastSubSpec;
      rawSpec = dataCols[0] || "";
    } else {
      // 표준 매핑: 0열 = 품명, 1열 = 세부사항, 2열 = 규격, 3열 = 시리얼번호
      rawPartName = dataCols[0] || "";
      rawSubSpec = dataCols[1] || "";
      rawSpec = dataCols[2] || "";
      rawSerial = dataCols[3] || "";
    }

    if (!rawPartName && !rawSubSpec && !rawSpec && !rawSerial) {
      continue;
    }

    // 세로 병합 셀(Merged Cells) 자동 상속 처리:
    // 예: PC (4행 병합) + UNO-2484G... (4행 병합) / Control Board (2행 병합)
    let finalPartName = rawPartName;
    if (!finalPartName && (rawSubSpec || rawSpec || rawSerial) && lastPartName) {
      finalPartName = lastPartName;
    }

    let finalSubSpec = rawSubSpec;
    if (!finalSubSpec && finalPartName === lastPartName && lastSubSpec && !rawPartName) {
      finalSubSpec = lastSubSpec;
    }

    if (rawPartName) {
      lastPartName = rawPartName;
      lastSubSpec = rawSubSpec;
    } else if (rawSubSpec) {
      lastSubSpec = rawSubSpec;
    }

    if (!finalPartName && !rawSpec && !finalSubSpec) {
      continue;
    }

    const cleanedSerial =
      rawSerial && !/^(미입고|미입력|-|추후|예정)$/i.test(rawSerial.trim())
        ? rawSerial.trim()
        : "";

    extracted.push({
      id: generateId(),
      category: currentCategory,
      partName: finalPartName || "-",
      subSpec: finalSubSpec || "-",
      spec: rawSpec || "-",
      detectedSerial: cleanedSerial,
      isVerified: false,
    });
  }

  if (extracted.length === 0) return null;

  return { parts: extracted, detectedModelName };
}

/**
 * 엑셀에서 복사한 클립보드 데이터(TSV 또는 HTML)를 분석하여 PartItem 배열로 변환합니다.
 * 엑셀 복사본은 TSV(text/plain)가 가장 일관된 탭 구조를 가지므로 TSV를 우선 파싱하고, 없을 때 HTML을 사용합니다.
 */
export function parseExcelClipboardToParts(
  clipboardData: DataTransfer,
  defaultCategory: string = "[ MAIN ]",
  targetField: PasteColumnField = "partName"
): { parts: PartItem[]; detectedModelName?: string } | null {
  const plain = clipboardData.getData("text/plain");
  const html = clipboardData.getData("text/html");

  if (!plain && !html) return null;

  if (plain && plain.trim().length > 0) {
    const tsvRows = parseClipboardTsv(plain);
    const res = convertRowsToParts(tsvRows, defaultCategory, targetField);
    if (res && res.parts.length > 0) return res;
  }

  if (html && html.trim().length > 0) {
    const htmlRows = parseClipboardHtmlTable(html);
    if (htmlRows) {
      const res = convertRowsToParts(htmlRows, defaultCategory, targetField);
      if (res && res.parts.length > 0) return res;
    }
  }

  return null;
}

/**
 * 현재 편집 중인 부품 배열(prevParts)의 rowIdx 위치에 붙여넣은 부품들(pastedParts)을 병합합니다.
 */
export function mergePastedPartsIntoList(
  prevParts: PartItem[],
  pastedParts: PartItem[],
  startRowIdx: number
): PartItem[] {
  if (pastedParts.length === 0) return prevParts;

  // 첫 번째 행(0번 행)에서 여러 행(2개 이상)을 붙여넣은 경우 기존 샘플 행을 대체
  if (startRowIdx === 0 && pastedParts.length >= 2) {
    return pastedParts;
  }

  const next = [...prevParts];
  for (let i = 0; i < pastedParts.length; i++) {
    const targetIdx = startRowIdx + i;
    const incoming = pastedParts[i];
    if (targetIdx < next.length) {
      next[targetIdx] = {
        ...next[targetIdx],
        category: incoming.category || next[targetIdx].category || "[ MAIN ]",
        partName: incoming.partName !== "-" ? incoming.partName : next[targetIdx].partName,
        subSpec: incoming.subSpec || "-",
        spec: incoming.spec || "-",
      };
    } else {
      next.push(incoming);
    }
  }
  return next;
}
