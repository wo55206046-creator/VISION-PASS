"use client";

import React from "react";
import { Cpu, ShieldCheck, Zap } from "lucide-react";

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
          {/* Logo & Title */}
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-400 via-cyan-500 to-blue-600 shadow-glow-cyan shrink-0">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 sm:h-5 sm:w-5 text-slate-950"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="14.31" y1="8" x2="20.05" y2="17.94" />
                <line x1="9.69" y1="8" x2="21.17" y2="8" />
                <line x1="7.38" y1="12" x2="13.12" y2="2.06" />
                <line x1="9.69" y1="16" x2="3.95" y2="6.06" />
                <line x1="14.31" y1="16" x2="2.83" y2="16" />
                <line x1="16.62" y1="12" x2="10.88" y2="21.94" />
              </svg>
              <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-slate-950 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-sm sm:text-base font-extrabold tracking-wider text-white">
                  Serial <span className="text-cyan-400">Report</span>
                </span>
                <span className="rounded bg-cyan-950/80 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-cyan-300 border border-cyan-800/50">
                  OCR Pro
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                WITHTECH 제작 설비 Serial 리스트 & 인메모리 OCR 시스템
              </p>
            </div>
          </div>

          {/* Desktop Stepper Navigation */}
          <nav className="hidden md:flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800">
            {steps.map((step) => {
              const isActive = currentStep === step.num;
              const isPast = currentStep > step.num;

              return (
                <button
                  key={step.num}
                  type="button"
                  onClick={() => onStepChange(step.num)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    isActive
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm font-bold"
                      : isPast
                      ? "text-emerald-400 hover:bg-slate-800"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                      isActive
                        ? "bg-cyan-400 text-slate-950"
                        : isPast
                        ? "bg-emerald-500 text-slate-950"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {isPast ? "✓" : step.num}
                  </span>
                  <span>{step.label}</span>
                </button>
              );
            })}
          </nav>

          {/* System Badges & Zero-Storage Indicator */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-lg bg-emerald-950/50 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium text-emerald-400 border border-emerald-800/50">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Storage-Zero (인메모리)</span>
              <span className="sm:hidden">Storage 0</span>
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

        {/* Mobile Horizontal Step Scroll Bar (스마트폰 상단 스와이프 내비게이션) */}
        <div className="flex md:hidden items-center gap-1.5 overflow-x-auto no-scrollbar py-2 border-t border-slate-800/80 -mx-3 px-3 bg-slate-950/90">
          {steps.map((step) => {
            const isActive = currentStep === step.num;
            const isPast = currentStep > step.num;

            return (
              <button
                key={step.num}
                type="button"
                onClick={() => onStepChange(step.num)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                  isActive
                    ? "bg-cyan-500 text-slate-950 font-bold shadow-glow-cyan scale-102"
                    : isPast
                    ? "bg-slate-900 text-emerald-400 border border-emerald-800/60"
                    : "bg-slate-900/80 text-slate-400 border border-slate-800"
                }`}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                    isActive
                      ? "bg-slate-950 text-cyan-300"
                      : isPast
                      ? "bg-emerald-500 text-slate-950"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {isPast ? "✓" : step.num}
                </span>
                <span>{step.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
