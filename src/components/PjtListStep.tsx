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
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-2xl bg-gradient-to-r from-slate-900 via-cleanroom-850 to-slate-900 p-5 sm:p-6 border border-slate-800 shadow-xl">
        <div className="shrink-0">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400 font-mono font-bold text-xs border border-cyan-500/30">
              01
            </span>
            <h2 className="text-xl font-bold text-white tracking-wide">
              PJT List (프로젝트 목록 관리)
            </h2>
          </div>
        </div>

        {/* Right Controls: 검색창 + 프로젝트 개수 + 신규 PJT 추가 버튼 */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full lg:w-auto flex-1 lg:flex-none justify-end">
          {/* 검색창 */}
          <div className="relative w-full sm:w-72 md:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="PJT CODE, 설비명, Serial NO., 사업장, 담당자 검색..."
              value={searchFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchFilter(e.target.value)}
              className="w-full bg-slate-950/90 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </div>

          {/* 총 프로젝트 개수 */}
          <span className="text-xs font-mono text-slate-400 shrink-0 whitespace-nowrap px-1">
            총 <strong className="text-cyan-400 font-bold">{filteredProjects.length}</strong>개 프로젝트
          </span>

          {/* 신규 PJT 추가 버튼 */}
          <button
            type="button"
            onClick={onCreateNewProject}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2.5 text-xs font-bold text-slate-950 shadow-glow-cyan hover:opacity-95 transition-all shrink-0 whitespace-nowrap cursor-pointer"
          >
            <Plus className="h-4 w-4 stroke-[3]" />
            <span>신규 PJT 추가</span>
          </button>
        </div>
      </div>

      {/* Horizontal Wide Row List (가로 나열 방식) */}
      <div className="space-y-3">
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
              className={`p-4 sm:p-5 rounded-2xl border transition-all cursor-pointer flex flex-col lg:flex-row lg:items-center justify-between gap-4 sm:gap-6 ${
                isCurrent
                  ? "bg-slate-900/95 border-cyan-500 shadow-glow-cyan ring-1 ring-cyan-500/50"
                  : "bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-900"
              }`}
            >
              {/* 1. Left: Main Info (고객사 -> PJT CODE -> 설비명 -> 진행률 순서) */}
              <div className="flex-1 min-w-0 space-y-2.5">
                {/* Main Header Line: 고객사/PJT CODE/설비명 (좌측) + 진행률 배지 (우측 ml-auto 일괄 정렬) */}
                <div className="flex items-center gap-2.5 flex-nowrap min-w-0">
                  {/* 1. 고객사 */}
                  <span
                    className={`shrink-0 whitespace-nowrap text-sm font-bold flex items-center gap-1.5 px-3 py-1 rounded-lg border shadow-sm ${siteStyle.bg}`}
                  >
                    <Building2 className={`h-3.5 w-3.5 ${siteStyle.icon}`} />
                    <span>{pjt.site}</span>
                  </span>

                  {/* 2. PJT CODE */}
                  <span className="shrink-0 whitespace-nowrap font-mono font-extrabold text-sm text-white tracking-wider bg-slate-950 px-3 py-1 rounded-lg border border-slate-800">
                    {pjt.pjtCode}
                  </span>

                  {/* 3. 프로젝트 이름 / 설비명 (1자 유지 + 툴팁) */}
                  <h3 className="min-w-0 truncate whitespace-nowrap font-bold text-white text-base sm:text-lg tracking-wide" title={pjt.equipmentName}>
                    {pjt.equipmentName}
                  </h3>

                  {/* 4. 진행률 배지 (ml-auto로 모든 카드의 동일한 우측 수직선상에 정렬) */}
                  <span
                    className={`shrink-0 ml-auto whitespace-nowrap inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                      isComplete
                        ? "bg-emerald-950 text-emerald-400 border border-emerald-700 shadow-sm"
                        : rate > 0
                        ? "bg-amber-950 text-amber-400 border border-amber-800"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {isComplete ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>검사완료 (100%)</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-3.5 w-3.5" />
                        <span>진행률 {rate}%</span>
                      </>
                    )}
                  </span>
                </div>

                {/* 🔢 Serial NO. 요약 범위 박스 (단일/연속 범위 표기 - 적절한 크기) */}
                <div className="bg-slate-950/70 border border-slate-800/80 px-3 py-1.5 rounded-xl font-mono text-xs text-slate-300 flex items-center gap-2">
                  <Barcode className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                  <span className="text-[11px] text-cyan-400 font-bold shrink-0">
                    Serial NO:
                  </span>
                  <span className="text-cyan-300 font-medium tracking-wide text-xs">
                    {formatSerialRange(pjt.equipmentUnits)}
                  </span>
                </div>

                {/* 하단 메타 정보 (수량 / 담당자 / 작성일 - 균형 잡힌 정렬) */}
                <div className="flex flex-wrap items-center gap-6 sm:gap-8 text-xs text-slate-400 font-mono pl-3 sm:pl-3.5 pt-0.5">
                  <span className="flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-slate-500" />
                    <span>수량: <strong className="text-white">{pjt.quantity}대</strong></span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <UserCheck className="h-3.5 w-3.5 text-slate-500" />
                    <span>담당자: <span className="text-slate-300 font-medium">{pjt.inspectorName}</span></span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-slate-500" />
                    <span>작성일: <span className="text-slate-300 font-medium">{pjt.inspectionDate}</span></span>
                  </span>
                </div>
              </div>

              {/* 2. Middle: Progress Indicator */}
              <div className="w-full lg:w-64 space-y-1.5 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 shrink-0">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-slate-400">부품 검증 현황</span>
                  <span className="text-cyan-300 font-bold">{verifiedParts}/{totalParts}개 ({rate}%)</span>
                </div>
                <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-300 ${
                      isComplete ? "bg-emerald-400" : "bg-cyan-400"
                    }`}
                    style={{ width: `${rate}%` }}
                  />
                </div>
              </div>

              {/* 3. Right: Action Buttons (시리얼 입력 버튼 + 세로 액션 목록: PJT 수정, 엑셀 추출, PJT 복사, 삭제) */}
              <div className="flex items-stretch sm:items-center gap-2.5 shrink-0 border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-800">
                {/* Main CTA: 시리얼 입력 (3단계) */}
                <button
                  type="button"
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    onSelectProject(pjt.id || "", 3);
                  }}
                  className="bg-gradient-to-r from-cyan-500 to-blue-600 font-extrabold text-slate-950 px-4 py-3 rounded-xl text-xs shadow-glow-cyan hover:opacity-95 transition-all cursor-pointer flex items-center justify-center gap-1.5 flex-1 sm:flex-none min-h-[52px]"
                >
                  <span>OCR 입력</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>

                {/* Vertical Action Column: PJT 수정, 엑셀 추출, PJT 복사, 삭제 */}
                <div className="flex flex-col gap-1 w-24 shrink-0">
                  <button
                    type="button"
                    onClick={(e: React.MouseEvent) => handleOpenEditModal(pjt, e)}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-semibold transition-all flex items-center justify-center gap-1 border border-slate-700 cursor-pointer shadow-sm"
                    title="PJT 정보 및 Serial NO. 수정"
                  >
                    <Edit2 className="h-3 w-3" />
                    <span>PJT 수정</span>
                  </button>

                  <button
                    type="button"
                    disabled={isExportingId === pjt.id}
                    onClick={(e: React.MouseEvent) => handleExportExcel(pjt, e)}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 text-[11px] font-semibold transition-all flex items-center justify-center gap-1 border border-slate-700 cursor-pointer shadow-sm"
                    title="보고서 즉시 다운로드 (.xlsx)"
                  >
                    <FileSpreadsheet className="h-3 w-3" />
                    <span>보고서 추출</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      onDuplicateProject(pjt.id || "");
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium transition-all flex items-center justify-center gap-1 border border-slate-700 cursor-pointer"
                    title="PJT 복제"
                  >
                    <Copy className="h-3 w-3" />
                    <span>PJT 복사</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      onDeleteProject(pjt.id || "");
                    }}
                    className="px-2 py-1 rounded-lg bg-slate-800/80 hover:bg-red-950 text-slate-400 hover:text-red-400 text-[11px] font-medium transition-all flex items-center justify-center gap-1 border border-slate-800 hover:border-red-800/60 cursor-pointer"
                    title="PJT 삭제"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>삭제</span>
                  </button>
                </div>
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
