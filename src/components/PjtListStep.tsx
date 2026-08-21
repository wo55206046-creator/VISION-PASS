"use client";

import React, { useState } from "react";
import { ProjectMaster, EquipmentUnit } from "@/types";
import {
  Layers,
  Plus,
  Search,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  Copy,
  Trash2,
  Edit2,
  Building2,
  Calendar,
  UserCheck,
  ArrowRight,
  Sparkles,
  X,
  Check,
  Barcode,
  Camera,
} from "lucide-react";
import { exportSemiconductorReportToExcel } from "@/lib/excel-export";
import { DEFAULT_SITES } from "@/lib/default-presets";
import { generateNextSerial, cascadeSerialFromUnit1 } from "@/lib/utils";

interface PjtListStepProps {
  projects: ProjectMaster[];
  currentProjectId: string;
  onSelectProject: (projectId: string, targetStep?: number) => void;
  onCreateNewProject: () => void;
  onUpdateProject?: (updatedProject: ProjectMaster) => void;
  onDuplicateProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
}

// 사업장별 색상 스타일 결정:
// 1. SKH로 시작: 기존 주황색(Amber)
// 2. SEC로 시작: 블루(사진 속 난야 대만 색상)
// 3. 그 외 시작: 모두 옅은 빨강(Rose)
function getSiteBadgeStyle(site: string) {
  const s = (site || "").trim().toUpperCase();
  if (s.startsWith("SKH") || s.startsWith("SK")) {
    return {
      bg: "bg-amber-950/70 border-amber-600/70 text-amber-300",
      icon: "text-amber-400",
    };
  } else if (s.startsWith("SEC")) {
    return {
      bg: "bg-blue-950/80 border-blue-600/80 text-blue-300",
      icon: "text-blue-400",
    };
  } else {
    return {
      bg: "bg-rose-950/70 border-rose-600/70 text-rose-300",
      icon: "text-rose-400",
    };
  }
}

// 호기 시리얼을 단일 또는 연속 범위(예: TM1L-HK26-1007 ~ TM1L-HK26-1011)로 깔끔하게 요약 표기
function formatSerialRange(units: EquipmentUnit[] = []): string {
  if (!units || units.length === 0) return "(미입력)";
  const unit1Serial = units[0]?.equipmentSerial?.trim();
  if (!unit1Serial) return "(미입력)";

  const lastUnit = units[units.length - 1];
  let lastSerial = lastUnit?.equipmentSerial?.trim();
  if (!lastSerial && units.length > 1) {
    lastSerial = cascadeSerialFromUnit1(unit1Serial, units.length);
  }

  if (units.length <= 1 || !lastSerial || unit1Serial === lastSerial) {
    return unit1Serial;
  }

  return `${unit1Serial} ~ ${lastSerial}`;
}

