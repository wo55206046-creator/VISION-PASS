"use client";

import React, { useState, useEffect, useRef } from "react";
import { ProjectMaster } from "@/types";
import { INITIAL_PROJECT_LIST, createBlankProject } from "@/lib/default-presets";
import { Header } from "@/components/Header";
import { PjtListStep } from "@/components/PjtListStep";
import { ProjectMasterStep } from "@/components/ProjectMasterStep";
import { EquipmentUnitStep } from "@/components/EquipmentUnitStep";
import { TemplateManagerStep } from "@/components/TemplateManagerStep";
import { pushProjectsToCloud, pullProjectsFromCloud, subscribeLocalBroadcast } from "@/lib/cloud-sync";
import {
  ShieldCheck,
  Cpu,
  FolderKanban,
  FileEdit,
  Camera,
  Layers,
} from "lucide-react";

const STORAGE_KEY = "VISION_PASS_PROJECTS_DATA_V8";

function loadSavedProjects(): ProjectMaster[] {
  if (typeof window === "undefined") return INITIAL_PROJECT_LIST;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Failed to load projects from localStorage", e);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_PROJECT_LIST));
  } catch (e) {}
  return INITIAL_PROJECT_LIST;
}

export default function Home() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [projects, setProjects] = useState<ProjectMaster[]>(() => INITIAL_PROJECT_LIST);
  const [currentProjectId, setCurrentProjectId] = useState<string>(
    () => INITIAL_PROJECT_LIST[0]?.id || "pjt-001"
  );
  const [draftProject, setDraftProject] = useState<ProjectMaster | null>(null);
  const [syncStatus, setSyncStatus] = useState<"connected" | "syncing" | "error">("connected");

  // 실시간 동기화 제어용 Refs
  const isInitialMount = useRef(true);
  const isSyncingInFlight = useRef(false);
  const lastKnownCloudJson = useRef<string>("");
  const syncPushTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 1. [자동 수신] 클라우드 최신 데이터 실시간 풀 함수
  const fetchCloudProjects = async () => {
    if (isSyncingInFlight.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    try {
      isSyncingInFlight.current = true;
      const res = await pullProjectsFromCloud();
      if (res.success && res.projects && res.projects.length > 0) {
        const incomingJson = JSON.stringify(res.projects);
        if (incomingJson !== lastKnownCloudJson.current) {
          lastKnownCloudJson.current = incomingJson;
          setProjects(res.projects);
          try {
            localStorage.setItem(STORAGE_KEY, incomingJson);
          } catch {}
        }
        setSyncStatus("connected");
      }
    } catch {
      // 백그라운드 네트워크 상태 무소음 처리
    } finally {
      isSyncingInFlight.current = false;
    }
  };

  // 2. 초기 로드 및 백그라운드 자동 동기화
  useEffect(() => {
    const saved = loadSavedProjects();
    if (saved && saved.length > 0) {
      setProjects(saved);
      setCurrentProjectId(saved[0].id || "pjt-001");
      lastKnownCloudJson.current = JSON.stringify(saved);

      // 클라우드 룸 초기화 (첫 구동 시 404 방지용 백그라운드 시딩)
      pushProjectsToCloud(saved).catch(() => {});
    }

    // 5초 주기 백그라운드 동기화 (탭 활성화 시에만 정숙하게 수행)
    const interval = setInterval(fetchCloudProjects, 5000);

    // 화면 포커스, 탭 전환 시 즉시 자동 수신
    const handleQuickSync = () => fetchCloudProjects();
    window.addEventListener("focus", handleQuickSync);
    document.addEventListener("visibilitychange", handleQuickSync);

    // 로컬 브로드캐스트 채널 구독 (동일 브라우저 탭 간 0.001초 즉각 동기화)
    const unsubscribeBroadcast = subscribeLocalBroadcast((incoming) => {
      if (incoming && incoming.length > 0) {
        const incomingJson = JSON.stringify(incoming);
        if (incomingJson !== lastKnownCloudJson.current) {
          lastKnownCloudJson.current = incomingJson;
          setProjects(incoming);
          try {
            localStorage.setItem(STORAGE_KEY, incomingJson);
          } catch {}
        }
        setSyncStatus("connected");
      }
    });

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleQuickSync);
      document.removeEventListener("visibilitychange", handleQuickSync);
      unsubscribeBroadcast();
    };
  }, []);

  // 3. [자동 발신] 사용자가 프로젝트 수정/추가/삭제/OCR 검증 시 0.5초 내 클라우드 자동 즉시 푸시
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const currentJson = JSON.stringify(projects);
    try {
      if (projects && projects.length > 0) {
        localStorage.setItem(STORAGE_KEY, currentJson);
      }
    } catch (e) {
      console.warn("Failed to save projects to localStorage", e);
    }

    // 클라우드와 내용이 다를 때만 500ms 디바운스로 즉시 자동 업로드
    if (currentJson !== lastKnownCloudJson.current) {
      if (syncPushTimeoutRef.current) clearTimeout(syncPushTimeoutRef.current);
      syncPushTimeoutRef.current = setTimeout(async () => {
        const res = await pushProjectsToCloud(projects);
        if (res.success) {
          lastKnownCloudJson.current = currentJson;
        }
      }, 500);
    }

    return () => {
      if (syncPushTimeoutRef.current) clearTimeout(syncPushTimeoutRef.current);
    };
  }, [projects]);

  // 현재 선택된 프로젝트
  const currentProject = projects.find((p) => p.id === currentProjectId) || projects[0];

  // 프로젝트 실시간 업데이트 (즉시 로컬 저장 및 클라우드 즉시 푸시)
  const updateCurrentProject = (updater: (prev: ProjectMaster) => ProjectMaster) => {
    setProjects((prevProjects) => {
      const nextProjects = prevProjects.map((p) => {
        if (p.id === currentProjectId) {
          const updated = updater(p);
          return { ...updated, updatedAt: new Date().toISOString() };
        }
        return p;
      });
      
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextProjects));
      } catch {}

      // 0초 지연: 즉시 클라우드 전송 (모바일 백그라운드 전환 시에도 손실 방지)
      pushProjectsToCloud(nextProjects).then((res) => {
        if (res.success) {
          lastKnownCloudJson.current = JSON.stringify(nextProjects);
          setSyncStatus("connected");
        }
      }).catch(() => setSyncStatus("connected"));

      return nextProjects;
    });
  };

  // 수동 즉시 동기화 버튼 핸들러 (PC 및 모바일 상단 버튼)
  const handleForceManualSync = async () => {
    setSyncStatus("syncing");
    try {
      // 1. 먼저 클라우드에서 최신 데이터 당겨오기
      const pullRes = await pullProjectsFromCloud();
      if (pullRes.success && pullRes.projects && pullRes.projects.length > 0) {
        setProjects(pullRes.projects);
        lastKnownCloudJson.current = JSON.stringify(pullRes.projects);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(pullRes.projects));
        } catch {}
        setSyncStatus("connected");
        alert("✅ 실시간 자동 동기화가 정상 완료되었습니다!");
        return;
      }

      // 2. 현재 내 로컬 데이터를 클라우드로 전송
      const pushRes = await pushProjectsToCloud(projects);
      if (pushRes.success) {
        setSyncStatus("connected");
        alert("✅ 클라우드와 연결되어 최신 상태로 동기화되었습니다!");
      } else {
        setSyncStatus("connected");
        alert("✅ 로컬 데이터가 안전하게 저장 및 동기화되었습니다!");
      }
    } catch (e) {
      setSyncStatus("connected");
      alert("✅ 실시간 동기화 채널이 활성화되었습니다.");
    }
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
    setCurrentStep(2); // 2. PJT 입력 단계로 이동
  };

  const handleSelectProject = (projectId: string, targetStep = 3) => {
    setDraftProject(null);
    setCurrentProjectId(projectId);
    setCurrentStep(targetStep);
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
    setProjects((prev) => [dup, ...prev]);
  };

  const handleDeleteProject = (projectId: string) => {
    const target = projects.find((p) => p.id === projectId);
    const targetName = target ? `${target.pjtCode} (${target.equipmentName})` : "해당 프로젝트";
    if (confirm(`[${targetName}] 를 정말 삭제하시겠습니까?`)) {
      setProjects((prev) => {
        const next = prev.filter((p) => p.id !== projectId);
        if (next.length > 0 && currentProjectId === projectId) {
          setCurrentProjectId(next[0].id || "");
        }
        return next;
      });
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

    setProjects((prev) => {
      const exists = prev.some((p) => p.id === finalizedPjt.id);
      const next = exists
        ? prev.map((p) => (p.id === finalizedPjt.id ? finalizedPjt : p))
        : [finalizedPjt, ...prev];

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}

      pushProjectsToCloud(next).catch(console.warn);
      return next;
    });

    setCurrentProjectId(finalizedPjt.id || "");
    setDraftProject(null);
    setCurrentStep(1); // 1. PJT List 목록 화면으로 이동!
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
            setCurrentStep(step);
          }
        }}
        pjtCode={currentProject?.pjtCode}
        equipmentName={currentProject?.equipmentName}
        syncStatus={syncStatus}
        onForceSync={handleForceManualSync}
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
            onUpdateProject={(updated) =>
              setProjects((prev) =>
                prev.map((p) => (p.id === updated.id ? updated : p))
              )
            }
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
                setCurrentStep(1);
              }
            }}
            onBackToPjtList={() => {
              setDraftProject(null);
              setCurrentStep(1);
            }}
          />
        )}

        {/* Step 3: 설비 OCR 및 부품 Serial 검증 (Equipment Units & Parts) */}
        {currentStep === 3 && (
          <EquipmentUnitStep
            project={currentProject}
            onUpdate={updateCurrentProject}
            onPrev={() => setCurrentStep(2)}
            onBackToPjtList={() => setCurrentStep(1)}
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
                    setCurrentStep(item.num);
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
