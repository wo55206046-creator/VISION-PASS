"use client";

import React, { useState, useEffect } from "react";
import { ProjectMaster } from "@/types";
import { INITIAL_PROJECT_LIST, createBlankProject } from "@/lib/default-presets";
import { Header } from "@/components/Header";
import { PjtListStep } from "@/components/PjtListStep";
import { ProjectMasterStep } from "@/components/ProjectMasterStep";
import { EquipmentUnitStep } from "@/components/EquipmentUnitStep";
import { TemplateManagerStep } from "@/components/TemplateManagerStep";
import { ShieldCheck, Cpu } from "lucide-react";

const STORAGE_KEY = "VISION_PASS_PROJECTS_DATA_V6";

function loadSavedProjects(): ProjectMaster[] {
  if (typeof window === "undefined") return INITIAL_PROJECT_LIST;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const isUpToDate = parsed.some((p: ProjectMaster) => p.inspectorName && p.inspectorName.includes("김형태, 유병준"));
      if (isUpToDate && Array.isArray(parsed) && parsed.length > 0) {
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
  const [currentProjectId, setCurrentProjectId] = useState<string>(() => INITIAL_PROJECT_LIST[0]?.id || "pjt-001");
  const [draftProject, setDraftProject] = useState<ProjectMaster | null>(null);

  // 클라이언트 마운트 시 localStorage에서 복원
  useEffect(() => {
    const saved = loadSavedProjects();
    if (saved && saved.length > 0) {
      setProjects(saved);
      setCurrentProjectId(saved[0].id || "pjt-001");
    }
  }, []);

  // projects 변경 시 localStorage 자동 실시간 저장
  useEffect(() => {
    try {
      if (projects && projects.length > 0) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
      }
    } catch (e) {
      console.warn("Failed to save projects to localStorage", e);
    }
  }, [projects]);

  const currentProject = projects.find((p) => p.id === currentProjectId) || projects[0];

  const updateCurrentProject = (updater: (prev: ProjectMaster) => ProjectMaster) => {
    setProjects((prevProjects) =>
      prevProjects.map((p) => {
        if (p.id === currentProjectId) {
          const updated = updater(p);
          return { ...updated, updatedAt: new Date().toISOString() };
        }
        return p;
      })
    );
  };

  const handleCreateNewProject = () => {
    const newPjt = createBlankProject();
    setDraftProject(newPjt);
    setCurrentStep(2); // 2. PJT 입력 단계로 이동 (아직 목록에 등록되지 않음)
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
    if (projects.length <= 1) {
      alert("최소 1개 이상의 프로젝트가 유지되어야 합니다.");
      return;
    }
    if (confirm("해당 프로젝트를 목록에서 삭제하시겠습니까?")) {
      const remaining = projects.filter((p) => p.id !== projectId);
      setProjects(remaining);
      if (currentProjectId === projectId) {
        setCurrentProjectId(remaining[0].id || "");
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500 selection:text-slate-950">
      {/* Global Cleanroom Top Navigation */}
      <Header
        currentStep={currentStep}
        onStepChange={(step) => setCurrentStep(step)}
        pjtCode={currentProject?.pjtCode}
        equipmentName={currentProject?.equipmentName}
      />

      {/* Main Container */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Step 1: PJT List (프로젝트 목록 전체 조회 & 선택) */}
        {currentStep === 1 && (
          <PjtListStep
            projects={projects}
            currentProjectId={currentProjectId}
            onSelectProject={handleSelectProject}
            onCreateNewProject={handleCreateNewProject}
            onUpdateProject={(updatedPjt) => {
              setProjects((prev) =>
                prev.map((p) => (p.id === updatedPjt.id ? { ...updatedPjt, updatedAt: new Date().toISOString() } : p))
              );
            }}
            onDuplicateProject={handleDuplicateProject}
            onDeleteProject={handleDeleteProject}
          />
        )}

        {/* Step 2: PJT 입력 (프로젝트 마스터 정보 작성 및 수정) */}
        {currentStep === 2 && (
          <ProjectMasterStep
            project={draftProject || currentProject}
            onUpdate={(updater) => {
              if (draftProject) {
                setDraftProject((prev) => (prev ? updater(prev) : null));
              } else {
                updateCurrentProject(updater);
              }
            }}
            onBackToPjtList={() => {
              setDraftProject(null);
              setCurrentStep(1);
            }}
            onNext={() => {
              if (draftProject) {
                const finalPjt = {
                  ...draftProject,
                  quantity: draftProject.equipmentUnits.length,
                  updatedAt: new Date().toISOString(),
                };
                setProjects((prev) => [finalPjt, ...prev]);
                setCurrentProjectId(finalPjt.id || "");
                setDraftProject(null);
              }
              setCurrentStep(3);
            }}
          />
        )}

        {/* Step 3: 호기/부품 OCR 검사 및 엑셀 다운로드 */}
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

      {/* Industrial Footer */}
      <footer className="mt-auto border-t border-slate-800 bg-slate-950/90 py-6 text-xs text-slate-500">
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
