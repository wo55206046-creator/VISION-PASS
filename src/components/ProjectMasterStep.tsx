import React, { useState } from "react";
import { ProjectMaster, PartItem, PjtModelTemplate } from "@/types";
import { DEFAULT_SITES, createEmptyProject, PJT_MODEL_TEMPLATES } from "@/lib/default-presets";
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
  Plus,
} from "lucide-react";

// Helper function to generate IDs
const generateId = () => Math.random().toString(36).substring(2, 9);

/**
 * 💡 고객사/엑셀 복사 붙여넣기 텍스트 스마트 자동 분리 함수
 * 예시: "SDC 아산\tS26-01-16\tIAM-2", "SDC 아산 >> S26-01-16 >> IAM-2", "SDC 아산, S26-01-16, IAM-2", "SDC 아산 S26-01-16 IAM-2"
 */
export function parseCombinedPjtInput(input: string): {
  site?: string;
  pjtCode?: string;
  equipmentName?: string;
} | null {
  if (!input || typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  // 1. 탭 구분 (엑셀 행 복사-붙여넣기 형태: SDC 아산\tS26-01-16\tIAM-2)
  if (raw.includes("\t")) {
    const tokens = raw.split("\t").map((s) => s.trim()).filter(Boolean);
    if (tokens.length >= 2) {
      return {
        site: tokens[0],
        pjtCode: tokens[1]?.toUpperCase(),
        equipmentName: tokens.slice(2).join(" ") || "",
      };
    }
  }

  // 2. 콤마, 세미콜론, 슬래시, 파이프, >> 구분자
  if (/[,/|;]|>>/.test(raw)) {
    const tokens = raw.split(/[,/|;]|>>/).map((s) => s.trim()).filter(Boolean);
    if (tokens.length >= 2) {
      return {
        site: tokens[0],
        pjtCode: tokens[1]?.toUpperCase(),
        equipmentName: tokens.slice(2).join(" ") || "",
      };
    }
  }

  // 3. 공백 구분 + PJT 코드 패턴 (S\d{2}-\d{2}-\d{2} 등)
  const pjtMatch = raw.match(/([A-Za-z]\d{2}-\d{1,3}-\d{1,3}|[A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9]+)/i);
  if (pjtMatch && pjtMatch.index !== undefined && pjtMatch.index > 0) {
    const sitePart = raw.substring(0, pjtMatch.index).trim();
    const pjtPart = pjtMatch[1].toUpperCase();
    const modelPart = raw.substring(pjtMatch.index + pjtMatch[0].length).trim();
    if (sitePart && (pjtPart || modelPart)) {
      return {
        site: sitePart,
        pjtCode: pjtPart,
        equipmentName: modelPart,
      };
    }
  }

  return null;
}

const STORAGE_TEMPLATES_KEY = "VISION_PASS_PJT_TEMPLATES_V2";

/**
 * 💡 4단계(설비 부품 양식)에 등록된 최신 PJT 양식 목록 로드
 */
export function getRegisteredTemplates(): PjtModelTemplate[] {
  try {
    if (typeof window !== "undefined") {
      const saved =
        localStorage.getItem(STORAGE_TEMPLATES_KEY) ||
        localStorage.getItem("VISION_PASS_TEMPLATES_V2") ||
        localStorage.getItem("VISION_PASS_TEMPLATES_V1");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    }
  } catch (e) {
    console.warn("Error loading registered templates:", e);
  }
  return PJT_MODEL_TEMPLATES;
}

/**
 * 💡 모델명 또는 PJT 코드로 가장 적합한 PJT 표준 양식(Template) 자동 매칭
 * 4단계 [설비 부품 양식]에 등록된 사용자 양식 및 수정사항을 최우선으로 매칭합니다.
 */
export function findMatchingTemplate(
  modelName?: string,
  pjtCode?: string,
  customTemplates?: PjtModelTemplate[]
): PjtModelTemplate | null {
  try {
    const allTemplates = customTemplates && customTemplates.length > 0
      ? customTemplates
      : getRegisteredTemplates();

    const cleanModel = (modelName || "").trim().toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
    const cleanPjt = (pjtCode || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

    if (!cleanModel && !cleanPjt) return null;

    // 1. 모델명 유사도 검색 (최우선)
    if (cleanModel) {
      // 1-1. 완전 일치 (Exact match)
      const exact = allTemplates.find((t) => {
        const tModel = t.modelName.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
        return tModel === cleanModel;
      });
      if (exact) return exact;

      // 1-2. 접두사 일치 (Prefix match - 예: WOA-683 -> WOA-683 8P)
      const prefixMatch = allTemplates.find((t) => {
        const tModel = t.modelName.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
        return tModel.startsWith(cleanModel) || cleanModel.startsWith(tModel);
      });
      if (prefixMatch) return prefixMatch;

      // 1-3. 포함 일치 (Substring match)
      const subMatch = allTemplates.find((t) => {
        const tModel = t.modelName.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
        return tModel.includes(cleanModel);
      });
      if (subMatch) return subMatch;

      // 1-4. 역방향 포함 일치 (긴 사양서명 입력 시)
      if (cleanModel.length >= 3) {
        const reverseMatch = allTemplates.find((t) => {
          const tModel = t.modelName.toLowerCase().replace(/[^a-z0-9가-힣]/g, "");
          return tModel.length >= 3 && cleanModel.includes(tModel);
        });
        if (reverseMatch) return reverseMatch;
      }
    }

    // 2. PJT 코드 힌트 검색 (차순위)
    if (cleanPjt) {
      const match = allTemplates.find((t) => {
        const tPjt = (t.pjtCodeHint || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
        return tPjt && (tPjt === cleanPjt || tPjt.includes(cleanPjt) || cleanPjt.includes(tPjt));
      });
      if (match) return match;
    }
  } catch (e) {
    console.warn("Error finding matching template:", e);
  }
  return null;
}

interface ProjectMasterStepProps {
  project: ProjectMaster;
  isDraft?: boolean;
  onUpdate: (updater: (prev: ProjectMaster) => ProjectMaster) => void;
  onNext: () => void;
  onSaveAndGoList?: () => void;
  onBackToPjtList?: () => void;
}

export const ProjectMasterStep: React.FC<ProjectMasterStepProps> = ({
  project,
  isDraft = false,
  onUpdate,
  onNext,
  onSaveAndGoList,
  onBackToPjtList,
}) => {
  const [customSite, setCustomSite] = useState("");
  const [isCustomSiteMode, setIsCustomSiteMode] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [smartAutoFilled, setSmartAutoFilled] = useState(false);
  const [isPresetModalOpen, setIsPresetModalOpen] = useState(false);

  // 수량 입력란 타이핑 중간 상태 (Backspace 시 1로 즉시 튕겨나가는 현상 방지)
  const [quantityInput, setQuantityInput] = useState<string>(String(project.quantity || 1));

  // 4단계(설비 부품 양식)에서 등록된 최신 양식 목록 로드
  const [registeredTemplates, setRegisteredTemplates] = useState<PjtModelTemplate[]>(() => {
    return getRegisteredTemplates();
  });

  // 양식 변경 모달이 닫히거나 변경되었을 때 최신 양식 즉시 재동기화
  React.useEffect(() => {
    setRegisteredTemplates(getRegisteredTemplates());
  }, [isPresetModalOpen]);

  React.useEffect(() => {
    setQuantityInput(String(project.quantity || 1));
  }, [project.quantity]);

  // 모델명 직접 입력 시 4단계 양식과 실시간 자동 매칭
  const handleEquipmentNameChange = (val: string) => {
    onUpdate((prev) => {
      const matched = findMatchingTemplate(val, prev.pjtCode, registeredTemplates);
      if (matched && matched.parts && matched.parts.length > 0 && matched.modelName !== prev.templateName) {
        const templateParts = matched.parts.map((p) => ({
          ...p,
          id: generateId(),
          detectedSerial: "",
          isVerified: false,
          scannedAt: undefined,
          confidence: undefined,
        }));
        return {
          ...prev,
          equipmentName: val,
          templateName: matched.modelName,
          equipmentUnits: (prev.equipmentUnits || []).map((u) => ({
            ...u,
            parts: templateParts.map((p) => ({ ...p, id: generateId() })),
          })),
        };
      }
      return {
        ...prev,
        equipmentName: val,
      };
    });
  };

  // PJT CODE 직접 입력 시 모델명이 비어있을 경우 해당 코드의 양식 자동 추천
  const handlePjtCodeChange = (val: string) => {
    const code = val.toUpperCase();
    onUpdate((prev) => {
      if (!prev.equipmentName?.trim()) {
        const matched = findMatchingTemplate("", code, registeredTemplates);
        if (matched && matched.parts && matched.parts.length > 0 && matched.modelName !== prev.templateName) {
          const templateParts = matched.parts.map((p) => ({
            ...p,
            id: generateId(),
            detectedSerial: "",
            isVerified: false,
          }));
          return {
            ...prev,
            pjtCode: code,
            templateName: matched.modelName,
            equipmentName: matched.modelName,
            equipmentUnits: (prev.equipmentUnits || []).map((u) => ({
              ...u,
              parts: templateParts.map((p) => ({ ...p, id: generateId() })),
            })),
          };
        }
      }
      return {
        ...prev,
        pjtCode: code,
      };
    });
  };

  // 스마트 자동 분리 데이터 일괄 적용
  const applySmartParsedData = (parsed: { site?: string; pjtCode?: string; equipmentName?: string }) => {
    const matchedTpl = findMatchingTemplate(parsed.equipmentName, parsed.pjtCode, registeredTemplates);

    onUpdate((prev) => {
      let updatedUnits = prev?.equipmentUnits || [];
      let templateName = prev?.templateName;

      if (matchedTpl && matchedTpl.parts?.length > 0) {
        templateName = matchedTpl.modelName;
        const templateParts = matchedTpl.parts.map((p) => ({
          ...p,
          id: generateId(),
          detectedSerial: "",
          isVerified: false,
          scannedAt: undefined,
          confidence: undefined,
        }));
        updatedUnits = updatedUnits.map((u) => ({
          ...u,
          parts: templateParts.map((p) => ({ ...p, id: generateId() })),
        }));
      }

      return {
        ...prev,
        site: parsed.site !== undefined ? parsed.site : prev.site,
        pjtCode: parsed.pjtCode !== undefined ? parsed.pjtCode : prev.pjtCode,
        equipmentName: parsed.equipmentName !== undefined ? parsed.equipmentName : prev.equipmentName,
        templateName: templateName || prev.templateName,
        equipmentUnits: updatedUnits,
      };
    });

    setSmartAutoFilled(true);
    setTimeout(() => setSmartAutoFilled(false), 4500);
  };

  // 최근 설비 담당자 목록 및 최신 1순위 담당자 추출
  const { recentInspectors, lastInspector } = React.useMemo(() => {
    let list: string[] = [];
    let latest = "";
    try {
      if (typeof window !== "undefined") {
        latest = localStorage.getItem("VISION_PASS_LAST_INSPECTOR") || "";
        const saved =
          localStorage.getItem("VISION_PASS_PROJECTS_V2") ||
          localStorage.getItem("VISION_PASS_PROJECTS_V1");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const names = parsed
              .map((p: any) => p.inspectorName?.trim())
              .filter(Boolean);
            if (!latest && names.length > 0) {
              latest = names[0];
            }
            list = Array.from(new Set([latest, ...names].filter(Boolean))) as string[];
          }
        }
      }
    } catch (e) { }

    if (list.length === 0) {
      list = ["김충환, 김태현", "김형태, 유병준", "손홍렬, 정재헌"];
      if (!latest) latest = "홍길동";
    }

    return { recentInspectors: list, lastInspector: latest || list[0] };
  }, []);

  // 수량 변경 시 equipmentUnits 동기화 (최대 1,000대 지원 및 기존 데이터 보존)
  const handleQuantityChange = (newQty: number) => {
    const clampedQty = Math.max(1, Math.min(1000, newQty));

    onUpdate((prev) => {
      const currentUnits = [...(prev?.equipmentUnits || [])];
      const diff = clampedQty - currentUnits.length;

      if (diff > 0) {
        // 호기 추가
        for (let i = 0; i < diff; i++) {
          const nextIndex = currentUnits.length + 1;
          const templateParts = (currentUnits[0]?.parts || []).map((p) => ({
            ...p,
            id: generateId(),
            detectedSerial: "",
            isVerified: false,
            scannedAt: undefined,
            confidence: undefined,
          }));

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
        currentUnits.splice(clampedQty);
      }

      return {
        ...prev,
        quantity: clampedQty,
        equipmentUnits: currentUnits,
      };
    });
  };

  const handleNextClick = () => {
    let currentSite = project?.site || "";
    let currentPjtCode = project?.pjtCode || "";
    let currentEquipmentName = project?.equipmentName || "";

    // 만약 고객사 입력란에 합쳐진 문자열이 남아있다면 마지막으로 스마트 분리 실행
    const parsed = parseCombinedPjtInput(currentSite) || parseCombinedPjtInput(currentPjtCode);
    if (parsed) {
      currentSite = parsed.site || currentSite;
      currentPjtCode = parsed.pjtCode || currentPjtCode;
      currentEquipmentName = parsed.equipmentName || currentEquipmentName;

      const matchedTpl = findMatchingTemplate(currentEquipmentName, currentPjtCode, registeredTemplates);
      let updatedUnits = project.equipmentUnits || [];
      let templateName = project.templateName;

      if (matchedTpl && matchedTpl.parts?.length > 0) {
        templateName = matchedTpl.modelName;
        const templateParts = matchedTpl.parts.map((p) => ({
          ...p,
          id: generateId(),
          detectedSerial: "",
          isVerified: false,
        }));
        updatedUnits = updatedUnits.map((u) => ({
          ...u,
          parts: templateParts.map((p) => ({ ...p, id: generateId() })),
        }));
      }

      onUpdate((prev) => ({
        ...prev,
        site: currentSite,
        pjtCode: currentPjtCode,
        equipmentName: currentEquipmentName,
        templateName: templateName || prev.templateName,
        equipmentUnits: updatedUnits,
      }));
    }

    if (!currentPjtCode?.trim()) {
      setErrorMsg("PJT CODE를 입력해주세요.");
      return;
    }
    if (!currentEquipmentName?.trim()) {
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

      const updatedUnits = (prev?.equipmentUnits || []).map((u) => ({
        ...u,
        parts: templateParts.map((p) => ({ ...p, id: generateId() })),
      }));

      return {
        ...prev,
        templateName: template.modelName, // 선택된 모델 양식명 명시적 저장
        equipmentName: prev?.equipmentName || template.modelName, // 모델명이 비어있을 경우 자동 채움
        equipmentUnits: updatedUnits,
      };
    });
    setIsPresetModalOpen(false);
  };

  // 고객사 첫 단어/접두사(SEC, SKH 등) 입력 시에만 추천 활성화 (공백 입력 및 세부 위치 입력 시 비활성화)
  const isInitialPrefixSearch = Boolean(
    project.site &&
    !project.site.includes(" ") &&
    project.site.trim().length >= 1 &&
    project.site.trim().length <= 6
  );

  const filteredSiteSuggestions = React.useMemo(() => {
    if (!isInitialPrefixSearch) return [];
    const query = (project.site || "").trim().toUpperCase();
    return DEFAULT_SITES.filter((site) => {
      const siteUpper = site.toUpperCase();
      return siteUpper.startsWith(query) || siteUpper.includes(query);
    });
  }, [project.site, isInitialPrefixSearch]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Top Banner (01처럼 깔끔하게 제목만 표시) */}
      <div className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-slate-900 via-cleanroom-850 to-slate-900 p-4 sm:p-5 border border-slate-800 shadow-xl">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400 font-mono font-bold text-xs border border-cyan-500/30 shrink-0">
            02
          </span>
          <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
            {isDraft ? "신규 프로젝트 추가" : "프로젝트 정보 수정"}
          </h2>
        </div>
      </div>

      {smartAutoFilled && (
        <div className="flex items-center gap-2.5 rounded-xl bg-cyan-950/90 p-3.5 text-xs sm:text-sm text-cyan-300 border border-cyan-500/60 shadow-glow-cyan animate-fadeIn">
          <Sparkles className="h-5 w-5 text-cyan-400 shrink-0" />
          <span>✨ <strong>스마트 자동 분리 완료:</strong> 고객사 / PJT CODE / 모델명이 자동으로 분리 인식되어 입력되었습니다!</span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2.5 rounded-xl bg-red-950/60 p-4 text-sm text-red-300 border border-red-800/60 animate-shake">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Form Card (왼쪽 사진과 100% 동일한 2열 분할 컴팩트 레이아웃) */}
      <div className="rounded-2xl bg-slate-900/90 p-4 sm:p-7 border border-slate-800 shadow-2xl backdrop-blur-sm space-y-3.5 sm:space-y-4">
        {/* 1. 고객사 (좌) & PJT CODE (우) */}
        <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
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
                list={isInitialPrefixSearch && filteredSiteSuggestions.length > 0 ? "site-datalist-options" : undefined}
                placeholder="예: SKH 이천, SEC 평택 (또는 전체 복사 붙여넣기)"
                value={project.site}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = e.target.value;
                  const parsed = parseCombinedPjtInput(val);
                  if (parsed) {
                    applySmartParsedData(parsed);
                  } else {
                    onUpdate((prev) => ({ ...prev, site: val }));
                  }
                }}
                onPaste={(e: React.ClipboardEvent<HTMLInputElement>) => {
                  const pasteText = e.clipboardData.getData("text");
                  const parsed = parseCombinedPjtInput(pasteText);
                  if (parsed) {
                    e.preventDefault();
                    applySmartParsedData(parsed);
                  }
                }}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
              {isInitialPrefixSearch && filteredSiteSuggestions.length > 0 && (
                <datalist id="site-datalist-options">
                  {filteredSiteSuggestions.map((site) => (
                    <option key={site} value={site} />
                  ))}
                </datalist>
              )}
            </div>
          </div>

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
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = e.target.value;
                  const parsed = parseCombinedPjtInput(val);
                  if (parsed) {
                    applySmartParsedData(parsed);
                  } else {
                    handlePjtCodeChange(val);
                  }
                }}
                onPaste={(e: React.ClipboardEvent<HTMLInputElement>) => {
                  const pasteText = e.clipboardData.getData("text");
                  const parsed = parseCombinedPjtInput(pasteText);
                  if (parsed) {
                    e.preventDefault();
                    applySmartParsedData(parsed);
                  }
                }}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs sm:text-sm font-mono font-bold text-cyan-300 uppercase placeholder:font-sans placeholder:normal-case placeholder:font-normal placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
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
            <span className="text-[10px] font-mono text-cyan-400">사양서 확인 / 4단계 양식 자동 추천</span>
          </div>
          <div className="relative">
            <input
              type="text"
              list="template-models-datalist"
              placeholder="예: NaVi-MG200, WOA-683 8P, Navi-WF301 24P"
              value={project.equipmentName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const val = e.target.value;
                const parsed = parseCombinedPjtInput(val);
                if (parsed) {
                  applySmartParsedData(parsed);
                } else {
                  handleEquipmentNameChange(val);
                }
              }}
              onBlur={() => {
                if (project.equipmentName) {
                  const matched = findMatchingTemplate(project.equipmentName, project.pjtCode, registeredTemplates);
                  if (matched && matched.parts && matched.modelName !== project.templateName) {
                    handleApplyTemplateToAllUnits(matched);
                  }
                }
              }}
              onPaste={(e: React.ClipboardEvent<HTMLInputElement>) => {
                const pasteText = e.clipboardData.getData("text");
                const parsed = parseCombinedPjtInput(pasteText);
                if (parsed) {
                  e.preventDefault();
                  applySmartParsedData(parsed);
                }
              }}
              className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            {/* 4. 설비 부품 양식에 등록된 목록 자동완성 Datalist */}
            <datalist id="template-models-datalist">
              {registeredTemplates.map((t) => (
                <option key={t.id} value={t.modelName}>
                  {t.description ? `${t.description} (${t.parts?.length || 0}개 품목)` : `${t.parts?.length || 0}개 품목`}
                </option>
              ))}
            </datalist>
          </div>
        </div>

        {/* 3. 설비 담당자 (좌) & 검수일자 (우) */}
        <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
          {/* 설비 담당자 */}
          <div className="space-y-1.5 min-w-0">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <UserCheck className="h-3.5 w-3.5 text-cyan-400" />
              <span>설비 담당자</span>
            </label>
            <input
              type="text"
              list="inspector-datalist-step2"
              placeholder="예: 홍길동, 김철수"
              value={project.inspectorName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onUpdate((prev) => ({ ...prev, inspectorName: e.target.value }))
              }
              className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            <datalist id="inspector-datalist-step2">
              {recentInspectors.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>

            {/* 최근 설비 담당자 퀵 추천 태그 (오른쪽으로 ㅡ자 수평 1행 배치) */}
            {recentInspectors.length > 0 && (
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar whitespace-nowrap pt-0.5">
                <span className="text-[10px] text-slate-500 font-semibold shrink-0">최근:</span>
                {recentInspectors.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => onUpdate((prev) => ({ ...prev, inspectorName: name }))}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all cursor-pointer shrink-0 ${
                      project.inspectorName === name
                        ? "bg-cyan-500 text-slate-950 font-bold shadow-glow-cyan"
                        : "bg-slate-800/90 text-slate-300 hover:bg-slate-700 hover:text-cyan-300 border border-slate-700/60"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
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
                } catch (err) { }
              }}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onUpdate((prev) => ({ ...prev, inspectionDate: e.target.value }))
              }
              style={{ colorScheme: "dark" }}
              className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
            />
          </div>
        </div>

        {/* 4. 설비 수량 (호기 생성) - 최대 1,000대 확장 및 안정적인 타이핑 지원 */}
        <div className="space-y-1.5">
          <label className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-cyan-400" />
              <span>설비 수량 (호기 생성)</span> <span className="text-cyan-400">*</span>
            </span>
            <span className="text-[11px] text-slate-400 font-mono">
              현재 {project.quantity}개 호기 (최대 1,000대 지원)
            </span>
          </label>

          <div className="flex items-center gap-2 max-w-xs">
            <button
              type="button"
              onClick={() => {
                const nextVal = Math.max(1, (project.quantity || 1) - 1);
                handleQuantityChange(nextVal);
                setQuantityInput(String(nextVal));
              }}
              disabled={(project.quantity || 1) <= 1}
              className="flex h-9 w-10 items-center justify-center rounded-xl bg-slate-800 text-base font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
            >
              -
            </button>
            <input
              type="number"
              min="1"
              max="1000"
              value={quantityInput}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                const raw = e.target.value;
                setQuantityInput(raw);
                if (raw.trim() !== "") {
                  const parsed = parseInt(raw, 10);
                  if (!isNaN(parsed) && parsed >= 1 && parsed <= 1000) {
                    handleQuantityChange(parsed);
                  }
                }
              }}
              onBlur={() => {
                const parsed = parseInt(quantityInput, 10);
                if (isNaN(parsed) || parsed < 1) {
                  handleQuantityChange(1);
                  setQuantityInput("1");
                } else if (parsed > 1000) {
                  handleQuantityChange(1000);
                  setQuantityInput("1000");
                } else {
                  handleQuantityChange(parsed);
                  setQuantityInput(String(parsed));
                }
              }}
              style={{ MozAppearance: "textfield" }}
              className="w-full text-center rounded-xl bg-slate-950 border border-slate-700 py-1.5 text-sm font-bold font-mono text-cyan-300 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              type="button"
              onClick={() => {
                const nextVal = Math.min(1000, (project.quantity || 1) + 1);
                handleQuantityChange(nextVal);
                setQuantityInput(String(nextVal));
              }}
              disabled={(project.quantity || 1) >= 1000}
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
            <div className="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-700 text-xs shadow-inner min-w-0 flex-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span className="text-slate-400 text-[11px] shrink-0 font-bold">PJT 양식:</span>
              <span
                className="font-bold text-cyan-300 font-mono truncate text-xs"
                title={project.templateName || project.equipmentName || "표준 기본 양식"}
              >
                {project.templateName || project.equipmentName || "표준 기본 양식"}
              </span>
            </div>

            {/* 총 품목 개수 (양식변경 버튼 바로 아래) */}
            <span className="bg-slate-900 text-slate-300 px-2.5 py-1.5 rounded-lg text-[11px] font-mono border border-slate-800 font-semibold shrink-0 whitespace-nowrap">
              총 <strong className="text-white font-bold">{project.equipmentUnits[0]?.parts?.length || 0}</strong>개 품목
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(project?.equipmentUnits || []).map((u) => (
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
                value={u.equipmentSerial || ""}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = e.target.value.toUpperCase();
                  if (u.unitIndex === 1) {
                    // 1호기 수정 시 뒤에 있는 모든 호기에 +1 자동 연속 채번
                    onUpdate((prev) => ({
                      ...prev,
                      equipmentUnits: (prev?.equipmentUnits || []).map((unit) => ({
                        ...unit,
                        equipmentSerial: cascadeSerialFromUnit1(val, unit.unitIndex),
                      })),
                    }));
                  } else {
                    // 2호기 이후는 해당 호기만 개별 수정
                    onUpdate((prev) => ({
                      ...prev,
                      equipmentUnits: (prev?.equipmentUnits || []).map((unit) =>
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
      <div className="pt-4 border-t border-slate-800 flex items-center justify-between gap-2">
        {onBackToPjtList ? (
          <button
            type="button"
            onClick={onBackToPjtList}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-4 sm:px-5 py-3 text-xs font-bold text-slate-300 hover:bg-slate-700 hover:text-white transition-all cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>1. PJT List 목록</span>
          </button>
        ) : <div />}

        <div className="flex items-center gap-2">
          {isDraft && onSaveAndGoList && (
            <button
              type="button"
              onClick={() => {
                let currentPjtCode = project?.pjtCode || "";
                let currentEquipmentName = project?.equipmentName || "";
                if (!currentPjtCode?.trim()) {
                  setErrorMsg("PJT CODE를 입력해주세요.");
                  return;
                }
                if (!currentEquipmentName?.trim()) {
                  setErrorMsg("설비명을 입력해주세요.");
                  return;
                }
                setErrorMsg(null);
                onSaveAndGoList();
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3.5 sm:px-4 py-3 text-xs font-bold text-cyan-300 transition-all cursor-pointer shadow-sm"
              title="프로젝트를 등록하고 1단계 목록으로 돌아갑니다"
            >
              <CheckCircle2 className="h-4 w-4 text-cyan-400" />
              <span>저장 후 목록으로</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleNextClick}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 sm:px-6 py-3 text-xs font-extrabold text-slate-950 shadow-glow-cyan hover:opacity-95 transition-all cursor-pointer"
          >
            {isDraft ? (
              <>
                <Plus className="h-4 w-4 stroke-[3]" />
                <span>PJT 생성 및 OCR 검사 시작</span>
                <ArrowRight className="h-4 w-4 stroke-[2.5]" />
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 stroke-[2.5]" />
                <span>수정사항 저장</span>
              </>
            )}
          </button>
        </div>
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