export const PjtListStep: React.FC<PjtListStepProps> = ({
  projects,
  currentProjectId,
  onSelectProject,
  onCreateNewProject,
  onUpdateProject,
  onDuplicateProject,
  onDeleteProject,
}) => {
  const [searchFilter, setSearchFilter] = useState("");
  const [isExportingId, setIsExportingId] = useState<string | null>(null);

  // 빠른 PJT 수정 모달 상태
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingPjt, setEditingPjt] = useState<ProjectMaster | null>(null);

  const filteredProjects = projects.filter((p) => {
    const q = searchFilter.toLowerCase();
    return (
      p.pjtCode.toLowerCase().includes(q) ||
      p.equipmentName.toLowerCase().includes(q) ||
      p.site.toLowerCase().includes(q) ||
      p.equipmentUnits.some((u) => u.equipmentSerial.toLowerCase().includes(q)) ||
      (p.inspectorName && p.inspectorName.toLowerCase().includes(q))
    );
  });

  const handleExportExcel = async (pjt: ProjectMaster, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExportingId(pjt.id || "");
    try {
      await exportSemiconductorReportToExcel(pjt);
    } catch (err) {
      console.error(err);
    } finally {
      setIsExportingId(null);
    }
  };

  const handleOpenEditModal = (pjt: ProjectMaster, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPjt(JSON.parse(JSON.stringify(pjt)));
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = () => {
    if (!editingPjt) return;
    if (!editingPjt.pjtCode.trim()) {
      alert("PJT CODE를 입력해주세요.");
      return;
    }
    if (!editingPjt.equipmentName.trim()) {
      alert("프로젝트 이름을 입력해주세요.");
      return;
    }

    if (onUpdateProject) {
      onUpdateProject({
        ...editingPjt,
        quantity: editingPjt.equipmentUnits.length,
      });
    }

    setIsEditModalOpen(false);
    setEditingPjt(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Search & Quick Action (통합 상단 헤더) */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-cleanroom-850 to-slate-900 p-4 sm:p-5 border border-slate-800 shadow-xl space-y-3">
        {/* 1. 상단 타이틀 + 우측 총 프로젝트 개수 표시 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400 font-mono font-bold text-xs border border-cyan-500/30">
              01
            </span>
            <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
              PJT List (프로젝트 목록 관리)
            </h2>
          </div>

          {/* 총 프로젝트 개수 (우측 배치) */}
          <span className="text-xs font-mono text-slate-300 bg-slate-950 px-2.5 py-1 rounded-full border border-slate-800 shrink-0 whitespace-nowrap shadow-inner">
            총 <strong className="text-cyan-400 font-bold">{filteredProjects.length}</strong>개 프로젝트
          </span>
        </div>

        {/* 2. 검색창 + [+ 신규 PJT 추가] 버튼 (동일 라인 배치) */}
        <div className="flex items-center gap-2 w-full">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="PJT CODE, 설비명, Serial NO., 사업장, 담당자 검색..."
              value={searchFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchFilter(e.target.value)}
              className="w-full bg-slate-950/90 border border-slate-700 rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          {/* 신규 PJT 추가 버튼 (검색창 우측) */}
          <button
            type="button"
            onClick={onCreateNewProject}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-3.5 sm:px-4 py-2 text-xs font-bold text-slate-950 shadow-glow-cyan hover:opacity-95 transition-all shrink-0 whitespace-nowrap cursor-pointer"
          >
            <Plus className="h-4 w-4 stroke-[3]" />
            <span>신규 PJT 추가</span>
          </button>
        </div>
      </div>

      {/* PC 2열 그리드 & 모바일 1열 카드 배치 (PC 뷰에서 반반 2개 PJT 표시) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 sm:gap-4">
        {filteredProjects.map((pjt) => {
          const isCurrent = pjt.id === currentProjectId;
          let totalParts = 0;
          let verifiedParts = 0;
          pjt.equipmentUnits.forEach((u) =>
            u.parts.forEach((p) => {
              totalParts++;
              if (p.isVerified) verifiedParts++;
            })
          );
          const rate = totalParts > 0 ? Math.round((verifiedParts / totalParts) * 100) : 0;
          const isComplete = totalParts > 0 && verifiedParts === totalParts;
          const siteStyle = getSiteBadgeStyle(pjt.site);

          return (
            <div
              key={pjt.id}
              onClick={() => onSelectProject(pjt.id || "", 1)}
              className={`p-3.5 sm:p-4 rounded-2xl border transition-all cursor-pointer space-y-2.5 flex flex-col justify-between ${
                isCurrent
                  ? "bg-slate-900/95 border-cyan-500 shadow-glow-cyan ring-1 ring-cyan-500/50"
                  : "bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-900"
              }`}
            >
              <div className="space-y-2.5">
                {/* 1. Main Info: 고객사 -> PJT CODE -> 설비명 */}
                <div className="flex items-center gap-2 min-w-0">
                  {/* 고객사 */}
                  <span
                    className={`shrink-0 whitespace-nowrap text-xs font-bold flex items-center gap-1 px-2.5 py-0.5 rounded-lg border shadow-sm ${siteStyle.bg}`}
                  >
                    <Building2 className={`h-3.5 w-3.5 ${siteStyle.icon}`} />
                    <span>{pjt.site}</span>
                  </span>

                  {/* PJT CODE */}
                  <span className="shrink-0 whitespace-nowrap font-mono font-extrabold text-xs text-white tracking-wider bg-slate-950 px-2.5 py-0.5 rounded-lg border border-slate-800">
                    {pjt.pjtCode}
                  </span>

                  {/* 설비명 */}
                  <h3
                    className="min-w-0 truncate font-bold text-white text-sm sm:text-base tracking-wide"
                    title={pjt.equipmentName}
                  >
                    {pjt.equipmentName}
                  </h3>
                </div>

                {/* 2. Serial NO. & 진행률/완료 상태 배지 (Serial NO 뒤에 배치) */}
                <div className="bg-slate-950/80 border border-slate-800/80 px-3 py-1.5 rounded-xl font-mono text-xs flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-[11px] text-cyan-400 font-bold shrink-0">
                      Serial NO:
                    </span>
                    <span className="text-cyan-300 font-medium tracking-wide text-xs truncate">
                      {formatSerialRange(pjt.equipmentUnits)}
                    </span>
                  </div>

                  {/* 진행률 / 완료 현황 배지 */}
                  <span
                    className={`shrink-0 whitespace-nowrap inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      isComplete
                        ? "bg-emerald-950 text-emerald-400 border border-emerald-700 shadow-sm"
                        : rate > 0
                        ? "bg-amber-950 text-amber-400 border border-amber-800"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {isComplete ? (
                      <>
                        <CheckCircle2 className="h-3 w-3" />
                        <span>완료 (100%)</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-3 w-3" />
                        <span>진행률 {rate}%</span>
                      </>
                    )}
                  </span>
                </div>

                {/* 3. 하단 메타 정보 (수량 / 담당자 / 작성일) */}
                <div className="flex flex-wrap items-center gap-3.5 sm:gap-5 text-[11px] text-slate-400 font-mono px-1">
                  <span className="flex items-center gap-1">
                    <Layers className="h-3 w-3 text-slate-500" />
                    <span>
                      수량: <strong className="text-white">{pjt.quantity}대</strong>
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <UserCheck className="h-3 w-3 text-slate-500" />
                    <span>
                      담당자:{" "}
                      <span className="text-slate-300 font-medium">{pjt.inspectorName}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-slate-500" />
                    <span>
                      작성일:{" "}
                      <span className="text-slate-300 font-medium">{pjt.inspectionDate}</span>
                    </span>
                  </span>
                </div>
              </div>

              {/* 4. 액션 버튼 4개: OCR 입력 (적정 크기), PJT 수정, Excel 다운로드, 삭제 */}
              <div className="flex items-center gap-1.5 sm:gap-2 pt-2 border-t border-slate-800/60 mt-1">
                {/* 1. OCR 입력 */}
                <button
                  type="button"
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    onSelectProject(pjt.id || "", 3);
                  }}
                  className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 font-extrabold text-slate-950 py-2 px-2.5 sm:px-3 rounded-xl text-xs shadow-glow-cyan hover:opacity-95 transition-all cursor-pointer flex items-center justify-center gap-1 whitespace-nowrap"
                  title="설비 부품 OCR 스캔 및 입력"
                >
                  <Camera className="h-3.5 w-3.5 shrink-0" />
                  <span>OCR 입력</span>
                  <ArrowRight className="h-3 w-3 shrink-0 hidden sm:inline" />
                </button>

                {/* 2. PJT 수정 */}
                <button
                  type="button"
                  onClick={(e: React.MouseEvent) => handleOpenEditModal(pjt, e)}
                  className="px-2.5 sm:px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-semibold transition-all flex items-center justify-center gap-1 border border-slate-700 cursor-pointer shadow-sm whitespace-nowrap shrink-0"
                  title="PJT 정보 및 Serial NO. 수정"
                >
                  <Edit2 className="h-3.5 w-3.5 shrink-0" />
                  <span>PJT 수정</span>
                </button>

                {/* 3. Excel 다운로드 */}
                <button
                  type="button"
                  disabled={isExportingId === pjt.id}
                  onClick={(e: React.MouseEvent) => handleExportExcel(pjt, e)}
                  className="px-2.5 sm:px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-emerald-300 text-xs font-semibold transition-all flex items-center justify-center gap-1 border border-slate-700 cursor-pointer shadow-sm whitespace-nowrap shrink-0 disabled:opacity-50"
                  title="제작완료 보고서 Excel 즉시 다운로드 (.xlsx)"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
                  <span>Excel 다운로드</span>
                </button>

                {/* 4. 삭제 */}
                <button
                  type="button"
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    onDeleteProject(pjt.id || "");
                  }}
                  className="px-2.5 sm:px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-red-950 text-slate-400 hover:text-red-400 text-xs font-medium transition-all flex items-center justify-center gap-1 border border-slate-800 hover:border-red-800/60 cursor-pointer whitespace-nowrap shrink-0"
                  title="PJT 삭제"
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  <span>삭제</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick PJT Edit Modal (PJT 수정 모달 - Serial NO. 수정 포함) */}
      {isEditModalOpen && editingPjt && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Edit2 className="h-4 w-4 text-cyan-400" />
                <h3 className="text-base font-bold text-white">프로젝트 정보 및 Serial NO. 수정</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-300 font-bold block">PJT CODE *</label>
                </div>
                <input
                  type="text"
                  placeholder="예: S26-15-01"
                  value={editingPjt.pjtCode}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setEditingPjt({ ...editingPjt, pjtCode: e.target.value.toUpperCase() })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 font-mono font-bold text-cyan-300 uppercase focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-300 font-bold block mb-1">
                  모델명 (인증명) *
                </label>
                <input
                  type="text"
                  value={editingPjt.equipmentName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setEditingPjt({ ...editingPjt, equipmentName: e.target.value })
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 font-bold text-white focus:border-cyan-500 focus:outline-none"
                  placeholder="예: NaVi-MG200 (NaVi-MG200H-0224), WOA-683 (WOA-683-0124)"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-slate-300 font-bold block">고객사</label>
                  <span className="text-[10px] text-cyan-400">직접 입력 및 목록 선택 가능</span>
                </div>
                <input
                  type="text"
                  list="edit-modal-site-list-options"
                  value={editingPjt.site}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditingPjt({ ...editingPjt, site: e.target.value })}
                  placeholder="예: SKH 이천, SEC 평택"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                />
                <datalist id="edit-modal-site-list-options">
                  {DEFAULT_SITES.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>

              {/* 호기별 Serial NO. 수정 및 호기 추가 */}
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-cyan-300 font-bold block text-[11px]">
                    호기별 설비 Serial NO. 수정 (총 {editingPjt.equipmentUnits.length}대) :
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const nextIdx = editingPjt.equipmentUnits.length + 1;
                      const baseParts = (editingPjt.equipmentUnits[0]?.parts || []).map((p) => ({
                        ...p,
                        id: "id-" + Math.random().toString(36).substring(2, 9),
                        detectedSerial: "",
                        isVerified: false,
                        scannedAt: undefined,
                        confidence: undefined,
                      }));
                      const unit1Serial = editingPjt.equipmentUnits[0]?.equipmentSerial?.trim();
                      const nextSerial = unit1Serial ? cascadeSerialFromUnit1(unit1Serial, nextIdx) : "";
                      const newUnit = {
                        unitIndex: nextIdx,
                        equipmentSerial: nextSerial,
                        parts: baseParts,
                      };
                      const updatedUnits = [...editingPjt.equipmentUnits, newUnit];
                      setEditingPjt({
                        ...editingPjt,
                        quantity: updatedUnits.length,
                        equipmentUnits: updatedUnits,
                      });
                    }}
                    className="px-2.5 py-1 bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 rounded-lg font-bold text-[11px] hover:opacity-90 shadow-sm flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="h-3 w-3 stroke-[3]" />
                    <span>호기 추가</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                  {editingPjt.equipmentUnits.map((u) => (
                    <div
                      key={u.unitIndex}
                      className="flex items-center gap-2 bg-slate-900/60 p-1.5 rounded-lg border border-slate-800/80"
                    >
                      <span className="w-16 font-mono text-slate-300 shrink-0 text-[11px] font-semibold">
                        {u.unitIndex}호기 S/N:
                      </span>
                      <input
                        type="text"
                        placeholder={`예: SOTSU-SK26-100${u.unitIndex}`}
                        value={u.equipmentSerial}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          const val = e.target.value.toUpperCase();
                          if (u.unitIndex === 1) {
                            const newUnits = editingPjt.equipmentUnits.map((unit) => ({
                              ...unit,
                              equipmentSerial: cascadeSerialFromUnit1(val, unit.unitIndex),
                            }));
                            setEditingPjt({ ...editingPjt, equipmentUnits: newUnits });
                          } else {
                            const newUnits = editingPjt.equipmentUnits.map((unit) =>
                              unit.unitIndex === u.unitIndex ? { ...unit, equipmentSerial: val } : unit
                            );
                            setEditingPjt({ ...editingPjt, equipmentUnits: newUnits });
                          }
                        }}
                        className="flex-1 bg-slate-950 border border-slate-700 rounded-lg p-1.5 font-mono text-cyan-300 uppercase text-xs focus:border-cyan-500 focus:outline-none"
                      />
                      {editingPjt.equipmentUnits.length > 1 && (
                        <button
                          type="button"
                          title="이 호기 삭제"
                          onClick={() => {
                            const filtered = editingPjt.equipmentUnits.filter(
                              (unit) => unit.unitIndex !== u.unitIndex
                            );
                            const reindexed = filtered.map((unit, idx) => ({
                              ...unit,
                              unitIndex: idx + 1,
                            }));
                            setEditingPjt({
                              ...editingPjt,
                              quantity: reindexed.length,
                              equipmentUnits: reindexed,
                            });
                          }}
                          className="p-1 text-slate-500 hover:text-red-400 rounded transition-colors cursor-pointer text-xs"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-bold block mb-1">설비 담당자</label>
                  <input
                    type="text"
                    placeholder="예: 홍길동"
                    value={editingPjt.inspectorName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setEditingPjt({ ...editingPjt, inspectorName: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-300 font-bold block mb-1">검사일자</label>
                  <input
                    type="date"
                    value={editingPjt.inspectionDate}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setEditingPjt({ ...editingPjt, inspectionDate: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-white focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="w-1/2 bg-slate-800 text-slate-300 py-2.5 rounded-xl text-xs hover:bg-slate-700 cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="w-1/2 bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-bold py-2.5 rounded-xl text-xs shadow-glow-cyan hover:opacity-95 cursor-pointer"
              >
                변경사항 저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
