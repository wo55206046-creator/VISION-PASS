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
 * 클립보드의 HTML(<table>) 데이터를 파싱하여 세로 병합(rowSpan)을 보존한 2차원 행렬로 변환합니다.
 * 주의: 엑셀에서 세로 병합된 셀(예: PC 4행 병합, 세부사항 4행 병합)은 첫 행에만 값을 넣고
 * 나머지 행은 빈 문자열("")로 두어야 하단 병합 상속 로직이 '품명 상속'과 '세부사항 상속'을 정확히 구분합니다.
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
    // occupied[r][c] = true 이면 이전 행/열의 rowSpan/colSpan에 의해 차지된 셀
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

        // <br> 태그를 줄바꿈으로 변환 후 텍스트 추출
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
            // 첫 번째 칸(dr=0, dc=0)에만 텍스트를 기록하고 병합된 나머지 칸은 빈칸("")으로 유지
            grid[nr][nc] = dr === 0 && dc === 0 ? text : "";
          }
        }

        colCursor += colSpan;
      }
    }

    return grid.length > 0 ? grid : null;
  } catch {
    return null;
  }
}

/**
 * 클립보드의 TSV(탭 구분 텍스트)를 파싱하여 엑셀의 따옴표("...") 내부 줄바꿈을 보존한 2차원 행렬로 변환합니다.
 */
function parseClipboardTsv(text: string): string[][] {
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

  // 마지막 빈 줄 제거
  while (
    rows.length > 0 &&
    rows[rows.length - 1].every((c) => !c || c.trim().length === 0)
  ) {
    rows.pop();
  }

  return rows;
}

export type PasteColumnField = "category" | "partName" | "subSpec" | "spec";

/**
 * 엑셀에서 복사한 클립보드 데이터(HTML 또는 TSV)를 분석하여 PartItem 배열로 변환합니다.
 */
