"use client";

import React, { useState, useEffect, useRef, useMemo, Fragment } from "react";
import { PjtModelTemplate, PartItem } from "@/types";
import { PJT_MODEL_TEMPLATES } from "@/lib/default-presets";
import { generateId } from "@/lib/utils";
import { exportEquipmentReportExcel } from "@/lib/excel-export";
import {
  Layers,
  Plus,
  Edit2,
  Trash2,
  Copy,
  Download,
  UploadCloud,
  Search,
  CheckCircle2,
  X,
} from "lucide-react";

const TEMPLATES_STORAGE_KEY = "VISION_PASS_PJT_TEMPLATES_V2";

export const TemplateManagerStep: React.FC = () => {
  // 1. Templates State
  const [templates, setTemplates] = useState<PjtModelTemplate[]>(() => {
    try {
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem(TEMPLATES_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      }
    } catch (e) {
      console.warn("Failed to load templates from localStorage", e);
    }
    return PJT_MODEL_TEMPLATES;
  });

  // LocalStorage Auto-save
  useEffect(() => {
    try {
      if (templates && templates.length > 0) {
        localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
      }
    } catch (e) {
      console.warn("Failed to save templates to localStorage", e);
    }
  }, [templates]);

  // 2. Active Selected Template for Detail View
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(() => {
    return templates[0]?.id || "tpl-tm100l";
  });

  const selectedTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId) || templates[0] || null;
  }, [templates, selectedTemplateId]);

  // 3. Search filter
  const [searchQuery, setSearchQuery] = useState("");
  const [partSearchQuery, setPartSearchQuery] = useState("");

  const filteredTemplates = useMemo(() => {
    if (!searchQuery.trim()) return templates;
    const q = searchQuery.toLowerCase();
    return templates.filter(
      (t) =>
        t.modelName.toLowerCase().includes(q) ||
        (t.description && t.description.toLowerCase().includes(q)) ||
        (t.parts &&
          t.parts.some(
            (p) =>
              (p.partName && p.partName.toLowerCase().includes(q)) ||
              (p.spec && p.spec.toLowerCase().includes(q)) ||
              (p.subSpec && p.subSpec.toLowerCase().includes(q)) ||
              (p.category && p.category.toLowerCase().includes(q))
          ))
    );
  }, [templates, searchQuery]);

  const filteredParts = useMemo(() => {
    if (!selectedTemplate || !selectedTemplate.parts) return [];
    if (!partSearchQuery.trim()) return selectedTemplate.parts;
    const q = partSearchQuery.toLowerCase();
    return selectedTemplate.parts.filter(
      (p) =>
        (p.partName && p.partName.toLowerCase().includes(q)) ||
        (p.spec && p.spec.toLowerCase().includes(q)) ||
        (p.subSpec && p.subSpec.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q))
    );
  }, [selectedTemplate, partSearchQuery]);

  // 4. Editor Modal State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PjtModelTemplate | null>(null);
  const [editorModelName, setEditorModelName] = useState("");
  const [editorDescription, setEditorDescription] = useState("");
  const [editorParts, setEditorParts] = useState<PartItem[]>([]);
  const editorFileInputRef = useRef<HTMLInputElement>(null);

  // Open Create New Template
  const handleOpenCreate = () => {
    setEditingTemplate(null);
    setEditorModelName("");
    setEditorDescription("");
    setEditorParts([
      {
        id: generateId(),
        category: "[ MAIN ]",
        partName: "신규 부품 1",
        subSpec: "-",
        spec: "표준 규격 입력",
        detectedSerial: "",
        isVerified: false,
      },
    ]);
    setIsEditorOpen(true);
  };

  // Open Edit Existing Template
  const handleOpenEdit = (tpl: PjtModelTemplate, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingTemplate(tpl);
    setEditorModelName(tpl.modelName);
    setEditorDescription(tpl.description || "");
    setEditorParts(tpl.parts ? tpl.parts.map((p) => ({ ...p, id: generateId() })) : []);
    setIsEditorOpen(true);
  };

  // Save Template (Create or Update)
  const handleSaveTemplate = () => {
    if (!editorModelName.trim()) {
      alert("양식 이름 (모델명)을 입력해주세요.");
      return;
    }
    if (editorParts.length === 0) {
      alert("최소 1개 이상의 부품을 추가해주세요.");
      return;
    }

    const moduleSet = new Set(editorParts.map((p) => p.category || "[ MAIN ]"));

    if (editingTemplate) {
      // Update existing
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
      // Create new
      const newTpl: PjtModelTemplate = {
        id: `tpl-custom-${generateId()}`,
        modelName: editorModelName.trim(),
        description: editorDescription.trim() || "사용자 등록 설비 BOM 양식",
        partsCount: editorParts.length,
        moduleCount: moduleSet.size,
        isCustom: true,
        parts: editorParts,
      };
      setTemplates((prev) => [newTpl, ...prev]);
      setSelectedTemplateId(newTpl.id);
    }

    setIsEditorOpen(false);
  };

  // Duplicate Template
  const handleDuplicateTemplate = (tpl: PjtModelTemplate, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const dup: PjtModelTemplate = {
      ...tpl,
      id: `tpl-custom-${generateId()}`,
      modelName: `${tpl.modelName} (COPY)`,
      description: `${tpl.description || ""} (복제본)`.trim(),
      isCustom: true,
      parts: (tpl.parts || []).map((p) => ({ ...p, id: generateId(), detectedSerial: "", isVerified: false })),
    };
    setTemplates((prev) => [dup, ...prev]);
    setSelectedTemplateId(dup.id);
  };

  // Delete Template
  const handleDeleteTemplate = (tplId: string, modelName: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (templates.length <= 1) {
      alert("최소 1개 이상의 양식이 유지되어야 합니다.");
      return;
    }
    if (confirm(`「${modelName}」 양식을 삭제하시겠습니까?`)) {
      const remaining = templates.filter((t) => t.id !== tplId);
      setTemplates(remaining);
      if (selectedTemplateId === tplId) {
        setSelectedTemplateId(remaining[0]?.id || "");
      }
    }
  };

  // Excel Upload Parser for Template Editor
  const handleEditorExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      let rawRows: any[][] = [];

      if (typeof window !== "undefined" && (window as any).XLSX) {
        const XLSX = (window as any).XLSX;
        const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
        if (wb.SheetNames?.length > 0) {
          const ws = wb.Sheets[wb.SheetNames[0]];
          if (ws) {
            rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          }
        }
      }

      if (rawRows.length === 0) {
        throw new Error("엑셀 파일에서 데이터를 읽을 수 없습니다.");
      }

      const extracted: PartItem[] = [];
      let currentCategory = "[ MAIN ]";
      let lastPartName = "";
      let lastSubSpec = "";

      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;

        const rowStr = row.map((c) => String(c || "").trim()).join(" ");
        const catMatch = rowStr.match(/\[\s*([^\]]+)\s*\]/);
        if (catMatch) {
          currentCategory = `[ ${catMatch[1].trim()} ]`;
          lastPartName = "";
          lastSubSpec = "";
          continue;
        }

        const rawPartName = String(row[1] || "").trim();
        const rawSubSpec = String(row[2] || "").trim();
        const rawSpec = String(row[3] || "").trim();
        const rawSerial = String(row[4] || "").trim();

        if (rawPartName && rawPartName.length > 0) {
          lastPartName = rawPartName;
        }
        if (rawSubSpec && rawSubSpec.length > 0) {
          lastSubSpec = rawSubSpec;
        }

        const finalPartName = lastPartName;
        const finalSubSpec = lastSubSpec;

        if (
          (finalPartName || rawSpec) &&
          !finalPartName.includes("품명") &&
          !rawSpec.includes("규격") &&
          !finalPartName.includes("Part Name")
        ) {
          extracted.push({
            id: generateId(),
            category: currentCategory,
            partName: finalPartName || "표준 부품",
            subSpec: finalSubSpec || "-",
            spec: rawSpec || "-",
            detectedSerial: rawSerial || "",
            isVerified: false,
          });
        }
      }

      if (extracted.length === 0) {
        alert("엑셀 파일에서 유효한 부품 목록을 찾을 수 없습니다.");
        return;
      }

      setEditorParts(extracted);
      if (!editorModelName.trim()) {
        const pureName = file.name.replace(/\.[^/.]+$/, "");
        setEditorModelName(pureName);
      }
      alert(`「${file.name}」에서 총 ${extracted.length}개 부품을 성공적으로 불러왔습니다!`);
    } catch (err: any) {
      alert(`엑셀 파일 분석 오류: ${err?.message || "알 수 없는 오류"}`);
    } finally {
      if (editorFileInputRef.current) editorFileInputRef.current.value = "";
    }
  };

  // Direct Template Export to Excel
  const handleExportTemplateExcel = (tpl: PjtModelTemplate) => {
    const dummyProject = {
      id: "pjt-template-export",
      site: "WITHTECH",
      pjtCode: tpl.modelName,
      equipmentName: tpl.modelName,
      quantity: 1,
      inspectorName: "관리자",
      inspectionDate: new Date().toISOString().split("T")[0],
      equipmentUnits: [
        {
          unitIndex: 1,
          equipmentSerial: `${tpl.modelName}-STD`,
          parts: tpl.parts,
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    exportEquipmentReportExcel(dummyProject as any);
  };

  return (
    <div className="space-y-6">
      {/* 1. Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-slate-900 via-cleanroom-850 to-slate-900 p-6 border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400 font-mono font-bold text-xs border border-cyan-500/30">
              04
            </span>
            <h2 className="text-xl font-bold text-white tracking-wide flex items-center gap-2">
              <span>설비 부품 양식 (BOM Template Management)</span>
              <span className="bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 text-xs font-mono font-bold px-2.5 py-0.5 rounded-full">
                총 {templates.length}개 양식
              </span>
            </h2>
          </div>
          <p className="mt-1.5 text-xs text-slate-400">
            WITHTECH 제작 설비 모델별 표준 부품 BOM 양식을 조회, 수정, 복제 및 엑셀 일괄 등록하여 관리합니다.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-xs font-extrabold text-slate-950 shadow-glow-cyan hover:opacity-95 transition-all cursor-pointer"
          >
            <Plus className="h-4 w-4 stroke-[3]" />
            <span>+ 신규 PJT 양식 추가</span>
          </button>
        </div>
      </div>

      {/* 2. Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: 양식 목록 (5 Cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-cyan-400" />
              <span>등록된 PJT 양식 목록 ({filteredTemplates.length})</span>
            </span>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="양식명, 설명, 부품명 검색..."
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Template Cards List */}
          <div className="space-y-2.5 max-h-[680px] overflow-y-auto pr-1 custom-scrollbar">
            {filteredTemplates.length === 0 ? (
              <div className="py-12 text-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-4">
                <p className="text-xs text-slate-400">검색 조건에 맞는 양식이 없습니다.</p>
              </div>
            ) : (
              filteredTemplates.map((tpl, idx) => {
                const isSelected = selectedTemplate?.id === tpl.id;
                return (
                  <div
                    key={tpl.id}
                    onClick={() => setSelectedTemplateId(tpl.id)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer group flex flex-col gap-2.5 relative ${
                      isSelected
                        ? "bg-slate-900/90 border-cyan-500/70 shadow-glow-cyan ring-1 ring-cyan-500/30"
                        : "bg-slate-950/70 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {/* 🔢 순번 뱃지 */}
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-xl font-mono font-extrabold text-xs shrink-0 transition-all ${
                            isSelected
                              ? "bg-cyan-500 text-slate-950 shadow-sm"
                              : "bg-slate-900 border border-slate-800 text-cyan-400 group-hover:border-cyan-500/40"
                          }`}
                        >
                          {String(idx + 1).padStart(2, "0")}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-bold text-sm text-white truncate" title={tpl.modelName}>
                              {tpl.modelName}
                            </h4>
                            {tpl.isCustom && (
                              <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-700/60 px-2 py-0.2 rounded text-[9px] font-bold">
                                사용자 등록
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 truncate mt-0.5" title={tpl.description}>
                            {tpl.description}
                          </p>
                        </div>
                      </div>

                      {/* Item & Part Badges */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="bg-cyan-950/90 text-cyan-300 border border-cyan-800/70 px-2 py-0.5 rounded text-[11px] font-mono font-bold">
                          {tpl.parts?.length || tpl.partsCount || 0}개 품목
                        </span>
                        <span className="bg-slate-800 text-slate-300 border border-slate-700 px-1.5 py-0.5 rounded text-[11px] font-mono">
                          {tpl.moduleCount || 1}개 파트
                        </span>
                      </div>
                    </div>

                    {/* Card Footer Actions */}
                    <div className="flex items-center justify-between border-t border-slate-800/60 pt-2.5 text-xs text-slate-400">
                      <span className="text-[11px] font-mono text-slate-500">
                        {isSelected ? "● 현재 상세 조회 중" : "클릭하여 부품 상세 조회"}
                      </span>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e: React.MouseEvent) => handleOpenEdit(tpl, e)}
                          className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700 text-[11px] font-semibold transition-all"
                          title="양식 수정"
                        >
                          ✏️ 수정
                        </button>
                        <button
                          type="button"
                          onClick={(e: React.MouseEvent) => handleDuplicateTemplate(tpl, e)}
                          className="p-1 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-white border border-slate-700 text-[11px] transition-all"
                          title="양식 복제"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleExportTemplateExcel(tpl)}
                          className="p-1 rounded-lg bg-slate-800 hover:bg-emerald-950 hover:text-emerald-300 border border-slate-700 hover:border-emerald-800 text-[11px] transition-all"
                          title="엑셀로 내보내기"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e: React.MouseEvent) => handleDeleteTemplate(tpl.id, tpl.modelName, e)}
                          className="p-1 rounded-lg bg-slate-800 hover:bg-red-950 text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-800 text-[11px] transition-all"
                          title="양식 삭제"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: 선택된 양식의 부품 상세 BOM (7 Cols) */}
        <div className="lg:col-span-7 space-y-3">
          {selectedTemplate ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 overflow-hidden shadow-xl">
              {/* Detail Header */}
              <div className="p-5 border-b border-slate-800 bg-slate-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded font-mono text-[11px] font-bold border border-cyan-500/30">
                      BOM 상세
                    </span>
                    <h3 className="text-base font-bold text-white">
                      {selectedTemplate.modelName}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {selectedTemplate.description}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(selectedTemplate)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-xs font-bold hover:bg-cyan-500/30 transition-all cursor-pointer"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                    <span>양식 수정</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExportTemplateExcel(selectedTemplate)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-bold transition-all cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5 text-emerald-400" />
                    <span>엑셀 다운로드</span>
                  </button>
                </div>
              </div>

              {/* Detail Sub Header / Part Search */}
              <div className="p-3.5 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-slate-300">
                    부품 목록 (총 {selectedTemplate.parts.length}개 품목 / {new Set(selectedTemplate.parts.map((p) => p.category)).size}개 파트)
                  </span>
                </div>

                <div className="relative w-48 sm:w-64">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="품명/규격 검색..."
                    value={partSearchQuery}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPartSearchQuery(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-3 py-1 text-[11px] text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Parts Table */}
              <div className="max-h-[580px] overflow-y-auto custom-scrollbar">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-900 text-slate-400 font-semibold sticky top-0 z-10 border-b border-slate-800">
                    <tr>
                      <th className="p-3 w-12 text-center">No</th>
                      <th className="p-3">품명 (Part Name)</th>
                      <th className="p-3">세부 사항 (Sub Spec)</th>
                      <th className="p-3">규격 (Spec)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {filteredParts.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-slate-400 text-xs">
                          검색된 부품이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      filteredParts.map((p, idx) => {
                        const prevPart = idx > 0 ? filteredParts[idx - 1] : null;
                        const showCategoryHeader = p.category && (!prevPart || prevPart.category !== p.category);

                        return (
                          <Fragment key={p.id || idx}>
                            {showCategoryHeader && (
                              <tr className="bg-slate-950/90 border-y border-slate-800">
                                <td colSpan={4} className="py-2.5 px-4">
                                  <div className="flex items-center gap-2 font-mono font-extrabold text-xs text-cyan-300">
                                    <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-glow-cyan" />
                                    <span>{p.category}</span>
                                  </div>
                                </td>
                              </tr>
                            )}
                            <tr className="hover:bg-slate-900/60 transition-colors">
                              <td className="p-3 text-center text-slate-500 font-mono font-bold text-xs">
                                {idx + 1}
                              </td>
                              <td className="p-3 font-semibold text-slate-200">
                                {p.partName}
                              </td>
                              <td className="p-3 text-slate-400">
                                {p.subSpec || "-"}
                              </td>
                              <td className="p-3 font-mono text-[11px] text-slate-300">
                                {p.spec || "-"}
                              </td>
                            </tr>
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-12 text-center">
              <p className="text-slate-400 text-xs">좌측에서 양식을 선택해주세요.</p>
            </div>
          )}
        </div>
      </div>

      {/* 3. Comprehensive Template Editor Modal */}
      {isEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4">
          <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-3xl border border-slate-700/80 bg-slate-900 shadow-2xl overflow-hidden animate-fadeIn">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  <Edit2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {editingTemplate ? `「${editingTemplate.modelName}」 양식 수정` : "신규 PJT 양식 추가 등록"}
                  </h3>
                  <p className="text-xs text-slate-400">
                    설비 모델명, 설명 및 파트별 전체 부품 목록(BOM)을 작성하고 등록합니다.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar text-xs">
              {/* Form Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-300 font-bold block mb-1.5">
                    양식 이름 (설비 모델명) *
                  </label>
                  <input
                    type="text"
                    placeholder="예: TM100L (NaVi-TM100L-0312)"
                    value={editorModelName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditorModelName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="text-slate-300 font-bold block mb-1.5">
                    양식 설명 / 비고
                  </label>
                  <input
                    type="text"
                    placeholder="예: 사내 표준 TM100L 8개 파트 전체 시리얼 리스트 양식"
                    value={editorDescription}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditorDescription(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none text-xs"
                  />
                </div>
              </div>

              {/* Parts Header & Toolbar */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-white">
                    포함 부품 목록 ({editorParts.length}개 품목)
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    ref={editorFileInputRef}
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    onChange={handleEditorExcelUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => editorFileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer"
                  >
                    <UploadCloud className="h-4 w-4 text-cyan-400" />
                    <span>엑셀에서 가져오기</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditorParts((prev) => [
                        ...prev,
                        {
                          id: generateId(),
                          category: prev[prev.length - 1]?.category || "[ MAIN ]",
                          partName: "",
                          subSpec: "-",
                          spec: "",
                          detectedSerial: "",
                          isVerified: false,
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 px-3 py-1.5 text-xs font-bold transition-all cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>+ 부품 추가</span>
                  </button>
                </div>
              </div>

              {/* Parts Edit Table */}
              <div className="rounded-2xl border border-slate-800 overflow-hidden bg-slate-950">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-900 text-slate-400 font-semibold sticky top-0 z-10 border-b border-slate-800">
                    <tr>
                      <th className="p-2.5 w-10 text-center">No</th>
                      <th className="p-2.5 w-32">파트 구분</th>
                      <th className="p-2.5 w-48">품명</th>
                      <th className="p-2.5 w-44">세부사항</th>
                      <th className="p-2.5">규격</th>
                      <th className="p-2.5 w-12 text-center">삭제</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {editorParts.map((p, idx) => (
                      <tr key={p.id || idx} className="hover:bg-slate-900/50">
                        <td className="p-2 text-center text-slate-500 font-mono font-bold">
                          {idx + 1}
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={p.category}
                            placeholder="[ MAIN ]"
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const val = e.target.value;
                              setEditorParts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, category: val } : item))
                              );
                            }}
                            className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1 text-cyan-300 font-mono text-xs font-bold focus:border-cyan-500 focus:outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={p.partName}
                            placeholder="품명 입력"
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const val = e.target.value;
                              setEditorParts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, partName: val } : item))
                              );
                            }}
                            className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1 text-white font-semibold text-xs focus:border-cyan-500 focus:outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={p.subSpec}
                            placeholder="세부사항 (-)"
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const val = e.target.value;
                              setEditorParts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, subSpec: val } : item))
                              );
                            }}
                            className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1 text-slate-300 text-xs focus:border-cyan-500 focus:outline-none"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={p.spec}
                            placeholder="규격 입력"
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              const val = e.target.value;
                              setEditorParts((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, spec: val } : item))
                              );
                            }}
                            className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1 text-slate-300 font-mono text-xs focus:border-cyan-500 focus:outline-none"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() =>
                              setEditorParts((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="text-slate-500 hover:text-red-400 p-1 rounded hover:bg-red-950/50 transition-colors"
                            title="부품 삭제"
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

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/80 px-6 py-4">
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold hover:bg-slate-700 transition-all cursor-pointer"
              >
                취소
              </button>

              <button
                type="button"
                onClick={handleSaveTemplate}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-2.5 text-xs font-extrabold text-slate-950 shadow-glow-cyan hover:opacity-95 transition-all cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>양식 저장 완료</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
