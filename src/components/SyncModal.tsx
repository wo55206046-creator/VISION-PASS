"use client";

import React, { useState } from "react";
import { ProjectMaster } from "@/types";
import {
  getSyncRoomKey,
  setSyncRoomKey,
  pushProjectsToCloud,
  pullProjectsFromCloud,
  exportBackupFile,
  importBackupFile,
} from "@/lib/cloud-sync";
import {
  Cloud,
  CloudUpload,
  CloudDownload,
  KeyRound,
  Download,
  Upload,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  X,
  Smartphone,
  Laptop,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectMaster[];
  onUpdateProjects: (newProjects: ProjectMaster[]) => void;
  onResetDefault: () => void;
}

export const SyncModal: React.FC<SyncModalProps> = ({
  isOpen,
  onClose,
  projects,
  onUpdateProjects,
  onResetDefault,
}) => {
  const [activeTab, setActiveTab] = useState<"cloud" | "file" | "reset">("cloud");
  const [roomKey, setRoomKeyState] = useState<string>(() => getSyncRoomKey());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  if (!isOpen) return null;

  const handleSaveRoomKey = () => {
    setSyncRoomKey(roomKey);
    setStatusMsg({
      type: "info",
      text: `동기화 키가 [${roomKey.toUpperCase()}] 로 설정되었습니다.`,
    });
  };

  const handleCloudPush = async () => {
    setIsSyncing(true);
    setStatusMsg(null);
    const key = roomKey.trim().toUpperCase() || "WITHTECH-VISIONPASS-2026";
    setSyncRoomKey(key);

    const res = await pushProjectsToCloud(projects, key);
    setIsSyncing(false);

    if (res.success) {
      setStatusMsg({
        type: "success",
        text: `클라우드 동기화 완료! (${projects.length}개 프로젝트 저장됨)`,
      });
    } else {
      setStatusMsg({
        type: "error",
        text: `동기화 실패: ${res.message || "네트워크 연결을 확인해주세요."}`,
      });
    }
  };

  const handleCloudPull = async () => {
    setIsSyncing(true);
    setStatusMsg(null);
    const key = roomKey.trim().toUpperCase() || "WITHTECH-VISIONPASS-2026";
    setSyncRoomKey(key);

    const res = await pullProjectsFromCloud(key);
    setIsSyncing(false);

    if (res.success && res.projects) {
      onUpdateProjects(res.projects);
      setStatusMsg({
        type: "success",
        text: `클라우드에서 ${res.projects.length}개 프로젝트를 성공적으로 불러왔습니다!`,
      });
    } else {
      setStatusMsg({
        type: "error",
        text: `불러오기 실패: ${res.message || "데이터를 찾을 수 없습니다."}`,
      });
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatusMsg(null);
    const res = await importBackupFile(file);
    if (res.success && res.projects) {
      onUpdateProjects(res.projects);
      setStatusMsg({
        type: "success",
        text: `백업 파일에서 ${res.projects.length}개 프로젝트를 정상 복원했습니다!`,
      });
    } else {
      setStatusMsg({
        type: "error",
        text: res.message || "파일 복원 실패",
      });
    }
    e.target.value = "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base sm:text-lg">
                기기 간 실시간 데이터 동기화
              </h3>
              <p className="text-xs text-slate-400">
                PC ↔ 스마트폰 간 프로젝트 및 시리얼 데이터 실시간 공유
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-all cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-4 pt-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab("cloud");
              setStatusMsg(null);
            }}
            className={`pb-2 px-3 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "cloud"
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Cloud className="h-3.5 w-3.5" />
            <span>클라우드 동기화 (권장)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("file");
              setStatusMsg(null);
            }}
            className={`pb-2 px-3 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "file"
                ? "border-cyan-400 text-cyan-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Download className="h-3.5 w-3.5" />
            <span>파일 백업/복원</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab("reset");
              setStatusMsg(null);
            }}
            className={`pb-2 px-3 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "reset"
                ? "border-red-400 text-red-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>초기화</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {statusMsg && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 animate-fadeIn ${
                statusMsg.type === "success"
                  ? "bg-emerald-950/70 border-emerald-800 text-emerald-300"
                  : statusMsg.type === "error"
                  ? "bg-red-950/70 border-red-800 text-red-300"
                  : "bg-cyan-950/70 border-cyan-800 text-cyan-300"
              }`}
            >
              {statusMsg.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : statusMsg.type === "error" ? (
                <AlertCircle className="h-4 w-4 shrink-0" />
              ) : (
                <ShieldCheck className="h-4 w-4 shrink-0" />
              )}
              <span>{statusMsg.text}</span>
            </div>
          )}

          {/* TAB 1: 클라우드 실시간 동기화 */}
          {activeTab === "cloud" && (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-950 p-3.5 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <KeyRound className="h-4 w-4 text-cyan-400" />
                    <span>팀/회사 동기화 키 (Sync Room Key)</span>
                  </label>
                  <span className="text-[10px] text-cyan-400 font-mono">동일한 키로 접속 시 자동 공유</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={roomKey}
                    onChange={(e) => setRoomKeyState(e.target.value.toUpperCase())}
                    placeholder="예: WITHTECH-VISIONPASS-2026"
                    className="flex-1 rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-xs font-mono font-bold text-cyan-300 uppercase tracking-wider focus:border-cyan-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSaveRoomKey}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition-all cursor-pointer"
                  >
                    키 저장
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  💡 <strong>PC와 스마트폰에서 동일한 동기화 키를 입력</strong>하시면, 언제 어디서나 서로 수정한 최신 프로젝트 목록과 검증 결과가 100% 실시간 공유됩니다.
                </p>
              </div>

              {/* PC ➔ 모바일 연결 안내 다이어그램 */}
              <div className="rounded-xl bg-gradient-to-r from-cyan-950/30 to-blue-950/30 border border-cyan-900/50 p-3 flex items-center justify-between text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <Laptop className="h-4 w-4 text-cyan-400" />
                  <span>PC 브라우저</span>
                </div>
                <div className="flex items-center gap-1 text-cyan-400 font-mono text-[11px]">
                  <ArrowRight className="h-3.5 w-3.5" />
                  <span>실시간 동기화</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </div>
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-cyan-400" />
                  <span>스마트폰 카메라</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={handleCloudPush}
                  className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 p-3.5 text-xs font-bold text-slate-950 shadow-glow-cyan hover:opacity-95 disabled:opacity-50 transition-all cursor-pointer flex flex-col items-center justify-center gap-1.5"
                >
                  <CloudUpload className="h-5 w-5" />
                  <span>현재 데이터 클라우드에 올리기</span>
                  <span className="text-[10px] font-normal text-slate-900/80">(PC 수정 내용 업로드)</span>
                </button>

                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={handleCloudPull}
                  className="rounded-xl bg-slate-800 hover:bg-slate-750 border border-cyan-500/40 p-3.5 text-xs font-bold text-cyan-300 hover:text-cyan-200 disabled:opacity-50 transition-all cursor-pointer flex flex-col items-center justify-center gap-1.5 shadow-sm"
                >
                  <CloudDownload className="h-5 w-5 text-cyan-400" />
                  <span>클라우드 최신 데이터 내려받기</span>
                  <span className="text-[10px] font-normal text-slate-400">(스마트폰에서 최신 반영)</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: 파일 백업 및 복원 */}
          {activeTab === "file" && (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-950 p-4 border border-slate-800 space-y-3">
                <div>
                  <h4 className="text-xs font-bold text-slate-200">
                    프로젝트 전체 데이터 백업 및 복원
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    인터넷 연결이 없는 폐쇄망에서도 .json 파일로 프로젝트를 안전하게 보관하고 복구할 수 있습니다.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => exportBackupFile(projects)}
                    className="p-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-emerald-300 border border-emerald-700/50 flex items-center justify-center gap-2 cursor-pointer transition-all shadow-sm"
                  >
                    <Download className="h-4 w-4" />
                    <span>백업 파일 (.json) 다운로드</span>
                  </button>

                  <label className="p-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-cyan-300 border border-cyan-700/50 flex items-center justify-center gap-2 cursor-pointer transition-all shadow-sm text-center">
                    <Upload className="h-4 w-4" />
                    <span>백업 파일 불러오기</span>
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleFileInputChange}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: 기본 데이터 초기화 */}
          {activeTab === "reset" && (
            <div className="rounded-xl bg-red-950/40 p-4 border border-red-900/60 space-y-3">
              <div>
                <h4 className="text-xs font-bold text-red-300">
                  데이터 전체 초기화
                </h4>
                <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                  로컬에 저장된 프로젝트를 지우고, 기본 제공되는 표준 5개 반도체 설비 프로젝트(SKH 이천, 우시, SEC 평택 등)로 초기 복원합니다.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (confirm("정말 기본 제공 5개 프로젝트로 초기화하시겠습니까?")) {
                    onResetDefault();
                    setStatusMsg({
                      type: "info",
                      text: "기본 5개 프로젝트로 초기화되었습니다.",
                    });
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-red-900 hover:bg-red-800 text-xs font-bold text-white transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                <span>기본 데이터로 전체 리셋</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <span className="text-[11px] text-slate-500 font-mono">
            현재 로컬 보관: {projects.length}개 프로젝트
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 transition-all cursor-pointer"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
