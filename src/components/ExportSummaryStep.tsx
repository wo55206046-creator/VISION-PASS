"use client";

import React, { useState } from "react";
import { ProjectMaster } from "@/types";
import { exportEquipmentReportExcel } from "@/lib/excel-export";
import {
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  ShieldCheck,
  Download,
  Building2,
  Cpu,
  Layers,
  Sparkles,
  RefreshCw,
  Eye,
  Check,
} from "lucide-react";

interface ExportSummaryStepProps {
  project: ProjectMaster;
  onPrev: () => void;
  onJumpToUnit: (unitIndex: number) => void;
}

export const ExportSummaryStep: React.FC<ExportSummaryStepProps> = ({
  project,
  onPrev,
  onJumpToUnit,
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  // 통계 계산
  let totalParts = 0;
  let filledSerials = 0;
  let verifiedParts = 0;
  const unverifiedList: { unitIndex: number; partName: string; reason: string }[] = [];

  project.equipmentUnits.forEach((u) => {
    u.parts.forEach((p) => {
      totalParts++;
      if (p.detectedSerial && p.detectedSerial.trim().length > 0) {
        filledSerials++;
      } else {
        unverifiedList.push({
          unitIndex: u.unitIndex,
          partName: p.partName,
          reason: "시리얼 번호 미인식/미입력",
        });
      }

      if (p.isVerified) {
        verifiedParts++;
      } else if (p.detectedSerial && p.detectedSerial.trim().length > 0) {
        unverifiedList.push({
          unitIndex: u.unitIndex,
          partName: p.partName,
          reason: "시리얼 인식됨 (작업자 검증 미체크)",
        });
      }
    });
  });

  const detectionRate = totalParts > 0 ? Math.round((filledSerials / totalParts) * 100) : 0;
  const verificationRate = totalParts > 0 ? Math.round((verifiedParts / totalParts) * 100) : 0;
  const isAllReady = totalParts > 0 && verifiedParts === totalParts;

  // 엑셀 다운로드 실행
  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      await exportEquipmentReportExcel(project);
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 5000);
    } catch (err) {
      console.error("Excel export error:", err);
      alert("엑셀 생성 중 오류가 발생했습니다.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Top Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 via-cleanroom-850 to-slate-900 p-6 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400 font-mono font-bold text-xs border border-cyan-500/30">
                03
              </span>
              <h2 className="text-xl font-bold text-white tracking-wide">
                제작완료 검증 요약 & 엑셀 리포트 추출
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              최종 검사 데이터를 확인하고 초경량 텍스트 기반 엑셀 보고서(.xlsx)를 생성합니다.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-xl bg-emerald-950/70 px-3 py-1.5 text-xs font-semibold text-emerald-400 border border-emerald-800">
              <ShieldCheck className="h-4 w-4" />
              <span>Storage-Zero 초경량 보증</span>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-slate-900/90 p-5 border border-slate-800 shadow-lg">
          <span className="text-xs font-medium text-slate-400">총 설비 수량</span>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-extrabold font-mono text-white">
              {project.quantity}
            </span>
            <span className="text-xs text-slate-400">대 (Units)</span>
          </div>
          <span className="text-[11px] text-cyan-400 font-mono mt-1 block">
            {project.equipmentUnits.map((u) => `${u.unitIndex}호기`).join(", ")}
          </span>
        </div>

        <div className="rounded-2xl bg-slate-900/90 p-5 border border-slate-800 shadow-lg">
          <span className="text-xs font-medium text-slate-400">총 검사 부품 수</span>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-extrabold font-mono text-cyan-400">
              {totalParts}
            </span>
            <span className="text-xs text-slate-400">개 항목</span>
          </div>
          <span className="text-[11px] text-slate-500 mt-1 block">
            호기당 평균 {Math.round(totalParts / (project.quantity || 1))}개 부품
          </span>
        </div>

        <div className="rounded-2xl bg-slate-900/90 p-5 border border-slate-800 shadow-lg">
          <span className="text-xs font-medium text-slate-400">시리얼 인식/입력률</span>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-extrabold font-mono text-cyan-300">
              {detectionRate}%
            </span>
            <span className="text-xs text-slate-400 font-mono">
              ({filledSerials}/{totalParts})
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-cyan-400"
              style={{ width: `${detectionRate}%` }}
            />
          </div>
        </div>

        <div className="rounded-2xl bg-slate-900/90 p-5 border border-slate-800 shadow-lg">
          <span className="text-xs font-medium text-slate-400">작업자 최종 검증률</span>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-2xl font-extrabold font-mono text-emerald-400">
              {verificationRate}%
            </span>
            <span className="text-xs text-slate-400 font-mono">
              ({verifiedParts}/{totalParts})
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${verificationRate}%` }}
            />
          </div>
        </div>
      </div>

      {/* Warning Checklist (if any unverified parts exist) */}
      {!isAllReady && unverifiedList.length > 0 && (
        <div className="rounded-2xl bg-amber-950/30 p-5 border border-amber-800/60 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
            <h4 className="text-sm font-bold text-amber-200">
              검증 보완이 필요한 항목 ({unverifiedList.length}건)
            </h4>
          </div>
          <p className="text-xs text-amber-300/80">
            일부 부품의 시리얼이 미입력되었거나 작업자 검증이 체크되지 않았습니다. 보고서
            추출은 가능하나 현장 확인을 권장합니다.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {unverifiedList.slice(0, 6).map((item, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs"
              >
                <div className="truncate">
                  <span className="font-bold text-cyan-400 font-mono mr-2">
                    {item.unitIndex}호기
                  </span>
                  <span className="text-slate-200">{item.partName}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onJumpToUnit(item.unitIndex)}
                  className="rounded bg-slate-800 px-2 py-1 text-[10px] font-semibold text-cyan-300 hover:bg-slate-700 shrink-0 ml-2"
                >
                  확인하기
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 100% Verification Success Badge */}
      {isAllReady && (
        <div className="rounded-2xl bg-emerald-950/40 p-5 border border-emerald-700/60 flex items-center gap-4 shadow-glow-emerald">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500 text-slate-950 shrink-0">
            <CheckCircle2 className="h-7 w-7 stroke-[2.5]" />
          </div>
          <div>
            <h4 className="text-base font-bold text-emerald-300">
              모든 설비 호기 및 부품 시리얼 검증 완료 (100% PASS)
            </h4>
            <p className="text-xs text-emerald-400/90 mt-0.5">
              품질 규격 및 시리얼 식별 검사가 완료되었습니다. 엑셀 완료 보고서를 다운로드하세요.
            </p>
          </div>
        </div>
      )}

      {/* Export Action Card */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-cleanroom-850 p-6 sm:p-8 border border-slate-700 shadow-2xl text-center space-y-5">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 shadow-glow-cyan">
          <FileSpreadsheet className="h-8 w-8 text-slate-950 stroke-[2]" />
        </div>

        <div className="space-y-1 max-w-xl mx-auto">
          <h3 className="text-xl font-extrabold text-white">
            반도체 공정 설비 제작완료 보고서 생성
          </h3>
          <p className="text-xs text-slate-400">
            프로젝트 메타데이터, 호기별 시리얼, 부품 규격 및 검증 이력이 포함된 고품질 포맷의
            엑셀 파일(.xlsx)을 브라우저에서 즉시 생성하여 다운로드합니다.
          </p>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={isExporting}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 px-8 py-3.5 text-sm font-bold text-slate-950 shadow-glow-cyan hover:opacity-95 disabled:opacity-50 transition-all cursor-pointer"
          >
            {isExporting ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>엑셀 파일 생성 중...</span>
              </>
            ) : downloadSuccess ? (
              <>
                <Check className="h-4 w-4 stroke-[3]" />
                <span>다운로드 완료!</span>
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                <span>초경량 엑셀 보고서 다운로드 (.xlsx)</span>
              </>
            )}
          </button>
        </div>

        <p className="text-[11px] text-slate-500 font-mono">
          * 이미지 미포함 순수 텍스트 테이블 / 파일 크기: ~25KB / 스토리지 제로 준수
        </p>
      </div>

      {/* Navigation Step Bottom Bar */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-800">
        <button
          type="button"
          onClick={onPrev}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-5 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition-all border border-slate-700"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>이전 (호기/부품 검사로 돌아가기)</span>
        </button>
      </div>
    </div>
  );
};
