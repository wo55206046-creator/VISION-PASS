"use client";

import React, { useState, useEffect, useRef } from "react";
import { ProjectMaster } from "@/types";
import { INITIAL_PROJECT_LIST, createBlankProject } from "@/lib/default-presets";
import { Header } from "@/components/Header";
import { PjtListStep } from "@/components/PjtListStep";
import { ProjectMasterStep } from "@/components/ProjectMasterStep";
import { EquipmentUnitStep } from "@/components/EquipmentUnitStep";
import { TemplateManagerStep } from "@/components/TemplateManagerStep";
import {
  pushProjectsToCloud,
  pullProjectsFromCloud,
  subscribeLocalBroadcast,
  subscribeCloudRealtime,
  getSyncRoomKey,
  setSyncRoomKey,
} from "@/lib/cloud-sync";
import { initOfflineQueueListener } from "@/lib/offline-sync-queue";
import { mergeProjectLists, countVerifiedSerials } from "@/lib/project-merger";
import {
  ShieldCheck,
  Cpu,
  FolderKanban,
  FileEdit,
  Camera,
  Layers,
} from "lucide-react";

const STORAGE_KEY = "VISION_PASS_PROJECTS_DATA_V8";
const PERSISTENT_BACKUP_KEY = "VISION_PASS_PERMANENT_SERIALS_SNAPSHOT";
const STORAGE_ACTIVE_PROJECT_ID = "VISION_PASS_ACTIVE_PROJECT_ID";
const STORAGE_ACTIVE_STEP = "VISION_PASS_ACTIVE_STEP";
const LEGACY_STORAGE_KEYS = [
  PERSISTENT_BACKUP_KEY,
  STORAGE_KEY,
  "VISION_PASS_PROJECTS_DATA_V7",
  "VISION_PASS_PROJECTS_DATA_V6",
  "VISION_PASS_PROJECTS_DATA_V5",
  "VISION_PASS_PROJECTS_DATA_V4",
  "VISION_PASS_PROJECTS_DATA_V3",
  "VISION_PASS_PROJECTS_DATA_V2",
  "VISION_PASS_PROJECTS_DATA_V1",
  "VISION_PASS_PROJECTS_V2",
  "VISION_PASS_PROJECTS_V1",
  "VISION_PASS_PROJECTS_DATA",
  "VISION_PASS_PROJECTS",
];

function loadSavedProjects(): ProjectMaster[] {
  if (typeof window === "undefined") return INITIAL_PROJECT_LIST;

  try {
    // 1. 현재 최신 V8 또는 영구 백업에 데이터가 이미 있으면 최우선 반환 (구버전 캐시로 덮어쓰기 원천 차단)
    const primaryKeys = [STORAGE_KEY, PERSISTENT_BACKUP_KEY];
    for (const key of primaryKeys) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0 && (parsed[0].pjtCode !== undefined || parsed[0].site !== undefined)) {
            return parsed;
          }
        } catch {}
      }
    }

    // 2. primaryKeys에 없는 경우에만 과거 레거시 버전 탐색
    let bestCandidate: ProjectMaster[] | null = null;
    let bestSerialCount = -1;

    for (const key of LEGACY_STORAGE_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0 && (parsed[0].pjtCode !== undefined || parsed[0].site !== undefined)) {
            const serialCount = countVerifiedSerials(parsed);
            if (!bestCandidate || serialCount > bestSerialCount) {
              bestCandidate = parsed;
              bestSerialCount = serialCount;
            }
          }
        } catch {}
      }
    }

    if (bestCandidate && bestCandidate.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(bestCandidate));
        localStorage.setItem(PERSISTENT_BACKUP_KEY, JSON.stringify(bestCandidate));
      } catch {}
      return bestCandidate;
    }
  } catch (e) {
    console.warn("Failed to load projects from localStorage", e);
  }

  return INITIAL_PROJECT_LIST;
}

