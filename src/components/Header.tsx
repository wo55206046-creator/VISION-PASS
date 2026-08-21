"use client";

import React from "react";
import { ShieldCheck, Zap } from "lucide-react";
import { WithtechLogo } from "./WithtechLogo";

interface HeaderProps {
  currentStep: number;
  onStepChange: (step: number) => void;
  pjtCode?: string;
  equipmentName?: string;
}

export const Header: React.FC<HeaderProps> = ({
  currentStep,
  onStepChange,
  pjtCode,
  equipmentName,
}) => {
  const steps = [
    { num: 1, label: "1. PJT List" },
    { num: 2, label: "2. PJT 입력" },
    { num: 3, label: "3. 설비 OCR" },
    { num: 4, label: "4. 설비 부품 양식" },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
        {/* Main Header Bar */}
        <div className="flex h-14 sm:h-16 items-center justify-between gap-3">
          {/* WITHTECH Official Logo */}
          <div
            onClick={() => onStepChange(1)}
            className="flex items-center gap-2 cursor-pointer select-none transition-opacity hover:opacity-90 active:scale-98 shrink-0"
            title="WITHTECH - PJT List 첫 화면으로 이동"
          >
            <WithtechLogo className="h-6 sm:h-7 w-auto" />
          </div>

          {/* Desktop Stepper Navigation (PC/태블릿: 녹색 체크 없이 현재 선택된 단계만 강조) */}
          <nav className="hidden md:flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800">
            {steps.map((step) => {
              const isActive = currentStep === step.num;

              return (
                <button
                  key={step.num}
                  type="button"
                  onClick={() => onStepChange(step.num)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    isActive
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm font-bold"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                      isActive
                        ? "bg-cyan-400 text-slate-950"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {step.num}
                  </span>
                  <span>{step.label}</span>
                </button>
              );
            })}
          </nav>

          {/* System Badges & Zero-Storage Indicator */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 rounded-lg bg-emerald-950/50 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium text-emerald-400 border border-emerald-800/50">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Storage-Zero (인메모리)</span>
            </div>

            {pjtCode && (
              <div className="hidden lg:flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-mono text-cyan-300 border border-slate-800">
                <Zap className="h-3 w-3 text-cyan-400" />
                <span>{pjtCode}</span>
                {equipmentName && (
                  <span className="text-slate-400 truncate max-w-[120px]">
                    / {equipmentName}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
