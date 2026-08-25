import ExcelJS from "exceljs";
import { ProjectMaster, EquipmentUnit, PartItem } from "@/types";

/**
 * 파일명 및 헤더용 시리얼 범위 포맷 생성기 (예: "TM1L-HK26-1007~1009", 단일 호기 시 "TM1L-HK26-1007")
 */
export function formatSerialRangeForFilename(units: EquipmentUnit[], fallback: string = ""): string {
  const validSerials = units.map((u) => (u.equipmentSerial || "").trim()).filter(Boolean);
  if (validSerials.length === 0) {
    return fallback;
  }
  if (validSerials.length === 1) {
    return validSerials[0];
  }

  const first = validSerials[0];
  const last = validSerials[validSerials.length - 1];

  // 숫자로 끝나는 연속 채번 패턴 확인 (예: TM1L-HK26-1007 vs TM1L-HK26-1009 -> TM1L-HK26-1007~1009)
  const firstMatch = first.match(/^(.*?)(\d+)$/);
  const lastMatch = last.match(/^(.*?)(\d+)$/);

  if (firstMatch && lastMatch && firstMatch[1] === lastMatch[1]) {
    return `${first}~${lastMatch[2]}`;
  }

  return `${first}~${last}`;
}

/**
 * WITHTECH 사내 표준 「3. 시리얼 리스트」 엑셀 보고서 생성 엔진
 */