export default function MainApp() {
  const [currentStep, setCurrentStep] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    try {
      const s = localStorage.getItem(STORAGE_ACTIVE_STEP);
      if (s) {
        const parsed = parseInt(s, 10);
        if (parsed >= 1 && parsed <= 4) return parsed;
      }
    } catch {}
    return 1;
  });

  const [projects, setProjects] = useState<ProjectMaster[]>(() => {
    if (typeof window !== "undefined") {
      const saved = loadSavedProjects();
      if (saved && saved.length > 0) return saved;
    }
    return INITIAL_PROJECT_LIST;
  });

  const [currentProjectId, setCurrentProjectId] = useState<string>(() => {
    if (typeof window === "undefined") return INITIAL_PROJECT_LIST[0]?.id || "pjt-001";
    try {
      const savedId = localStorage.getItem(STORAGE_ACTIVE_PROJECT_ID);
      if (savedId && savedId.trim()) return savedId.trim();
    } catch {}
    return INITIAL_PROJECT_LIST[0]?.id || "pjt-001";
  });

  const [draftProject, setDraftProject] = useState<ProjectMaster | null>(null);

  // 실시간 동기화 및 데이터 영구 보존 제어용 Refs
  const isInitialMount = useRef(true);
  const isInitialLoadComplete = useRef(false); // ★ 초기 로드 전 빈 데이터로 클라우드 덮어쓰기 원천 차단
  const isSyncingInFlight = useRef(false);
  const lastKnownCloudJson = useRef<string>("");
  const syncPushTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastLocalEditTimeRef = useRef<number>(0); // ★ 로컬 수정 보호 락 (Anti-Revert Lock)

  // 1. [자동 수신] 클라우드 최신 데이터 실시간 풀 함수 (스마트 병합 적용)
  const fetchCloudProjects = async () => {
    if (isSyncingInFlight.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    try {
      isSyncingInFlight.current = true;
      const res = await pullProjectsFromCloud();
      if (res.success && res.projects && res.projects.length > 0) {
        setProjects((prevProjects) => {
          // ★ 클라우드의 시리얼 수가 로컬보다 적으면 무조건 로컬 데이터 우선 보호! (원격 빈 데이터로 인한 덮어쓰기 영구 차단)
          const localSerials = countVerifiedSerials(prevProjects);
          const cloudSerials = countVerifiedSerials(res.projects!);
          if (cloudSerials < localSerials) {
            // 로컬에 작업 중인 시리얼이 더 많으므로 클라우드로 즉시 역동기화(Auto-heal)
            pushProjectsToCloud(prevProjects).catch(() => {});
            return prevProjects;
          }

          // ★ 기존 로컬에 이미 입력된 시리얼 번호가 절대 사라지지 않도록 스마트 병합!
          const merged = mergeProjectLists(prevProjects, res.projects!);
          const mergedJson = JSON.stringify(merged);
          lastKnownCloudJson.current = mergedJson;
          try {
            localStorage.setItem(STORAGE_KEY, mergedJson);
            localStorage.setItem(PERSISTENT_BACKUP_KEY, mergedJson);
          } catch {}
          return merged;
        });
      }
    } catch {
      // 백그라운드 네트워크 상태 무소음 처리
    } finally {
      isSyncingInFlight.current = false;
      isInitialLoadComplete.current = true;
    }
  };

  // 2. 초기 로드 및 URL 파라미터 연동, SSE 실시간 동기화 리스너 등록
  useEffect(() => {
    // URL ?room=... 파라미터 확인 (QR 스캔 또는 링크로 접속 시 해당 방 자동 접속)
    if (typeof window !== "undefined") {
      try {
        const params = new URLSearchParams(window.location.search);
        const room = params.get("room");
        if (room && room.trim()) {
          setSyncRoomKey(room.trim().toUpperCase());
        }
      } catch {}
    }

    // 1단계: 로컬 저장소 및 영구 백업 스냅샷에서 기존 시리얼 작업 데이터 우선 복원
    const saved = loadSavedProjects();
    if (saved && saved.length > 0) {
      setProjects(saved);
      const rememberedId = localStorage.getItem(STORAGE_ACTIVE_PROJECT_ID);
      const targetPjt = rememberedId ? saved.find((p) => p.id === rememberedId) : null;
      if (targetPjt) {
        setCurrentProjectId(targetPjt.id || "pjt-001");
      } else if (saved[0]?.id) {
        setCurrentProjectId(saved[0].id);
      }
      lastKnownCloudJson.current = JSON.stringify(saved);
    }

    // 2단계: 클라우드에서 최신 데이터 가져와 안전 병합(Smart Merge)
    fetchCloudProjects().finally(() => {
      // 초기 로드가 완전히 끝난 뒤에만 자동 푸시 활성화
      setTimeout(() => {
        isInitialLoadComplete.current = true;
      }, 600);
    });

    // 화면 복귀, 탭 포커스 시 부드럽게 1회 확인
    const handleQuickSync = () => fetchCloudProjects();
    window.addEventListener("focus", handleQuickSync);
    document.addEventListener("visibilitychange", handleQuickSync);

    // 1. 로컬 브로드캐스트 채널 구독 (동일 브라우저 탭 간 스마트 병합)
    const unsubscribeBroadcast = subscribeLocalBroadcast((incoming) => {
      if (incoming && incoming.length > 0) {
        setProjects((prev) => {
          const localSerials = countVerifiedSerials(prev);
          const incomingSerials = countVerifiedSerials(incoming);
          if (incomingSerials < localSerials) {
            return prev;
          }
          const merged = mergeProjectLists(prev, incoming);
          const mergedJson = JSON.stringify(merged);
          if (mergedJson !== lastKnownCloudJson.current) {
            lastKnownCloudJson.current = mergedJson;
            try {
              localStorage.setItem(STORAGE_KEY, mergedJson);
              localStorage.setItem(PERSISTENT_BACKUP_KEY, mergedJson);
            } catch {}
          }
          return merged;
        });
      }
    });

    // 2. ⚡ 초고속 실시간 클라우드 스트림 구독 (스마트 병합)
    const unsubscribeRealtime = subscribeCloudRealtime((incoming) => {
      if (incoming && incoming.length > 0) {
        setProjects((prev) => {
          const localSerials = countVerifiedSerials(prev);
          const incomingSerials = countVerifiedSerials(incoming);
          if (incomingSerials < localSerials) {
            return prev;
          }
          const merged = mergeProjectLists(prev, incoming);
          const mergedJson = JSON.stringify(merged);
          if (mergedJson !== lastKnownCloudJson.current) {
            lastKnownCloudJson.current = mergedJson;
            try {
              localStorage.setItem(STORAGE_KEY, mergedJson);
              localStorage.setItem(PERSISTENT_BACKUP_KEY, mergedJson);
            } catch {}
          }
          return merged;
        });
      }
    });

    // 3. 오프라인 작업 큐 리스너 활성화
    const cleanupOfflineQueue = initOfflineQueueListener(async (queuedProjects: ProjectMaster[]) => {
      try {
        await pushProjectsToCloud(queuedProjects);
      } catch (e) {
        console.warn("오프라인 큐 동기화 재시도 실패", e);
      }
    });

    return () => {
      window.removeEventListener("focus", handleQuickSync);
      document.removeEventListener("visibilitychange", handleQuickSync);
      unsubscribeBroadcast();
      unsubscribeRealtime();
      cleanupOfflineQueue();
    };
  }, []);

  // 3. [자동 발신] 프로젝트 변경 시 클라우드로 실시간 안전 푸시 (Debounced & Anti-Revert Lock)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // ★ 초기 로드 및 병합이 완료되기 전 빈 기본값으로 클라우드를 덮어쓰는 것 절대 차단!
    if (!isInitialLoadComplete.current) {
      return;
    }

    // 로컬 변경사항 로컬 스토리지 즉시 저장
    try {
      const currentJson = JSON.stringify(projects);
      localStorage.setItem(STORAGE_KEY, currentJson);
      localStorage.setItem(PERSISTENT_BACKUP_KEY, currentJson);
    } catch (e) {
      console.warn("LocalStorage save error", e);
    }

    const currentJson = JSON.stringify(projects);
    // 클라우드에서 막 받아온 데이터와 완전히 동일하다면 불필요한 푸시 스킵
    if (currentJson !== lastKnownCloudJson.current && projects.length > 0) {
      if (syncPushTimeoutRef.current) clearTimeout(syncPushTimeoutRef.current);
      syncPushTimeoutRef.current = setTimeout(async () => {
        const res = await pushProjectsToCloud(projects);
        if (res.success) {
          lastKnownCloudJson.current = currentJson;
        }
      }, 350);
    }

    return () => {
      if (syncPushTimeoutRef.current) clearTimeout(syncPushTimeoutRef.current);
    };
  }, [projects]);

  // 현재 선택된 프로젝트
  const currentProject = projects.find((p) => p.id === currentProjectId) || projects[0];

  const navigateToStep = (step: number) => {
    setCurrentStep(step);
    try {
      localStorage.setItem(STORAGE_ACTIVE_STEP, String(step));
    } catch {}
  };

  // 프로젝트 실시간 업데이트 (즉시 로컬 저장 및 React 상태 반영)
  const updateCurrentProject = (updater: (prev: ProjectMaster) => ProjectMaster) => {
    lastLocalEditTimeRef.current = Date.now();
    setProjects((prevProjects) => {
      const targetId = currentProjectId || currentProject?.id;
      let matched = false;
      const nextProjects = prevProjects.map((p) => {
        if (
          p.id === targetId ||
          (currentProjectId && p.id === currentProjectId) ||
          (currentProject && p.id === currentProject.id)
        ) {
          matched = true;
          const updated = updater(p);
          return { ...updated, updatedAt: new Date().toISOString() };
        }
        return p;
      });

      // 🛡️ 만약 ID 불일치 시 현재 보고 있던 첫 번째 프로젝트 또는 활성 프로젝트를 확실하게 갱신
      const finalProjects = matched
        ? nextProjects
        : prevProjects.map((p, idx) => {
            if (idx === 0 || (currentProject && p.id === currentProject.id)) {
              const updated = updater(p);
              return { ...updated, updatedAt: new Date().toISOString() };
            }
            return p;
          });
      
      try {
        const nextJson = JSON.stringify(finalProjects);
        localStorage.setItem(STORAGE_KEY, nextJson);
        localStorage.setItem(PERSISTENT_BACKUP_KEY, nextJson);
      } catch (e) {
        console.warn("Storage write error", e);
      }

      return finalProjects;
    });
  };

  const handleCreateNewProject = () => {
    const newPjt = createBlankProject();
    newPjt.id = "pjt-" + Date.now();
    // 최근 설비 담당자 자동 추천/기본값 반영
    try {
      if (typeof window !== "undefined") {
        const lastInspector = localStorage.getItem("VISION_PASS_LAST_INSPECTOR");
        if (lastInspector) {
          newPjt.inspectorName = lastInspector;
        }
      }
    } catch {}
    setDraftProject(newPjt);
    navigateToStep(2); // 2. PJT 입력 단계로 이동
  };

  const handleSelectProject = (projectId: string, targetStep = 3) => {
    setDraftProject(null);
    setCurrentProjectId(projectId);
    navigateToStep(targetStep);
    try {
      localStorage.setItem(STORAGE_ACTIVE_PROJECT_ID, projectId);
    } catch {}
  };

  const handleDuplicateProject = (projectId: string) => {
    const target = projects.find((p) => p.id === projectId);
    if (!target) return;
    const dup: ProjectMaster = {
      ...target,
      id: "pjt-" + Math.random().toString(36).substring(2, 9),
      pjtCode: `${target.pjtCode}-COPY`,
      equipmentUnits: target.equipmentUnits.map((u) => ({
        ...u,
        parts: u.parts.map((p) => ({
          ...p,
          id: "part-" + Math.random().toString(36).substring(2, 9),
          detectedSerial: "",
          isVerified: false,
          scannedAt: undefined,
          confidence: undefined,
        })),
      })),
      updatedAt: new Date().toISOString(),
    };
    const next = [dup, ...projects];
    setProjects(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
    pushProjectsToCloud(next).catch(console.warn);
  };

  const handleDeleteProject = (projectId: string) => {
    const target = projects.find((p) => p.id === projectId);
    const targetName = target ? `${target.pjtCode} (${target.equipmentName})` : "해당 프로젝트";
    if (confirm(`[${targetName}] 를 정말 삭제하시겠습니까?`)) {
      const next = projects.filter((p) => p.id !== projectId);
      setProjects(next);
      if (next.length > 0 && currentProjectId === projectId) {
        const fallbackId = next[0].id || "";
        setCurrentProjectId(fallbackId);
        try {
          localStorage.setItem(STORAGE_ACTIVE_PROJECT_ID, fallbackId);
        } catch {}
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      pushProjectsToCloud(next).catch(console.warn);
    }
  };

  // 2단계에서 [PJT 추가] 완료 시 신규 프로젝트 목록 추가 후 1단계(PJT List)로 이동
  const handleSaveDraftProject = (pjtToSave: ProjectMaster) => {
    const newId = pjtToSave.id && pjtToSave.id !== "draft" ? pjtToSave.id : "pjt-" + Date.now();
    const finalizedPjt: ProjectMaster = {
      ...pjtToSave,
      id: newId,
      updatedAt: new Date().toISOString(),
    };

    // 최근 설비 담당자 기억
    if (finalizedPjt.inspectorName?.trim()) {
      try {
        localStorage.setItem("VISION_PASS_LAST_INSPECTOR", finalizedPjt.inspectorName.trim());
      } catch {}
    }

    const exists = projects.some((p) => p.id === finalizedPjt.id);
    const next = exists
      ? projects.map((p) => (p.id === finalizedPjt.id ? finalizedPjt : p))
      : [finalizedPjt, ...projects];

    setProjects(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
    pushProjectsToCloud(next).catch(console.warn);

    setCurrentProjectId(finalizedPjt.id || "");
    setDraftProject(null);
    navigateToStep(1); // 1. PJT List 목록 화면으로 이동!
    try {
      localStorage.setItem(STORAGE_ACTIVE_PROJECT_ID, finalizedPjt.id || "");
    } catch {}
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950 pb-20 md:pb-6">
      {/* Dynamic Header with Stepper & Logo */}
      <Header
        currentStep={currentStep}
        onStepChange={(step) => {
          if (step === 2 && !draftProject) {
            handleCreateNewProject();
          } else {
            navigateToStep(step);
          }
        }}
        pjtCode={currentProject?.pjtCode}
        equipmentName={currentProject?.equipmentName}
      />

      {/* Main Workspace View */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
        {/* Step 1: PJT List (프로젝트 목록 관리) */}
        {currentStep === 1 && (
          <PjtListStep
            projects={projects}
            currentProjectId={currentProjectId}
            onSelectProject={handleSelectProject}
            onCreateNewProject={handleCreateNewProject}
            onDuplicateProject={handleDuplicateProject}
            onDeleteProject={handleDeleteProject}
            onUpdateProject={(updated) => {
              const next = projects.map((p) => (p.id === updated.id ? updated : p));
              setProjects(next);
              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
              } catch {}
              pushProjectsToCloud(next).catch(console.warn);
            }}
          />
        )}

        {/* Step 2: 프로젝트 추가 (신규 PJT 생성 후 1단계 PJT List로 이동) */}
        {currentStep === 2 && (
          <ProjectMasterStep
            project={draftProject || currentProject || INITIAL_PROJECT_LIST[0]}
            onUpdate={(updater) => {
              if (draftProject) {
                setDraftProject(updater(draftProject));
              } else {
                updateCurrentProject(updater);
              }
            }}
            onNext={() => {
              const pjtToSave = draftProject || currentProject;
              if (pjtToSave) {
                handleSaveDraftProject(pjtToSave);
              } else {
                navigateToStep(1);
              }
            }}
            onBackToPjtList={() => {
              setDraftProject(null);
              navigateToStep(1);
            }}
          />
        )}

        {/* Step 3: 설비 OCR 및 부품 Serial 검증 (Equipment Units & Parts) */}
        {currentStep === 3 && (
          <EquipmentUnitStep
            project={currentProject}
            onUpdate={updateCurrentProject}
            onPrev={() => navigateToStep(2)}
            onBackToPjtList={() => navigateToStep(1)}
          />
        )}

        {/* Step 4: 설비 부품 양식 (BOM Template Management) */}
        {currentStep === 4 && <TemplateManagerStep />}
      </main>

      {/* Mobile Floating Bottom Navigation Dock */}
      <nav className="fixed bottom-0 inset-x-0 z-40 md:hidden bg-slate-950/95 backdrop-blur-lg border-t border-slate-800 py-1.5 px-3 shadow-2xl safe-bottom">
        <div className="grid grid-cols-4 gap-1">
          {[
            { num: 1, label: "PJT 목록", icon: FolderKanban },
            { num: 2, label: "PJT 입력", icon: FileEdit },
            { num: 3, label: "설비 OCR", icon: Camera },
            { num: 4, label: "부품 양식", icon: Layers },
          ].map((item) => {
            const isActive = currentStep === item.num;
            const Icon = item.icon;

            return (
              <button
                key={item.num}
                type="button"
                onClick={() => {
                  if (item.num === 2 && !draftProject) {
                    handleCreateNewProject();
                  } else {
                    navigateToStep(item.num);
                  }
                }}
                className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-xl transition-all cursor-pointer ${
                  isActive
                    ? "bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${
                    isActive ? "text-cyan-400 scale-110" : "text-slate-400"
                  }`}
                />
                <span className="text-[10px] mt-1 font-medium">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Industrial Footer */}
      <footer className="mt-auto border-t border-slate-800 bg-slate-950/90 py-6 text-xs text-slate-500 hidden md:block">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-slate-400 font-mono">
              <Cpu className="h-4 w-4 text-cyan-400" />
              <span>Part Serial Number List Suite</span>
            </div>
            <span>•</span>
            <div className="flex items-center gap-1 text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Storage-Zero Compliant (In-Memory Canvas OCR)</span>
            </div>
          </div>

          <div className="text-center sm:text-right text-[11px] text-slate-400">
            반도체 공정 설비 제작완료 보고서 자동화 솔루션 • Pure Text Lightweight Excel Engine
          </div>
        </div>
      </footer>
    </div>
  );
}
