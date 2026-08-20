import ExcelJS from "exceljs";
import { ProjectMaster, EquipmentUnit, PartItem } from "@/types";

/**
 * WITHTECH 사내 표준 「3. 시리얼 리스트」 엑셀 보고서 생성 엔진
 * - 종합 현황 시트 제외, 각 호기별 시트(1호기, 2호기, 3호기...)로 깔끔하게 구성
 * - 사진 서식 100% 일치:
 *   - 대제목: [3. 시리얼 리스트]
 *   - A4:A5 병합: [ 모 델 명 ]
 *   - B4: 메인 모델명 (예: TM100L), B5: 괄호 세부 모델명 (예: (NaVi-TM100L-0312))
 *   - C4/D4: [ S/N ] [ 해당 호기 시리얼 ]
 *   - C5/D5: [ 작 성 자 ] [ 검사자/작성자명 ]
 *   - 모듈별 [ MAIN ], [ MG ] 구분 바 및 4개 컬럼(품명, 세부 사항, 규격, Serial No.)
 *   - 하단 [ 비 고 ] 란
 */
export async function exportEquipmentReportExcel(project: ProjectMaster): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WITHTECH Semiconductor Quality System";
  workbook.created = new Date();

  // 표준 스타일 정의
  const GRAY_HEADER_FILL: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" }, // Clean Gray (헤더 배경)
  };

  const MODULE_BAR_FILL: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD8DEE9" }, // 모듈 구분 섹션 바
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

    // 2. Row 2: 대제목 「3. 시리얼 리스트」
    sheet.mergeCells("A2:D2");
    const titleCell = sheet.getCell("A2");
    titleCell.value = "3. 시리얼 리스트";
    titleCell.font = { name: "맑은 고딕", size: 16, bold: true, color: { argb: "FF000000" } };
    titleCell.alignment = { vertical: "middle", horizontal: "center" };
    sheet.getRow(2).height = 32;

    // 3. Rows 4~5: 헤더 메타데이터 정보 박스
    // 모델명 분리: "TM100L (NaVi-TM100L-0312)" -> B4: "TM100L", B5: "(NaVi-TM100L-0312)"
    const eqName = (project.equipmentName || "").trim();
    let modelMain = eqName;
    let modelSub = "";

    const parenMatch = eqName.match(/^(.*?)\s*(\(.*?\))\s*$/);
    if (parenMatch) {
      modelMain = parenMatch[1].trim();
      modelSub = parenMatch[2].trim();
    }

    // A4:A5 병합: [ 모 델 명 ]
    sheet.mergeCells("A4:A5");
    const modelLabel = sheet.getCell("A4");
    modelLabel.value = "모 델 명";
    modelLabel.font = { name: "맑은 고딕", size: 10, bold: true };
    modelLabel.fill = GRAY_HEADER_FILL;
    modelLabel.alignment = { vertical: "middle", horizontal: "center" };
    modelLabel.border = THIN_BORDER;
    sheet.getCell("A5").border = THIN_BORDER;

    // B4: 메인 모델명 (예: TM100L)
    const modelVal1 = sheet.getCell("B4");
    modelVal1.value = modelMain || "-";
    modelVal1.font = { name: "맑은 고딕", size: 10, bold: true };
    modelVal1.alignment = { vertical: "middle", horizontal: "center" };
    modelVal1.border = THIN_BORDER;

    // B5: 괄호 세부 모델명 (예: (NaVi-TM100L-0312))
    const modelVal2 = sheet.getCell("B5");
    modelVal2.value = modelSub || "";
    modelVal2.font = { name: "맑은 고딕", size: 9.5, bold: true };
    modelVal2.alignment = { vertical: "middle", horizontal: "center" };
    modelVal2.border = THIN_BORDER;

    // C4, D4: [ S/N ] [ 해당 호기 시리얼 ]
    const snLabel = sheet.getCell("C4");
    snLabel.value = "S/N";
    snLabel.font = { name: "맑은 고딕", size: 10, bold: true };
    snLabel.fill = GRAY_HEADER_FILL;
    snLabel.alignment = { vertical: "middle", horizontal: "center" };
    snLabel.border = THIN_BORDER;

    const snVal = sheet.getCell("D4");
    snVal.value = unit.equipmentSerial || "-";
    snVal.font = { name: "맑은 고딕", size: 10, bold: true };
    snVal.alignment = { vertical: "middle", horizontal: "center" };
    snVal.border = THIN_BORDER;

    // C5, D5: [ 작 성 자 ] [ 검사자명 ]
    const writerLabel = sheet.getCell("C5");
    writerLabel.value = "작 성 자";
    writerLabel.font = { name: "맑은 고딕", size: 10, bold: true };
    writerLabel.fill = GRAY_HEADER_FILL;
    writerLabel.alignment = { vertical: "middle", horizontal: "center" };
    writerLabel.border = THIN_BORDER;

    const writerVal = sheet.getCell("D5");
    writerVal.value = project.inspectorName || "-";
    writerVal.font = { name: "맑은 고딕", size: 10 };
    writerVal.alignment = { vertical: "middle", horizontal: "center" };
    writerVal.border = THIN_BORDER;

    sheet.getRow(4).height = 20;
    sheet.getRow(5).height = 20;

    // 4. 모듈별 부품 테이블 렌더링
    let currentRow = 7;

    const categoryGroups: { category: string; parts: PartItem[] }[] = [];
    const partList = unit.parts || [];
    partList.forEach((part) => {
      const cat = part.category || "[ MAIN ]";
      const existing = categoryGroups.find((g) => g.category === cat);
      if (existing) {
        existing.parts.push(part);
      } else {
        categoryGroups.push({ category: cat, parts: [part] });
      }
    });

    categoryGroups.forEach((group) => {
      // 모듈 헤더 바: e.g. [ MAIN ], [ MG ], [ WOA-683 ]
      sheet.mergeCells(`A${currentRow}:D${currentRow}`);
      const modCell = sheet.getCell(`A${currentRow}`);
      modCell.value = group.category;
      modCell.font = { name: "맑은 고딕", size: 10, bold: true, color: { argb: "FF000000" } };
      modCell.fill = MODULE_BAR_FILL;
      modCell.alignment = { vertical: "middle", horizontal: "center" };
      for (let c = 1; c <= 4; c++) {
        sheet.getRow(currentRow).getCell(c).border = THIN_BORDER;
      }
      sheet.getRow(currentRow).height = 22;
      currentRow++;

      // 4개 컬럼 타이틀 행: [ 품명 ] [ 세부 사항 ] [ 규격 ] [ Serial No. ]
      const colHeaders = ["품명", "세부 사항", "규격", "Serial No."];
      colHeaders.forEach((th, cIdx) => {
        const cell = sheet.getRow(currentRow).getCell(cIdx + 1);
        cell.value = th;
        cell.font = { name: "맑은 고딕", size: 10, bold: true, color: { argb: "FF000000" } };
        cell.fill = GRAY_HEADER_FILL;
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = THIN_BORDER;
      });
      sheet.getRow(currentRow).height = 20;
      currentRow++;

      // 부품 데이터 행들
      const partStartRow = currentRow;
      group.parts.forEach((p) => {
        const row = sheet.getRow(currentRow);
        row.height = 19;

        // 품명
        const pNameCell = row.getCell(1);
        pNameCell.value = p.partName;
        pNameCell.font = { name: "맑은 고딕", size: 9.5 };
        pNameCell.alignment = { vertical: "middle", horizontal: "center" };
        pNameCell.border = THIN_BORDER;

        // 세부 사항
        const pSubCell = row.getCell(2);
        pSubCell.value = p.subSpec || "-";
        pSubCell.font = { name: "맑은 고딕", size: 9.5 };
        pSubCell.alignment = { vertical: "middle", horizontal: "center" };
        pSubCell.border = THIN_BORDER;

        // 규격
        const pSpecCell = row.getCell(3);
        pSpecCell.value = p.spec || "-";
        pSpecCell.font = { name: "맑은 고딕", size: 9 };
        pSpecCell.alignment = { vertical: "middle", horizontal: "center" };
        pSpecCell.border = THIN_BORDER;

        // Serial No.
        const pSerialCell = row.getCell(4);
        pSerialCell.value = p.detectedSerial || "";
        pSerialCell.font = { name: "맑은 고딕", size: 9.5, bold: Boolean(p.detectedSerial) };
        pSerialCell.alignment = { vertical: "middle", horizontal: "center" };
        pSerialCell.border = THIN_BORDER;

        currentRow++;
      });

      // 동일한 품명 및 세부사항 연속 행 자동 병합 (예: PC 4개 행, Control Board 2개 행)
      let pMergeStart = partStartRow;
      for (let i = 0; i < group.parts.length; i++) {
        const currP = group.parts[i];
        const nextP = i + 1 < group.parts.length ? group.parts[i + 1] : null;

        if (!nextP || nextP.partName !== currP.partName) {
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

  // 6. 엑셀 파일 바이너리 생성 및 즉시 다운로드
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const sanitizedPjt = (project.pjtCode || "PJT").replace(/[^a-zA-Z0-9-_]/g, "_");
  const sanitizedEq = (project.equipmentName || "EQ").replace(/[^a-zA-Z0-9-_]/g, "_");
  const dateStr = (project.inspectionDate || new Date().toISOString().split("T")[0]).replace(/-/g, "");
  const fileName = `[시리얼리스트]_${sanitizedPjt}_${sanitizedEq}_(${units.length}대)_${dateStr}.xlsx`;

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
