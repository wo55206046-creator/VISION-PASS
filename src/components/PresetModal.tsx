"use client";

import React, { useState, useRef, useEffect } from "react";
import { PartPreset, PartItem, PjtModelTemplate } from "@/types";
import { STANDARD_PART_PRESETS, PJT_MODEL_TEMPLATES } from "@/lib/default-presets";
import { generateId } from "@/lib/utils";
import ExcelJS from "exceljs";
import {
  X,
  Plus,
  Check,
  PackagePlus,
  FileSpreadsheet,
  UploadCloud,
  Layers,
  Sparkles,
  Search,
  CheckCircle2,
  AlertCircle,
  Edit2,
  Trash2,
  Save,
  RotateCcw,
  FolderPlus,
  GripVertical,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

interface PresetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddParts: (newParts: PartItem[]) => void;
  onReplaceParts?: (newParts: PartItem[]) => void;
  onSelectTemplate?: (template: PjtModelTemplate) => void;
  currentUnitParts?: PartItem[];
}

const STORAGE_TEMPLATES_KEY = "VISION_PASS_PJT_TEMPLATES_V2";

export const PresetModal: React.FC<PresetModalProps> = ({
  isOpen,
  onClose,
  onAddParts,
  onReplaceParts,
  onSelectTemplate,
  currentUnitParts = [],
}) => {
  const [activeTab, setActiveTab] = useState<"TEMPLATES" | "EXCEL_UPLOAD" | "INDIVIDUAL">("TEMPLATES");

  // PJT Model Templates Dynamic State (Loaded from localStorage)
  const [templates, setTemplates] = useState<PjtModelTemplate[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_TEMPLATES_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (e) {
        console.warn("Failed to load templates from localStorage", e);
      }
    }
    return PJT_MODEL_TEMPLATES;
  });

  // Save templates to localStorage whenever modified
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && templates.length > 0) {
        localStorage.setItem(STORAGE_TEMPLATES_KEY, JSON.stringify(templates));
      }
    } catch (e) {
      console.warn("Failed to save templates to localStorage", e);
    }
  }, [templates]);

  // Template Editor Modal State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PjtModelTemplate | null>(null);
  const [editorModelName, setEditorModelName] = useState("");
  const [editorDescription, setEditorDescription] = useState("");
  const [editorParts, setEditorParts] = useState<PartItem[]>([]);
  const [draggedEditorIdx, setDraggedEditorIdx] = useState<number | null>(null);
  const [dragOverEditorIdx, setDragOverEditorIdx] = useState<number | null>(null);

  // 드래그 앤 드롭 순서 변경 핸들러
  const handleEditorDragStart = (e: React.DragEvent, index: number) => {
    setDraggedEditorIdx(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index.toString());
  };

  const handleEditorDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverEditorIdx !== index) {
      setDragOverEditorIdx(index);
    }
  };

  const handleEditorDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedEditorIdx === null || draggedEditorIdx === dropIndex) {
      setDraggedEditorIdx(null);
      setDragOverEditorIdx(null);
      return;
    }

    setEditorParts((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(draggedEditorIdx, 1);
      updated.splice(dropIndex, 0, moved);
      return updated;
    });

    setDraggedEditorIdx(null);
    setDragOverEditorIdx(null);
  };

  // Tab 2: Excel Upload State
  const [isUploading, setIsUploading] = useState(false);
  const [parsedExcelParts, setParsedExcelParts] = useState<PartItem[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorFileInputRef = useRef<HTMLInputElement>(null);

  // Tab 3: Individual Parts State
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  if (!isOpen) return null;

  // 1. 모델 템플릿 적용 (전체 교체 또는 추가)
  const handleApplyTemplate = (template: PjtModelTemplate, replace: boolean = true) => {
    const newItems: PartItem[] = template.parts.map((p) => ({
      ...p,
      id: generateId(),
      detectedSerial: "",
      isVerified: false,
    }));

    if (onSelectTemplate) {
      onSelectTemplate(template);
    } else if (replace && onReplaceParts) {
      onReplaceParts(newItems);
    } else {
      onAddParts(newItems);
    }
    onClose();
  };

  // 2. 신규 양식 생성 열기
  const handleOpenCreateNewTemplate = () => {
    const newId = `tpl-custom-${Date.now()}`;
    setEditingTemplate(null);
    setEditorModelName("");
    setEditorDescription("");
    setEditorParts(
      currentUnitParts.length > 0
        ? currentUnitParts.map((p) => ({ ...p, id: generateId() }))
        : [
          {
            id: generateId(),
            category: "[ MAIN ]",
            partName: "신규 공정 부품",
            subSpec: "-",
            spec: "표준 규격 입력",
            detectedSerial: "",
            isVerified: false,
          },
        ]
    );
    setIsEditorOpen(true);
  };

  // 3. 기존 양식 수정 열기
  const handleOpenEditTemplate = (tpl: PjtModelTemplate) => {
    setEditingTemplate(tpl);
    setEditorModelName(tpl.modelName);
    setEditorDescription(tpl.description || "");
    setEditorParts(tpl.parts.map((p) => ({ ...p, id: p.id || generateId() })));
    setIsEditorOpen(true);
  };

  // 4. 양식 삭제
  const handleDeleteTemplate = (id: string, name: string) => {
    if (confirm(`「${name}」 PJT 양식을 목록에서 삭제하시겠습니까?`)) {
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    }
  };

  // 5. 기본 양식으로 초기화
  const handleResetTemplatesToDefault = () => {
    if (confirm("모든 양식을 초기 표준 5개 모델 양식으로 복원하시겠습니까?")) {
      setTemplates(PJT_MODEL_TEMPLATES);
      localStorage.removeItem(STORAGE_TEMPLATES_KEY);
    }
  };

  // 6. 템플릿 에디터 저장
  const handleSaveTemplateEditor = () => {
    if (!editorModelName.trim()) {
      alert("양식 이름(모델명)을 입력해주세요.");
      return;
    }

    if (editorParts.length === 0) {
      alert("최소 1개 이상의 부품이 등록되어야 합니다.");
      return;
    }

    // 모듈 수 계산
    const moduleSet = new Set(editorParts.map((p) => p.category || "[ MAIN ]"));

    if (editingTemplate) {
      // 기존 수정
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === editingTemplate.id
            ? {
              ...t,
              modelName: editorModelName.trim(),
              description: editorDescription.trim(),
              partsCount: editorParts.length,
              moduleCount: moduleSet.size,
              parts: editorParts,
            }
            : t
        )
      );
    } else {
      // 신규 추가
      const newTpl: PjtModelTemplate = {
        id: `tpl-custom-${Date.now()}`,
        modelName: editorModelName.trim(),
        description: editorDescription.trim() || `${editorParts.length}개 품목 사용자 등록 양식`,
        partsCount: editorParts.length,
        moduleCount: moduleSet.size,
        parts: editorParts,
        isCustom: true,
      };
      setTemplates((prev) => [...prev, newTpl]);
    }

    setIsEditorOpen(false);
  };

  // 7. 엑셀 파일 안전 파싱 헬퍼 함수 (지능형 헤더 감지 & 컬럼 자동 매칭)
  const parseExcelBufferToParts = async (buffer: ArrayBuffer): Promise<PartItem[]> => {
    let rawRows: any[][] = [];

    // 1차: SheetJS
    if (typeof window !== "undefined" && (window as any).XLSX && (window as any).XLSX.read) {
      try {
        const u8 = new Uint8Array(buffer);
        const wb = (window as any).XLSX.read(u8, { type: "array", cellDates: true });
        if (wb && wb.SheetNames && wb.SheetNames.length > 0) {
          const ws = wb.Sheets[wb.SheetNames[0]];
          if (ws) {
            rawRows = (window as any).XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          }
        }
      } catch (e) {
        console.warn("SheetJS fallback to ExcelJS", e);
      }
    }

    // 2차: ExcelJS
    if (!rawRows || rawRows.length === 0) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets && workbook.worksheets[0];
      if (!worksheet) throw new Error("엑셀 파일에 시트가 존재하지 않습니다.");

      worksheet.eachRow({ includeEmpty: false }, (row: any) => {
        const rowValues: string[] = [];
        for (let colIdx = 1; colIdx <= 12; colIdx++) {
          try {
            const cell = row.getCell(colIdx);
            let textVal = "";
            if (cell && cell.value !== null && cell.value !== undefined) {
              if (typeof cell.value === "object") {
                if (cell.value.result !== undefined && cell.value.result !== null) {
                  textVal = String(cell.value.result);
                } else if (Array.isArray(cell.value.richText)) {
                  textVal = cell.value.richText.map((r: any) => (r && r.text ? r.text : "")).join("");
                } else if (cell.value.text !== undefined && cell.value.text !== null) {
                  textVal = String(cell.value.text);
                } else {
                  textVal = String(cell.value || "");
                }
              } else {
                textVal = String(cell.value);
              }
            }
            rowValues.push(textVal.trim());
          } catch (e) {
            rowValues.push("");
          }
        }
        rawRows.push(rowValues);
      });
    }

    // --- 헤더 행 및 컬럼 인덱스 자동 감지 ---
    let headerRowIdx = -1;
    let colPartName = -1;
    let colSubSpec = -1;
    let colSpec = -1;
    let colSerial = -1;

    for (let r = 0; r < Math.min(rawRows.length, 30); r++) {
      const row = (rawRows[r] || []).map((cell: any) => String(cell || "").replace(/\s+/g, ""));
      if (row.length === 0) continue;

      const pIdx = row.findIndex((c: string) => /^(품명|부품명|품목|partname|part|item)$/i.test(c));
      const subIdx = row.findIndex((c: string) => /^(세부사항|세부|subspec|sub_spec|용도|위치|비고)$/i.test(c));
      const sIdx = row.findIndex((c: string) => /^(규격|사양|spec|specification|model|모델명|모델)$/i.test(c));
      const snIdx = row.findIndex((c: string) => /^(serialno\.?|serialnumber|serial|시리얼|s\/n|sn|일련번호)$/i.test(c));

      if (pIdx !== -1) {
        headerRowIdx = r;
        colPartName = pIdx;
        colSubSpec = subIdx;
        colSpec = sIdx;
        colSerial = snIdx;
        break;
      }
    }

    const extracted: PartItem[] = [];
    let currentCategory = "[ MAIN ]";
    const startRow = headerRowIdx !== -1 ? headerRowIdx + 1 : 0;

    let lastPartName = "";
    let lastSubSpec = "";

    for (let r = startRow; r < rawRows.length; r++) {
      const row = rawRows[r] || [];
      if (!Array.isArray(row) || row.length === 0) continue;

      const cells = row.map((c: any) => (c !== undefined && c !== null ? String(c).trim() : ""));
      const nonEmpty = cells.filter((c: string) => c.length > 0);
      if (nonEmpty.length === 0) continue;

      const firstVal = nonEmpty[0] || "";

      // 상단 문서 제목, 헤더 박스 및 비고 제외
      if (
        firstVal.includes("시리얼 리스트") ||
        firstVal.includes("시리얼리스트") ||
        firstVal.includes("모 델 명") ||
        firstVal.includes("모델명") ||
        firstVal.includes("작성자") ||
        firstVal.includes("비 고") ||
        firstVal.includes("비고")
      ) {
        continue;
      }

      // 모듈 구분 바 감지 (예: [ MAIN ], [ MG ], [ WOA-683 ], [ MAIN(AutoSol) ])
      if (firstVal.startsWith("[") && (firstVal.endsWith("]") || nonEmpty.length === 1)) {
        currentCategory = firstVal.startsWith("[") && firstVal.endsWith("]")
          ? firstVal
          : `[ ${firstVal.replace(/[\[\]]/g, "").trim()} ]`;
        lastPartName = "";
        lastSubSpec = "";
        continue;
      }

      // 테이블 헤더 반복 행 제외
      if (firstVal === "품명" || firstVal === "부품명" || firstVal === "Part Name") {
        continue;
      }

      let rawPartName = "";
      let rawSubSpec = "";
      let rawSpec = "";
      let rawSerial = "";

      if (headerRowIdx !== -1 && colPartName !== -1) {
        // (A) 헤더 위치 기반 정확한 컬럼 매핑
        rawPartName = colPartName !== -1 && cells[colPartName] ? cells[colPartName] : "";
        rawSubSpec = colSubSpec !== -1 && cells[colSubSpec] ? cells[colSubSpec] : "";
        rawSpec = colSpec !== -1 && cells[colSpec] ? cells[colSpec] : "";
        rawSerial = colSerial !== -1 && cells[colSerial] ? cells[colSerial] : "";
      } else {
        // (B) 헤더 없는 순수 데이터 행 fallback
        const isCol0Number = /^\d+$/.test(cells[0] || "");
        const offset = isCol0Number ? 1 : (cells[0] ? 0 : 1);

        rawPartName = cells[offset] || "";
        rawSubSpec = cells[offset + 1] || "";
        rawSpec = cells[offset + 2] || "";
        rawSerial = cells[offset + 3] || "";
      }

      // 아무 데이터도 없는 빈 행 건너뛰기
      if (!rawPartName && !rawSubSpec && !rawSpec && !rawSerial) {
        continue;
      }

      // 🔄 엑셀 세로 병합 셀(Merged Cells) 자동 상속 처리 (예: PC, Control Board)
      // 이전 행의 품명이 있고 현재 행 품명이 병합되어 비어있는 경우 이전 품명 상속
      let finalPartName = rawPartName;
      if (!finalPartName && (rawSubSpec || rawSpec || rawSerial) && lastPartName) {
        finalPartName = lastPartName;
      }

      // 세부사항도 병합되어 비어있고 품명이 상속된 경우 이전 세부사항 상속
      let finalSubSpec = rawSubSpec;
      if (!finalSubSpec && finalPartName === lastPartName && lastSubSpec && !rawPartName) {
        finalSubSpec = lastSubSpec;
      }

      if (rawPartName) {
        lastPartName = rawPartName;
        lastSubSpec = rawSubSpec;
      }

      if (finalPartName && !finalPartName.startsWith("[")) {
        extracted.push({
          id: generateId(),
          category: currentCategory,
          partName: finalPartName,
          subSpec: finalSubSpec || "-",
          spec: rawSpec || "-",
          detectedSerial: rawSerial || "",
          isVerified: Boolean(rawSerial && rawSerial.length > 0),
        });
      }
    }

    if (extracted.length === 0) {
      throw new Error("엑셀 파일에서 유효한 부품 목록을 찾을 수 없습니다.");
    }

    return extracted;
  };

  // 8. Tab 2 엑셀 업로드 핸들러
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setIsUploading(true);
    setUploadedFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const extracted = await parseExcelBufferToParts(buffer);
      setParsedExcelParts(extracted);
    } catch (err: any) {
      console.error(err);
      setUploadError(err?.message || "엑셀 파일 분석 중 오류가 발생했습니다.");
      setParsedExcelParts([]);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // 9. 에디터 안에서 엑셀 파일로 부품 가져오기
  const handleEditorExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const extracted = await parseExcelBufferToParts(buffer);
      setEditorParts(extracted);
      if (!editorModelName.trim()) {
        const pureName = file.name.replace(/\.[^/.]+$/, "");
        setEditorModelName(pureName);
      }
    } catch (err: any) {
      alert(err?.message || "엑셀 파일 분석 중 오류가 발생했습니다.");
    } finally {
      if (editorFileInputRef.current) editorFileInputRef.current.value = "";
    }
  };

  // 엑셀 파싱 부품 적용
  const handleApplyExcelParts = (replace: boolean = true) => {
    if (parsedExcelParts.length === 0) return;
    const newItems = parsedExcelParts.map((p) => ({
      ...p,
      id: generateId(),
      detectedSerial: "",
      isVerified: false,
    }));

    if (onSelectTemplate) {
      onSelectTemplate({
        id: `tpl-excel-${Date.now()}`,
        modelName: uploadedFileName.replace(/\.[^/.]+$/, "") || "엑셀 업로드 양식",
        description: `엑셀 파일(${uploadedFileName})에서 직접 추출된 ${parsedExcelParts.length}개 품목 양식`,
        partsCount: parsedExcelParts.length,
        moduleCount: new Set(parsedExcelParts.map((p) => p.category)).size,
        parts: newItems,
      });
    }

    if (replace && onReplaceParts) {
      onReplaceParts(newItems);
    } else {
      onAddParts(newItems);
    }
    onClose();
  };

  // Tab 3: 개별 부품 프리셋 필터링
  const categories = [
    "ALL",
    ...Array.from(new Set(STANDARD_PART_PRESETS.map((p) => p.category))),
  ];

  const filteredPresets = STANDARD_PART_PRESETS.filter((p) => {
    const matchesCat = activeCategory === "ALL" || p.category === activeCategory;
    const matchesSearch =
      p.partName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.spec.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleApplyIndividual = () => {
    const selectedPresets = STANDARD_PART_PRESETS.filter((p) =>
      selectedIds.includes(p.id)
    );

    const newPartItems: PartItem[] = selectedPresets.map((p) => ({
      id: generateId(),
      category: p.category ? (p.category.startsWith("[") ? p.category : `[ ${p.category} ]`) : "[ MAIN ]",
      partName: p.partName,
      subSpec: p.subSpec || "-",
      spec: p.spec,
      detectedSerial: "",
      isVerified: false,
    }));

    onAddParts(newPartItems);
    setSelectedIds([]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-4xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shrink-0">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="text-base sm:text-lg font-bold text-white whitespace-nowrap">
                PJT 양식
              </h3>
              <span className="bg-cyan-950/80 text-cyan-300 border border-cyan-700/60 text-xs font-mono font-bold px-3 py-1 rounded-full shadow-sm whitespace-nowrap">
                총 {templates.length}개 양식
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation & Top-Right Action Button */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between border-b border-slate-800 bg-slate-950/40 px-5 pt-3 gap-2">
          <div className="flex gap-2 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab("TEMPLATES")}
              className={`flex items-center gap-2 pb-3 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer shrink-0 ${activeTab === "TEMPLATES"
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
            >
              <Layers className="h-4 w-4" />
              <span>1. 모델별 표준 PJT 양식 ({templates.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("EXCEL_UPLOAD")}
              className={`flex items-center gap-2 pb-3 px-3 text-xs font-bold transition-all border-b-2 cursor-pointer shrink-0 ${activeTab === "EXCEL_UPLOAD"
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
            >
              <UploadCloud className="h-4 w-4" />
              <span>2. 엑셀 파일(.xlsx) 직접 업로드</span>
            </button>
          </div>

          {/* 우측 상단: 신규 PJT 양식 추가 버튼 */}
          <div className="flex items-center gap-2 pb-2 sm:pb-0">
            <button
              type="button"
              onClick={handleOpenCreateNewTemplate}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-3.5 py-1.5 text-xs font-extrabold text-slate-950 shadow-glow-cyan hover:opacity-95 transition-all cursor-pointer shrink-0"
              title="새로운 설비 모델의 BOM 양식을 생성하여 등록"
            >
              <Plus className="h-4 w-4 stroke-[3]" />
              <span>+ 신규 PJT 양식 추가</span>
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* TAB 1: 모델별 표준 PJT 양식 */}
          {activeTab === "TEMPLATES" && (
            <div className="space-y-3">
              {/* 📜 10~20개 이상의 양식도 편안하게 탐색 가능한 전용 스크롤 컨테이너 */}
              <div className="max-h-[500px] overflow-y-auto pr-1 space-y-3 custom-scrollbar">
                {templates.length === 0 ? (
                  <div className="py-12 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/40">
                    <p className="text-sm text-slate-400 font-semibold mb-3">등록된 PJT 양식이 없습니다.</p>
                    <button
                      type="button"
                      onClick={handleResetTemplatesToDefault}
                      className="px-4 py-2 bg-slate-800 text-cyan-300 text-xs rounded-xl border border-slate-700 hover:bg-slate-700 cursor-pointer font-bold"
                    >
                      기본 5개 양식으로 복원하기
                    </button>
                  </div>
                ) : (
                  templates.map((tpl, idx) => {
                    return (
                      <div
                        key={tpl.id}
                        className="p-3.5 sm:p-4 rounded-2xl border bg-slate-950/70 border-slate-800 hover:border-slate-700 transition-all space-y-3 shadow-md group"
                      >
                        {/* 상단 1행: [01 순번 + 모델명] (좌측) & [🗑️ 삭제 버튼] (우측) */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            {/* 🔢 순번 뱃지 */}
                            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 border border-slate-800 font-mono font-extrabold text-cyan-400 text-xs shrink-0 shadow-inner group-hover:border-cyan-500/40 group-hover:text-cyan-300 transition-all">
                              {String(idx + 1).padStart(2, "0")}
                            </div>

                            {/* 모델명 타이틀 */}
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="font-bold text-sm sm:text-base text-white truncate" title={tpl.modelName}>
                                {tpl.modelName}
                              </span>
                              {tpl.isCustom && (
                                <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-700/60 px-2 py-0.5 rounded text-[10px] font-bold shrink-0">
                                  사용자 등록
                                </span>
                              )}
                            </div>
                          </div>

                          {/* 🗑️ 모델명 옆 삭제 버튼 */}
                          <button
                            type="button"
                            onClick={() => handleDeleteTemplate(tpl.id, tpl.modelName)}
                            className="p-2 rounded-xl bg-slate-900 text-slate-400 border border-slate-800 hover:bg-red-950 hover:text-red-400 hover:border-red-800 transition-all cursor-pointer shrink-0"
                            title="이 양식 삭제"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        {/* 하단 2행: [N개 품목 뱃지] (좌측) & [양식 수정 + PJT 양식 선택 버튼] (우측) */}
                        <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-slate-800/80">
                          {/* 좌측: N개 품목 뱃지 */}
                          <span className="bg-cyan-950/90 text-cyan-300 border border-cyan-700/60 px-3 py-1.5 rounded-xl text-xs font-mono font-bold whitespace-nowrap shadow-sm">
                            {tpl.parts?.length || tpl.partsCount || 0}개 품목
                          </span>

                          {/* 우측: 양식 수정 & PJT 양식 선택 버튼 */}
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleOpenEditTemplate(tpl)}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all cursor-pointer shrink-0"
                              title="양식명 및 부품 구성 수정"
                            >
                              <Edit2 className="h-3.5 w-3.5 text-slate-400" />
                              <span>양식 수정</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleApplyTemplate(tpl, true)}
                              className="bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-extrabold px-3.5 py-1.5 rounded-xl text-xs shadow-glow-cyan hover:opacity-95 cursor-pointer flex items-center gap-1.5 shrink-0"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              <span>PJT 양식 선택</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 2: 엑셀 파일(.xlsx) 직접 업로드 */}
          {activeTab === "EXCEL_UPLOAD" && (
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileUpload}
                className="hidden"
              />

              {/* Upload Drop Area */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-cyan-500/40 hover:border-cyan-400 bg-slate-950/60 hover:bg-slate-950 rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3"
              >
                <div className="h-14 w-14 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center border border-cyan-500/30 shadow-glow-cyan">
                  <UploadCloud className="h-7 w-7" />
                </div>
                <div>
                  <h4 className="font-bold text-white text-sm">
                    설비 엑셀 시리얼 리스트 파일(.xlsx)을 업로드하세요
                  </h4>
                  <p className="text-xs text-slate-400 mt-1">
                    클릭하거나 파일을 이곳에 드래그하면, 엑셀 속 모듈 및 품명/세부사항/규격을 자동으로 읽어옵니다.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 shadow-sm mt-1">
                  <FileSpreadsheet className="h-4 w-4" />
                  <span>내 컴퓨터에서 엑셀 파일 선택</span>
                </span>
              </div>

              {isUploading && (
                <div className="p-4 bg-slate-950 rounded-xl border border-cyan-800 text-center text-xs text-cyan-300 animate-pulse">
                  엑셀 시트를 분석하여 부품 목록을 추출하는 중입니다...
                </div>
              )}

              {uploadError && (
                <div className="p-3.5 bg-red-950/60 border border-red-800 rounded-xl text-xs text-red-300 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                  <span>{uploadError}</span>
                </div>
              )}

              {/* Parsed Excel Preview Table */}
              {parsedExcelParts.length > 0 && (
                <div className="rounded-2xl border border-emerald-800/80 bg-slate-950/80 overflow-hidden space-y-3 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      <span className="font-bold text-emerald-300 text-xs">
                        「{uploadedFileName}」에서 총 {parsedExcelParts.length}개 부품 품명을 성공적으로 추출했습니다!
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTemplate(null);
                          setEditorModelName(uploadedFileName.replace(/\.[^/.]+$/, ""));
                          setEditorDescription(`엑셀 파일 「${uploadedFileName}」에서 등록된 양식`);
                          setEditorParts(parsedExcelParts);
                          setIsEditorOpen(true);
                        }}
                        className="bg-slate-800 text-slate-200 border border-slate-700 font-bold px-3 py-2 rounded-xl text-xs hover:bg-slate-700 cursor-pointer flex items-center gap-1.5"
                      >
                        <FolderPlus className="h-3.5 w-3.5 text-cyan-400" />
                        <span>이 엑셀을 새 PJT 양식으로 저장</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleApplyExcelParts(true)}
                        className="bg-emerald-500 text-slate-950 font-extrabold px-4 py-2 rounded-xl text-xs shadow-glow-emerald hover:opacity-95 cursor-pointer flex items-center gap-1.5"
                      >
                        <Check className="h-4 w-4 stroke-[3]" />
                        <span>현재 호기에 전체 나열 (적용)</span>
                      </button>
                    </div>
                  </div>

                  <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-900 text-slate-400 font-semibold sticky top-0">
                        <tr>
                          <th className="p-2 w-10 text-center">No</th>
                          <th className="p-2">모듈</th>
                          <th className="p-2">품명</th>
                          <th className="p-2">세부 사항</th>
                          <th className="p-2">규격</th>
                          <th className="p-2">Serial No.</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {parsedExcelParts.map((p, idx) => (
                          <tr key={idx} className="hover:bg-slate-900/50">
                            <td className="p-2 text-center text-slate-500 font-mono font-bold">{idx + 1}</td>
                            <td className="p-2 text-cyan-300 font-mono text-[11px] font-bold">{p.category}</td>
                            <td className="p-2 text-slate-200 font-semibold">{p.partName}</td>
                            <td className="p-2 text-slate-400">{p.subSpec}</td>
                            <td className="p-2 text-slate-400 font-mono text-[11px]">{p.spec}</td>
                            <td className="p-2 text-cyan-400 font-mono text-[11px]">{p.detectedSerial || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            등록 및 수정하신 PJT 양식은 브라우저에 자동 저장되어 언제든지 재사용할 수 있습니다.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold hover:bg-slate-700 cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>

      {/* ✏️ PJT 양식 추가 / 수정 모달 (Template Editor) */}
      {isEditorOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center p-3 bg-black/90 backdrop-blur-md animate-fadeIn"
          style={{ zIndex: 9999 }}
        >
          <div className="relative w-full max-w-3xl rounded-2xl bg-slate-900 border border-cyan-500/50 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
            <input
              ref={editorFileInputRef}
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleEditorExcelUpload}
              className="hidden"
            />

            {/* Editor Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  <Edit2 className="h-4 w-4" />
                </div>
                <h4 className="text-sm font-bold text-white">
                  {editingTemplate ? `「${editingTemplate.modelName}」 양식 수정` : "신규 PJT 양식 추가 등록"}
                </h4>
              </div>
              <button
                onClick={() => setIsEditorOpen(false)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer text-sm"
              >
                ✕
              </button>
            </div>

            {/* Editor Form Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">
                    양식 이름 (모델명) <span className="text-cyan-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={editorModelName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditorModelName(e.target.value)}
                    placeholder="예: TM100L (NaVi-TM100L-0312)"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">양식 설명 / 비고</label>
                  <input
                    type="text"
                    value={editorDescription}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditorDescription(e.target.value)}
                    placeholder="예: 8개 모듈 사내 표준 시리얼 리스트 양식"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Parts Toolbar */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <span className="font-bold text-white">
                  포함 부품 목록 ({editorParts.length}개 품목)
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => editorFileInputRef.current?.click()}
                    className="bg-cyan-950/80 text-cyan-300 border border-cyan-800/80 px-2.5 py-1.5 rounded-lg font-semibold hover:bg-cyan-900 cursor-pointer flex items-center gap-1 text-[11px]"
                    title="엑셀 파일을 읽어와 부품 리스트를 일괄 채웁니다"
                  >
                    <UploadCloud className="h-3.5 w-3.5" />
                    <span>📂 엑셀에서 가져오기</span>
                  </button>

                  {currentUnitParts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditorParts(currentUnitParts.map((p) => ({ ...p, id: generateId() })));
                      }}
                      className="bg-slate-800 text-slate-300 border border-slate-700 px-2.5 py-1.5 rounded-lg font-semibold hover:bg-slate-700 cursor-pointer flex items-center gap-1 text-[11px]"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>현재 호기 부품 복사</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setEditorParts((prev) => [
                        ...prev,
                        {
                          id: generateId(),
                          category: prev.length > 0 ? prev[prev.length - 1].category : "[ MAIN ]",
                          partName: "",
                          subSpec: "-",
                          spec: "",
                          detectedSerial: "",
                          isVerified: false,
                        },
                      ]);
                    }}
                    className="bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 px-2.5 py-1.5 rounded-lg font-bold hover:bg-cyan-500/30 cursor-pointer flex items-center gap-1 text-[11px]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>부품 추가</span>
                  </button>
                </div>
              </div>

              {/* Editable Parts Table */}
              <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-800">
                <table className="w-full text-left">
                  <thead className="bg-slate-950 text-slate-400 font-semibold sticky top-0 text-[11px] z-10">
                    <tr>
                      <th className="p-2 w-8 text-center" title="마우스로 잡고 드래그하여 순서 변경">이동</th>
                      <th className="p-2 w-8 text-center">No</th>
                      <th className="p-2 w-28">모듈 구분</th>
                      <th className="p-2 min-w-[120px]">품명</th>
                      <th className="p-2 w-24">세부사항</th>
                      <th className="p-2 min-w-[120px]">규격</th>
                      <th className="p-2 w-10 text-center">삭제</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-[11px]">
                    {editorParts.map((p, idx) => (
                      <tr
                        key={p.id || idx}
                        draggable
                        onDragStart={(e) => handleEditorDragStart(e, idx)}
                        onDragOver={(e) => handleEditorDragOver(e, idx)}
                        onDrop={(e) => handleEditorDrop(e, idx)}
                        onDragEnd={() => {
                          setDraggedEditorIdx(null);
                          setDragOverEditorIdx(null);
                        }}
                        className={`transition-colors ${
                          draggedEditorIdx === idx
                            ? "opacity-30 bg-cyan-950/70"
                            : dragOverEditorIdx === idx
                            ? "border-t-2 border-cyan-400 bg-cyan-950/50"
                            : "hover:bg-slate-900/50"
                        }`}
                      >
                        {/* ⠿ 드래그 핸들 */}
                        <td className="p-1 text-center">
                          <div
                            className="flex items-center justify-center text-slate-500 hover:text-cyan-300 cursor-grab active:cursor-grabbing p-1 rounded hover:bg-slate-800"
                            title="마우스로 잡고 위/아래로 드래그하여 순서 변경"
                          >
                            <GripVertical className="h-4 w-4" />
                          </div>
                        </td>

                        <td className="p-2 text-center text-slate-500 font-mono font-bold">
                          {idx + 1}
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={p.category || ""}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const val = e.target.value;
                              setEditorParts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, category: val } : item))
                              );
                            }}
                            placeholder="[ MAIN ]"
                            className="w-full bg-slate-950 border border-slate-800 rounded p-1 text-cyan-300 font-mono font-bold focus:border-cyan-500 focus:outline-none"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={p.partName || ""}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const val = e.target.value;
                              setEditorParts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, partName: val } : item))
                              );
                            }}
                            placeholder="품명 입력"
                            className="w-full bg-slate-950 border border-slate-800 rounded p-1 text-white font-semibold focus:border-cyan-500 focus:outline-none"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={p.subSpec || ""}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const val = e.target.value;
                              setEditorParts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, subSpec: val } : item))
                              );
                            }}
                            placeholder="-"
                            className="w-full bg-slate-950 border border-slate-800 rounded p-1 text-slate-300 focus:border-cyan-500 focus:outline-none"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={p.spec || ""}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const val = e.target.value;
                              setEditorParts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, spec: val } : item))
                              );
                            }}
                            placeholder="규격 입력"
                            className="w-full bg-slate-950 border border-slate-800 rounded p-1 text-slate-300 font-mono focus:border-cyan-500 focus:outline-none"
                          />
                        </td>
                        <td className="p-1 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              setEditorParts((prev) => prev.filter((_, i) => i !== idx));
                            }}
                            className="text-slate-500 hover:text-red-400 p-1 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Editor Footer */}
            <div className="p-3 border-t border-slate-800 bg-slate-950 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 text-slate-300 text-xs hover:bg-slate-700 cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveTemplateEditor}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 text-xs font-bold shadow-glow-cyan hover:opacity-95 cursor-pointer"
              >
                <Save className="h-3.5 w-3.5" />
                <span>양식 저장 완료</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