export async function exportEquipmentReportExcel(project: ProjectMaster): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WITHTECH Semiconductor Quality System";
  workbook.created = new Date();

  // 표준 스타일 정의: Excel 테마 색상 [흰색, 배경 1, 15% 더 어둡게] -> RGB(217, 217, 217) = #D9D9D9
  const GRAY_HEADER_FILL: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9D9D9" }, // 흰색, 배경 1, 15% 더 어둡게
  };

  const MODULE_BAR_FILL: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9D9D9" }, // 흰색, 배경 1, 15% 더 어둡게
  };

  const THIN_BORDER: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FF000000" } },
    left: { style: "thin", color: { argb: "FF000000" } },
    bottom: { style: "thin", color: { argb: "FF000000" } },
    right: { style: "thin", color: { argb: "FF000000" } },
  };

  const units: EquipmentUnit[] =
    project.equipmentUnits && project.equipmentUnits.length > 0
      ? project.equipmentUnits
      : [{ unitIndex: 1, equipmentSerial: "", parts: [] }];

  // 각 호기별로 1개의 시트(Sheet) 생성
  units.forEach((unit: EquipmentUnit) => {
    const sheetName = `${unit.unitIndex}호기`;

    const sheet = workbook.addWorksheet(sheetName, {
      views: [{ showGridLines: true }],
      pageSetup: {
        paperSize: 9, // A4
        orientation: "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });

    // 1. 컬럼 너비 설정 (A: 품명, B: 세부 사항, C: 규격, D: Serial No.)
    sheet.columns = [
      { width: 22 }, // Col A: 품명
      { width: 20 }, // Col B: 세부 사항
      { width: 26 }, // Col C: 규격
      { width: 28 }, // Col D: Serial No.
    ];

    // 2. 1~3행 병합 대제목 「3. 시리얼 리스트」 (글자 크기: 24, 외곽 테두리)
    sheet.mergeCells("A1:D3");
    const titleCell = sheet.getCell("A1");
    titleCell.value = "3. 시리얼 리스트";
    titleCell.font = { name: "맑은 고딕", size: 24, bold: true, color: { argb: "FF000000" } };
    titleCell.alignment = { vertical: "middle", horizontal: "center" };
    sheet.getRow(1).height = 18;
    sheet.getRow(2).height = 28;
    sheet.getRow(3).height = 18;

    // A1:D3 전체 외곽 테두리 적용
    for (let r = 1; r <= 3; r++) {
      for (let c = 1; c <= 4; c++) {
        sheet.getRow(r).getCell(c).border = {
          ...(r === 1 ? { top: { style: "thin", color: { argb: "FF000000" } } } : {}),
          ...(r === 3 ? { bottom: { style: "thin", color: { argb: "FF000000" } } } : {}),
          ...(c === 1 ? { left: { style: "thin", color: { argb: "FF000000" } } } : {}),
          ...(c === 4 ? { right: { style: "thin", color: { argb: "FF000000" } } } : {}),
        };
      }
    }

    // Row 4: 중간 여백 행
    sheet.getRow(4).height = 12;

    // 3. Rows 5~6: 헤더 메타데이터 정보 박스
    // 모델명 분리: 괄호()가 포함된 경우 B5(메인 모델)와 B6(괄호 세부모델)로 행 분리
    const eqName = (project.equipmentName || "").trim();
    let modelMain = eqName;
    let modelSub = "";
    const parenIndex = eqName.indexOf("(");
    if (parenIndex !== -1 && eqName.endsWith(")")) {
      modelMain = eqName.substring(0, parenIndex).trim();
      modelSub = eqName.substring(parenIndex).trim();
    }

    // A5:A6 병합 -> [ 모 델 명 ]
    sheet.mergeCells("A5:A6");
    const modelLabel = sheet.getCell("A5");
    modelLabel.value = "모 델 명";
    modelLabel.font = { name: "맑은 고딕", size: 10, bold: true };
    modelLabel.fill = GRAY_HEADER_FILL;
    modelLabel.alignment = { vertical: "middle", horizontal: "center" };
    sheet.getRow(5).getCell(1).border = THIN_BORDER;
    sheet.getRow(6).getCell(1).border = THIN_BORDER;

    // B5 & B6: 괄호 유무에 따른 모델명 배치
    if (modelSub) {
      // 괄호가 있는 경우: B5에 메인 모델명 (예: TM100L), B6에 괄호 세부모델명 (예: (NaVi-TM100L-0312))
      const b5Cell = sheet.getCell("B5");
      b5Cell.value = modelMain || "-";
      b5Cell.font = { name: "맑은 고딕", size: 10, bold: true };
      b5Cell.alignment = { vertical: "middle", horizontal: "center" };
      b5Cell.border = THIN_BORDER;

      const b6Cell = sheet.getCell("B6");
      b6Cell.value = modelSub;
      b6Cell.font = { name: "맑은 고딕", size: 9 };
      b6Cell.alignment = { vertical: "middle", horizontal: "center" };
      b6Cell.border = THIN_BORDER;
    } else {
      // 괄호가 없는 단일 모델명인 경우: B5:B6 병합하여 중앙 표시
      sheet.mergeCells("B5:B6");
      const b5Cell = sheet.getCell("B5");
      b5Cell.value = modelMain || "-";
      b5Cell.font = { name: "맑은 고딕", size: 10, bold: true };
      b5Cell.alignment = { vertical: "middle", horizontal: "center" };
      sheet.getRow(5).getCell(2).border = THIN_BORDER;
      sheet.getRow(6).getCell(2).border = THIN_BORDER;
    }

    // C5 -> [ S/N ]
    const snLabel = sheet.getCell("C5");
    snLabel.value = "S/N";
    snLabel.font = { name: "맑은 고딕", size: 10, bold: true };
    snLabel.fill = GRAY_HEADER_FILL;
    snLabel.alignment = { vertical: "middle", horizontal: "center" };
    snLabel.border = THIN_BORDER;

    // D5 -> 해당 호기 설비 Serial No.
    const snVal = sheet.getCell("D5");
    snVal.value = unit.equipmentSerial || "-";
    snVal.font = { name: "맑은 고딕", size: 10, bold: true };
    snVal.alignment = { vertical: "middle", horizontal: "center" };
    snVal.border = THIN_BORDER;

    // C6 -> [ 작 성 자 ]
    const inspLabel = sheet.getCell("C6");
    inspLabel.value = "작 성 자";
    inspLabel.font = { name: "맑은 고딕", size: 10, bold: true };
    inspLabel.fill = GRAY_HEADER_FILL;
    inspLabel.alignment = { vertical: "middle", horizontal: "center" };
    inspLabel.border = THIN_BORDER;

    // D6 -> 담당자 / 작성자명
    const inspVal = sheet.getCell("D6");
    inspVal.value = project.inspectorName || "-";
    inspVal.font = { name: "맑은 고딕", size: 10, bold: true };
    inspVal.alignment = { vertical: "middle", horizontal: "center" };
    inspVal.border = THIN_BORDER;

    sheet.getRow(5).height = 22;
    sheet.getRow(6).height = 22;

    // Row 7: 중간 여백 행
    sheet.getRow(7).height = 12;

    // 4. 부품 목록 (모듈별 그룹화 - Row 8부터 시작)
    const partsByCat = (unit.parts || []).reduce(
      (acc: { category: string; parts: PartItem[] }[], part: PartItem) => {
        const cat = (part.category || "[ MAIN ]").trim();
        const existing = acc.find((g) => g.category === cat);
        if (existing) {
          existing.parts.push(part);
        } else {
          acc.push({ category: cat, parts: [part] });
        }
        return acc;
      },
      []
    );

    let currentRow = 8;

    partsByCat.forEach((group: { category: string; parts: PartItem[] }) => {
      // 4-1. 모듈 구분 섹션 바 (예: [ MAIN ], [ MG ])
      sheet.mergeCells(`A${currentRow}:D${currentRow}`);
      const catCell = sheet.getCell(`A${currentRow}`);
      catCell.value = group.category;
      catCell.font = { name: "맑은 고딕", size: 10, bold: true, color: { argb: "FF0F172A" } };
      catCell.fill = MODULE_BAR_FILL;
      catCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      for (let c = 1; c <= 4; c++) {
        sheet.getRow(currentRow).getCell(c).border = THIN_BORDER;
      }
      sheet.getRow(currentRow).height = 22;
      currentRow++;

      // 4-2. 테이블 컬럼 헤더 (품명 | 세부 사항 | 규격 | Serial No.)
      const headerRow = sheet.getRow(currentRow);
      headerRow.height = 22;
      const headers = ["품명", "세부 사항", "규격", "Serial No."];
      headers.forEach((hText, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = hText;
        cell.font = { name: "맑은 고딕", size: 9.5, bold: true };
        cell.fill = GRAY_HEADER_FILL;
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = THIN_BORDER;
      });
      currentRow++;

      // 4-3. 부품 데이터 행 출력
      const partStartRow = currentRow;
      group.parts.forEach((p: PartItem) => {
        const row = sheet.getRow(currentRow);
        row.height = 20;

        // A: 품명
        const cA = row.getCell(1);
        cA.value = p.partName || "-";
        cA.font = { name: "맑은 고딕", size: 9.5 };
        cA.alignment = { vertical: "middle", horizontal: "center" };
        cA.border = THIN_BORDER;

        // B: 세부 사항
        const cB = row.getCell(2);
        cB.value = p.subSpec || "-";
        cB.font = { name: "맑은 고딕", size: 9 };
        cB.alignment = { vertical: "middle", horizontal: "center" };
        cB.border = THIN_BORDER;

        // C: 규격
        const cC = row.getCell(3);
        cC.value = p.spec || "-";
        cC.font = { name: "맑은 고딕", size: 9 };
        cC.alignment = { vertical: "middle", horizontal: "left" };
        cC.border = THIN_BORDER;

        // D: Serial No.
        const cD = row.getCell(4);
        cD.value = p.detectedSerial || "";
        cD.font = {
          name: "맑은 고딕",
          size: 9.5,
          color: { argb: "FF000000" },
        };
        cD.alignment = { vertical: "middle", horizontal: "center" };
        cD.border = THIN_BORDER;

        currentRow++;
      });

      // 4-4. 동일 품명 & 동일 세부사항 셀 수직 병합
      let pMergeStart = partStartRow;
      for (let i = 0; i < group.parts.length; i++) {
        const currP = group.parts[i];
        const nextP = i + 1 < group.parts.length ? group.parts[i + 1] : null;

        const isSamePart = Boolean(nextP) && nextP!.partName === currP.partName;

        if (!isSamePart) {
          const pMergeEnd = partStartRow + i;
          if (pMergeEnd > pMergeStart) {
            sheet.mergeCells(`A${pMergeStart}:A${pMergeEnd}`);
            const mergedCell = sheet.getCell(`A${pMergeStart}`);
            mergedCell.alignment = { vertical: "middle", horizontal: "center" };
          }
          pMergeStart = pMergeEnd + 1;
        }
      }

      let sMergeStart = partStartRow;
      for (let i = 0; i < group.parts.length; i++) {
        const currP = group.parts[i];
        const nextP = i + 1 < group.parts.length ? group.parts[i + 1] : null;

        const isSameSub =
          Boolean(nextP) &&
          nextP!.partName === currP.partName &&
          nextP!.subSpec === currP.subSpec &&
          currP.subSpec !== "-";

        if (!isSameSub) {
          const sMergeEnd = partStartRow + i;
          if (sMergeEnd > sMergeStart && currP.subSpec !== "-") {
            sheet.mergeCells(`B${sMergeStart}:B${sMergeEnd}`);
            const mergedCell = sheet.getCell(`B${sMergeStart}`);
            mergedCell.alignment = { vertical: "middle", horizontal: "center" };
          }
          sMergeStart = sMergeEnd + 1;
        }
      }
    });

    // 5. 하단 비고(Notes) 란
    const noteStartRow = currentRow;
    const noteEndRow = currentRow + 4;
    sheet.mergeCells(`A${noteStartRow}:A${noteEndRow}`);
    const noteLabel = sheet.getCell(`A${noteStartRow}`);
    noteLabel.value = "비 고";
    noteLabel.font = { name: "맑은 고딕", size: 10, bold: true };
    noteLabel.fill = GRAY_HEADER_FILL;
    noteLabel.alignment = { vertical: "middle", horizontal: "center" };
    for (let r = noteStartRow; r <= noteEndRow; r++) {
      sheet.getRow(r).getCell(1).border = THIN_BORDER;
    }

    sheet.mergeCells(`B${noteStartRow}:D${noteEndRow}`);
    const noteVal = sheet.getCell(`B${noteStartRow}`);
    noteVal.value = project.notes || "";
    noteVal.font = { name: "맑은 고딕", size: 9.5 };
    noteVal.alignment = { vertical: "top", horizontal: "left", wrapText: true };
    for (let r = noteStartRow; r <= noteEndRow; r++) {
      for (let c = 2; c <= 4; c++) {
        sheet.getRow(r).getCell(c).border = THIN_BORDER;
      }
    }
  });

  // 6. 엑셀 파일 바이너리 생성 및 즉시 다운로드 (파일명: 3. 시리얼 리스트_S/N.xlsx)
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  // 시리얼 범위 포맷 생성 (예: "TM1L-HK26-1007~1009", 1호기만 있을 시 "TM1L-HK26-1007")
  const serialRange = formatSerialRangeForFilename(units, project.pjtCode || "S_N");
  const cleanSerial = serialRange.replace(/[\/\\:*?"<>|]/g, "_");
  const fileName = `3. 시리얼 리스트_${cleanSerial}.xlsx`;

  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  setTimeout(() => {
    URL.revokeObjectURL(downloadUrl);
  }, 1000);
}

// Seamless alias
export const exportSemiconductorReportToExcel = exportEquipmentReportExcel;
