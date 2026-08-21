import React, { useState } from "react";
import { ProjectMaster, PartItem, PjtModelTemplate } from "@/types";
import { DEFAULT_SITES, createEmptyProject } from "@/lib/default-presets";
import { generateNextSerial, cascadeSerialFromUnit1 } from "@/lib/utils";
import { PresetModal } from "./PresetModal";
import {
  Building2,
  Barcode,
  Cpu,
  Layers,
  UserCheck,
  Calendar,
  FileText,
  FileSpreadsheet,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

// Helper function to generate IDs
const generateId = () => Math.random().toString(36).substring(2, 9);

interface ProjectMasterStepProps {
  project: ProjectMaster;
  onUpdate: (updater: (prev: ProjectMaster) => ProjectMaster) => void;
  onNext: () => void;
  onBackToPjtList?: () => void;
}

export const ProjectMasterStep: React.FC<ProjectMasterStepProps> = ({
  project,
  onUpdate,
  onNext,
  onBackToPjtList,
}) => {
  const [customSite, setCustomSite] = useState("");
  const [isCustomSiteMode, setIsCustomSiteMode] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);

  // 기존 등록된 프로젝트들에서 설비 담당자 목록 자동 추출 (중복 제거)
  const existingInspectors = React.useMemo(() => {
    try {
      if (typeof window !== "undefined") {
        const saved =
          localStorage.getItem("VISION_PASS_PROJECTS_V2") ||
          localStorage.getItem("VISION_PASS_PROJECTS_V1");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            const names = parsed
              .map((p: any) => p.inspectorName?.trim())
              .filter(Boolean);
            const unique = Array.from(new Set(names)) as string[];
            if (unique.length > 0) return unique;
          }
        }
      }
    } catch (e) {}
    return ["홍길동", "김철수", "이영희", "박민수", "최동현", "장준혁"];
  }, []);

  // 수량 변경 시 equipmentUnits 동기화 (기존 데이터 보존)
  const handleQuantityChange = (newQty: number) => {
    if (newQty < 1 || newQty > 50) return;

    onUpdate((prev) => {
      const currentUnits = [...prev.equipmentUnits];
      const diff = newQty - currentUnits.length;

      if (diff > 0) {
        // 호기 추가
        for (let i = 0; i < diff; i++) {
          const nextIndex = currentUnits.length + 1;
          const templateParts = currentUnits[0]?.parts.map((p) => ({
            ...p,
            id: generateId(),
            detectedSerial: "",
            isVerified: false,
            scannedAt: undefined,
            confidence: undefined,
          })) || [];

          const unit1Serial = currentUnits[0]?.equipmentSerial?.trim();
          const nextSerial = unit1Serial ? cascadeSerialFromUnit1(unit1Serial, nextIndex) : "";

          currentUnits.push({
            unitIndex: nextIndex,
            equipmentSerial: nextSerial,
            parts: templateParts,
          });
        }
      } else if (diff < 0) {
        // 호기 감소
        currentUnits.splice(newQty);
      }

      return {
        ...prev,
        quantity: newQty,
        equipmentUnits: currentUnits,
      };
    });
  };

  const handleNextClick = () => {
    if (!project.pjtCode.trim()) {
      setErrorMsg("PJT CODE를 입력해주세요.");
      return;
    }
    if (!project.equipmentName.trim()) {
      setErrorMsg("설비명을 입력해주세요.");
      return;
    }
    setErrorMsg(null);
    onNext();
  };

  const loadSamplePreset = () => {
    const sample = createEmptyProject();
    onUpdate(() => sample);
    setErrorMsg(null);
  };

  // PJT 양식 선택 시 모든 호기에 일괄 배정 및 설비 모델명을 해당 양식명으로 즉시 변경
  const handleApplyTemplateToAllUnits = (template: PjtModelTemplate) => {
    onUpdate((prev) => {
      const templateParts = template.parts.map((p) => ({
        ...p,
        id: generateId(),
        detectedSerial: "",
        isVerified: false,
        scannedAt: undefined,
        confidence: undefined,
      }));

      const updatedUnits = prev.equipmentUnits.map((u) => ({
        ...u,
        parts: templateParts.map((p) => ({ ...p, id: generateId() })),
      }));

      return {
        ...prev,
        equipmentName: template.modelName, // 선택한 양식명으로 즉시 변경
        equipmentUnits: updatedUnits,
      };
    });
    setIsPresetModalOpen(false);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Top Banner (01처럼 깔끔하게 제목만 표시) */}
      <div className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-slate-900 via-cleanroom-850 to-slate-900 p-4 sm:p-5 border border-slate-800 shadow-xl">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400 font-mono font-bold text-xs border border-cyan-500/30 shrink-0">
            02
          </span>
          <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
            프로젝트 추가
          </h2>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2.5 rounded-xl bg-red-950/60 p-4 text-sm text-red-300 border border-red-800/60 animate-shake">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Form Card (왼쪽 사진과 100% 동일한 2열 분할 컴팩트 레이아웃) */}
      <div className="rounded-2xl bg-slate-900/90 p-4 sm:p-7 border border-slate-800 shadow-2xl backdrop-blur-sm space-y-3.5 sm:space-y-4">
        {/* 1. PJT CODE (좌) & 고객사 (우) */}
        <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
          {/* PJT CODE */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Barcode className="h-3.5 w-3.5 text-cyan-400" />
              <span>PJT CODE</span> <span className="text-cyan-400">*</span>
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="예: S26-15-01"
                value={project.pjtCode}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onUpdate((prev) => ({ ...prev, pjtCode: e.target.value.toUpperCase() }))
                }
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs sm:text-sm font-mono font-bold text-cyan-300 uppercase placeholder:font-sans placeholder:normal-case placeholder:font-normal placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>
          </div>

          {/* 고객사 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Building2 className="h-3.5 w-3.5 text-cyan-400" />
                <span>고객사</span> <span className="text-cyan-400">*</span>
              </label>
              <span className="text-[10px] font-mono text-cyan-400">선택/입력</span>
            </div>

            <div className="relative">
              <input
                type="text"
                list="site-datalist-options"
                placeholder="예: SKH 이천, SEC 평택"
                value={project.site}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  onUpdate((prev) => ({ ...prev, site: e.target.value }))
                }
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
              <datalist id="site-datalist-options">
                {DEFAULT_SITES.map((site) => (
                  <option key={site} value={site} />
                ))}
              </datalist>
            </div>
          </div>
        </div>

        {/* 2. 모델명 (인증명) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Cpu className="h-3.5 w-3.5 text-cyan-400" />
              <span>모델명 (인증명)</span> <span className="text-cyan-400">*</span>
            </label>
            <span className="text-[10px] font-mono text-cyan-400">사양서 확인</span>
          </div>
          <input
            type="text"
            placeholder="예: NaVi-MG200 (NaVi-MG200H-0224), WOA-683 (WOA-683-0124)"
            value={project.equipmentName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onUpdate((prev) => ({ ...prev, equipmentName: e.target.value }))
            }
            className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>

        {/* 3. 설비 담당자 (좌) & 검수일자 (우) */}
        <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
          {/* 설비 담당자 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <UserCheck className="h-3.5 w-3.5 text-cyan-400" />
                <span>설비 담당자</span>
              </label>
            </div>
            <input
              type="text"
              list="inspector-datalist-step2"
              placeholder="예: 홍길동"
              value={project.inspectorName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onUpdate((prev) => ({ ...prev, inspectorName: e.target.value }))
              }
              className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            <datalist id="inspector-datalist-step2">
              {existingInspectors.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          {/* 검수일자 */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Calendar className="h-3.5 w-3.5 text-cyan-400" />
              <span>검수일자</span>
            </label>
            <input
              type="date"
              value={project.inspectionDate}
              onClick={(e: React.MouseEvent<HTMLInputElement>) => {
                try {
                  (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
                } catch (err) {}
              }}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onUpdate((prev) => ({ ...prev, inspectionDate: e.target.value }))
              }
              style={{ colorScheme: "dark" }}
              className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
            />
          </div>
        </div>

        {/* 4. 설비 수량 (호기 생성) */}
        <div className="space-y-1.5">
          <label className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-cyan-400" />
              <span>설비 수량 (호기 생성)</span> <span className="text-cyan-400">*</span>
            </span>
            <span className="text-[11px] text-slate-400 font-mono">
              현재 {project.quantity}개 호기
            </span>
          </label>

          <div className="flex items-center gap-2 max-w-xs">
            <button
              type="button"
              onClick={() => handleQuantityChange(project.quantity - 1)}
              disabled={project.quantity <= 1}
              className="flex h-9 w-10 items-center justify-center rounded-xl bg-slate-800 text-base font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              -
            </button>
            <input
              type="number"
              min="1"
              max="50"
              value={project.quantity}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleQuantityChange(parseInt(e.target.value) || 1)}
              style={{ MozAppearance: "textfield" }}
              className="w-full text-center rounded-xl bg-slate-950 border border-slate-700 py-1.5 text-sm font-bold font-mono text-cyan-300 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              type="button"
              onClick={() => handleQuantityChange(project.quantity + 1)}
              disabled={project.quantity >= 50}
              className="flex h-9 w-10 items-center justify-center rounded-xl bg-slate-800 text-base font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              +
            </button>
          </div>
        </div>
      </div>

        {/* 🔢 설비 Serial NO. 입력 & 적용된 PJT 양식 헤더 */}
        <div className="rounded-2xl bg-slate-950/80 p-4 sm:p-5 border border-cyan-900/40 space-y-3.5">
          <div className="space-y-2 border-b border-slate-800 pb-3">
            {/* 1. 상단 행: 좌측 타이틀 & 우측 [양식 변경] 버튼 */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 shrink-0">
                <Barcode className="h-4 w-4 text-cyan-400" />
                <label className="text-xs sm:text-sm font-bold text-cyan-300 whitespace-nowrap">
                  설비 Serial NO. 입력 (총 {project.quantity}개 호기)
                </label>
              </div>

              {/* 양식 변경 버튼 (우측 상단 배치) */}
              <button
                type="button"
                onClick={() => setIsPresetModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 hover:border-cyan-500/50 font-bold transition-all cursor-pointer shrink-0 text-xs shadow-sm"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                <span>양식 변경</span>
              </button>
            </div>

            {/* 2. 하단 행: 좌측 PJT 양식 명칭 & 우측 총 N개 품목 */}
            <div className="flex items-center justify-between gap-2">
              {/* PJT 양식 명칭 */}
              <div className="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-700 text-xs shadow-inner min-w-0 flex-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span className="text-slate-400 text-[11px] shrink-0">PJT 양식:</span>
                <span className="font-bold text-cyan-300 font-mono truncate" title={project.equipmentName}>
                  {project.equipmentName || "표준 기본 양식"}
                </span>
              </div>

              {/* 총 품목 개수 (양식변경 버튼 바로 아래) */}
              <span className="bg-slate-900 text-slate-300 px-2.5 py-1 rounded-lg text-[11px] font-mono border border-slate-800 font-semibold shrink-0 whitespace-nowrap">
                총 <strong className="text-white font-bold">{project.equipmentUnits[0]?.parts?.length || 0}</strong>개 품목
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {project.equipmentUnits.map((u) => (
              <div
                key={u.unitIndex}
                className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 flex items-center gap-2.5"
              >
                <span className="text-xs font-bold text-slate-300 font-mono shrink-0 whitespace-nowrap">
                  {u.unitIndex}호기 S/N
                </span>
                <input
                  type="text"
                  placeholder={`예: SOTSU-SK26-100${u.unitIndex}`}
                  value={u.equipmentSerial}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const val = e.target.value.toUpperCase();
                    if (u.unitIndex === 1) {
                      // 1호기 수정 시 뒤에 있는 모든 호기에 +1 자동 연속 채번
                      onUpdate((prev) => ({
                        ...prev,
                        equipmentUnits: prev.equipmentUnits.map((unit) => ({
                          ...unit,
                          equipmentSerial: cascadeSerialFromUnit1(val, unit.unitIndex),
                        })),
                      }));
                    } else {
                      // 2호기 이후는 해당 호기만 개별 수정
                      onUpdate((prev) => ({
                        ...prev,
                        equipmentUnits: prev.equipmentUnits.map((unit) =>
                          unit.unitIndex === u.unitIndex ? { ...unit, equipmentSerial: val } : unit
                        ),
                      }));
                    }
                  }}
                  className="flex-1 min-w-0 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs font-mono font-bold text-cyan-300 uppercase focus:border-cyan-500 focus:outline-none"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
          {onBackToPjtList ? (
            <button
              type="button"
              onClick={onBackToPjtList}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-5 py-3 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition-all cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>1. PJT List 목록</span>
            </button>
          ) : <div />}

          <button
            type="button"
            onClick={handleNextClick}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3 text-xs font-extrabold text-slate-950 shadow-glow-cyan hover:opacity-95 transition-all cursor-pointer"
          >
            <span>PJT 추가 & OCR 등록</span>
            <ArrowRight className="h-4 w-4 stroke-[2.5]" />
          </button>
        </div>

      {/* 📑 PJT 양식 Modal */}
      <PresetModal
        isOpen={isPresetModalOpen}
        onClose={() => setIsPresetModalOpen(false)}
        onAddParts={(parts) => {
          onUpdate((prev) => ({
            ...prev,
            equipmentUnits: prev.equipmentUnits.map((u) => ({
              ...u,
              parts: [...u.parts, ...parts.map((p) => ({ ...p, id: generateId() }))],
            })),
          }));
        }}
        onReplaceParts={(parts) => {
          onUpdate((prev) => ({
            ...prev,
            equipmentUnits: prev.equipmentUnits.map((u) => ({
              ...u,
              parts: parts.map((p) => ({ ...p, id: generateId() })),
            })),
          }));
        }}
        onSelectTemplate={handleApplyTemplateToAllUnits}
        currentUnitParts={project.equipmentUnits[0]?.parts || []}
      />
    </div>
  );
};