export function parseExcelClipboardToParts(
  clipboardData: DataTransfer,
  defaultCategory: string = "[ MAIN ]",
  targetField: PasteColumnField = "category"
): { parts: PartItem[]; detectedModelName?: string } | null {
  const html = clipboardData.getData("text/html");
  const plain = clipboardData.getData("text/plain");

  if (!plain && !html) return null;

  const rawRows = parseClipboardHtmlTable(html) || parseClipboardTsv(plain);
  if (!rawRows || rawRows.length === 0) return null;

  // 단일 셀(1행 1열) 일반 텍스트 붙여넣기인 경우 기본 input 동작에 맡김
  if (rawRows.length === 1 && rawRows[0].length <= 1) {
    return null;
  }

  let detectedModelName: string | undefined;

  // 1. 상단 문서 헤더에서 모델명 감지 및 테이블 컬럼 헤더 위치 탐색
  let headerRowIdx = -1;
  let colCategory = -1;
  let colPartName = -1;
  let colSubSpec = -1;
  let colSpec = -1;
  let colSerial = -1;

  for (let r = 0; r < Math.min(rawRows.length, 25); r++) {
    const row = rawRows[r] || [];
    const compacted = row.map((c) => String(c || "").replace(/\s+/g, ""));

    // 상단 '모델명 | VOICE200ultra-...' 감지
    const modelLabelIdx = compacted.findIndex((c) => /^(모델명|설비명|장비명)$/i.test(c));
    if (modelLabelIdx !== -1) {
      for (let k = modelLabelIdx + 1; k < row.length; k++) {
        if (row[k] && !/^(s\/n|sn|작성자)$/i.test(compacted[k])) {
          detectedModelName = row[k].trim();
          break;
        }
      }
    }

    const catIdx = compacted.findIndex((c) => /^(파트구분|모듈구분|카테고리|구분|파트|모듈|category)$/i.test(c));
    const pIdx = compacted.findIndex((c) => /^(품명|부품명|품목|partname|part|item)$/i.test(c));
    const subIdx = compacted.findIndex((c) => /^(세부사항|세부사양|세부|subspec|sub_spec|용도|위치)$/i.test(c));
    const sIdx = compacted.findIndex((c) => /^(규격|사양|spec|specification|model)$/i.test(c));
    const snIdx = compacted.findIndex((c) => /^(serialno\.?|serialnumber|serial|시리얼번호|시리얼|s\/n|sn|일련번호)$/i.test(c));

    if (pIdx !== -1 && (subIdx !== -1 || sIdx !== -1)) {
      headerRowIdx = r;
      colCategory = catIdx;
      colPartName = pIdx;
      colSubSpec = subIdx;
      colSpec = sIdx;
      colSerial = snIdx;
      break;
    }
  }

  const extracted: PartItem[] = [];
  let currentCategory = defaultCategory && defaultCategory.trim() ? defaultCategory.trim() : "[ MAIN ]";
  const startRow = headerRowIdx !== -1 ? headerRowIdx + 1 : 0;

  let lastPartName = "";
  let lastSubSpec = "";

  // 전체적으로 앞쪽 빈 열(엑셀 A열 여백 등)이 공통으로 비어있는 경우를 계산
  let commonLeadingEmptyCols = Infinity;
  for (let r = startRow; r < rawRows.length; r++) {
    const row = rawRows[r] || [];
    const firstNonEmpty = row.findIndex((c) => c && c.trim().length > 0);
    if (firstNonEmpty !== -1 && firstNonEmpty < commonLeadingEmptyCols) {
      commonLeadingEmptyCols = firstNonEmpty;
    }
  }
  if (!Number.isFinite(commonLeadingEmptyCols)) commonLeadingEmptyCols = 0;

  for (let r = startRow; r < rawRows.length; r++) {
    const rawRow = rawRows[r] || [];
    const cells = rawRow.map((c) => (c !== undefined && c !== null ? String(c).trim() : ""));
    const nonEmpty = cells.filter((c) => c.length > 0);
    if (nonEmpty.length === 0) continue;

    const firstVal = nonEmpty[0];
    const firstValCompact = firstVal.replace(/\s+/g, "");

    // 문서 제목/메타데이터 행 건너뛰기
    if (
      firstValCompact.includes("시리얼리스트") ||
      firstValCompact === "모델명" ||
      firstValCompact === "작성자" ||
      firstValCompact === "비고"
    ) {
      continue;
    }

    // 모듈 구분 단독 행 감지 (예: [ MAIN ], [ GAS FLOW ], [MG] 등)
    if (
      (firstVal.startsWith("[") && firstVal.endsWith("]") && nonEmpty.length === 1) ||
      (firstVal.startsWith("[") && nonEmpty.length === 1)
    ) {
      const inner = firstVal.replace(/^\[|\]$/g, "").trim();
      currentCategory = `[ ${inner} ]`;
      lastPartName = "";
      lastSubSpec = "";
      continue;
    }

    // 중간에 반복 등장하는 헤더 행 건너뛰기
    if (
      /^(품명|부품명|partname)$/i.test(firstValCompact) &&
      nonEmpty.some((c) => /^(규격|세부사항|세부사양|spec)$/i.test(c.replace(/\s+/g, "")))
    ) {
      continue;
    }

    let rawCategory = "";
    let rawPartName = "";
    let rawSubSpec = "";
    let rawSpec = "";
    let rawSerial = "";

    if (headerRowIdx !== -1 && colPartName !== -1) {
      // (A) 헤더 행이 함께 복사된 경우: 헤더 컬럼 인덱스로 정확히 추출
      rawCategory = colCategory !== -1 ? cells[colCategory] || "" : "";
      rawPartName = cells[colPartName] || "";
      rawSubSpec = colSubSpec !== -1 ? cells[colSubSpec] || "" : "";
      rawSpec = colSpec !== -1 ? cells[colSpec] || "" : "";
      rawSerial = colSerial !== -1 ? cells[colSerial] || "" : "";
    } else {
      // (B) 헤더 없이 데이터 셀만 복사해서 붙여넣은 경우
      const trimmedCells = cells.slice(commonLeadingEmptyCols);

      // 맨 앞 열이 순번(1, 2, 3...)인지 확인
      const hasLeadingIndex =
        trimmedCells.length >= 4 && /^\d+$/.test(trimmedCells[0] || "");
      const cols = hasLeadingIndex ? trimmedCells.slice(1) : trimmedCells;

      // 첫 번째 열이 [ MAIN ] 같은 파트 구분인지 확인
      const firstColIsCategory = /^\[.*\]$/.test(cols[0] || "");

      if (firstColIsCategory) {
        const inner = (cols[0] || "").replace(/^\[|\]$/g, "").trim();
        rawCategory = `[ ${inner} ]`;
        rawPartName = cols[1] || "";
        rawSubSpec = cols[2] || "";
        rawSpec = cols[3] || "";
        rawSerial = cols[4] || "";
      } else if (targetField === "subSpec" && cols.length <= 2) {
        // 세부사항 칸에서 1~2열만 붙여넣은 경우
        rawPartName = lastPartName;
        rawSubSpec = cols[0] || "";
        rawSpec = cols[1] || "";
      } else if (targetField === "spec" && cols.length === 1) {
        // 규격 칸에서 1열만 붙여넣은 경우
        rawPartName = lastPartName;
        rawSubSpec = lastSubSpec;
        rawSpec = cols[0] || "";
      } else {
        // 기본: 품명 | 세부사항 | 규격 (| Serial No.) 순서 (빨간 박스 '파트 구분'에 붙여넣었더라도 자동 매핑!)
        rawPartName = cols[0] || "";
        rawSubSpec = cols[1] || "";
        rawSpec = cols[2] || "";
        rawSerial = cols[3] || "";
      }
    }

    if (rawCategory) {
      currentCategory = rawCategory;
    }

    if (!rawPartName && !rawSubSpec && !rawSpec && !rawSerial) {
      continue;
    }

    // 세로 병합 셀(예: PC 4행 병합, Control Board 2행 병합) 자동 상속
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

    // 양식(Template) 등록용이므로 '미입고' 등 임시 시리얼 문구는 비워둠
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
 * 현재 편집 중인 부품 배열(prevParts)의 rowIdx 위치에 붙여넣은 부품들(pastedParts)을 병합합니다.
 */
export function mergePastedPartsIntoList(
  prevParts: PartItem[],
  pastedParts: PartItem[],
  startRowIdx: number
): PartItem[] {
  if (pastedParts.length === 0) return prevParts;

  // 첫 번째 행(0번 행)에서 여러 행(2개 이상)을 붙여넣은 경우:
  // 기존 기본 샘플 6개 행이 뒤에 남아 혼란을 주지 않도록 붙여넣은 목록으로 깔끔히 대체
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

