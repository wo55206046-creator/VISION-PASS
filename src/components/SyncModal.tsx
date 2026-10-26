"use client";

import React, { useState } from "react";
import { ProjectMaster } from "@/types";
import {
  getSyncRoomKey,
  setSyncRoomKey,
  pushProjectsToCloud,
  pullProjectsFromCloud,
  pingCentralDb,
} from "@/lib/cloud-sync";
import {
  Cloud,
  CloudUpload,
  CloudDownload,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  X,
  Smartphone,
  ShieldCheck,
  Copy,
  Check,
  Activity,
} from "lucide-react";

interface SyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectMaster[];
  onUpdateProjects: (newProjects: ProjectMaster[]) => void;
  onResetDefault?: () => void;
}

export const SyncModal: React.FC<SyncModalProps> = ({
  isOpen,
  onClose,
  projects,
  onUpdateProjects,
}) => {
  const [roomKey, setRoomKeyState] = useState<string>(() => getSyncRoomKey());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isTestingPing, setIsTestingPing] = useState<boolean>(false);
  const [pingResult, setPingResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  if (!isOpen) return null;

  const currentOrigin = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
  const shareUrl = `${currentOrigin}?room=${encodeURIComponent(roomKey.trim().toUpperCase() || "WITHTECH-VISIONPASS-2026")}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(shareUrl)}`;

  const handleTestConnection = async () => {
    setIsTestingPing(true);
    setPingResult(null);
    try {
      const res = await pingCentralDb();
      setPingResult({ ok: res.ok, message: res.message });
    } catch (e: any) {
      setPingResult({ ok: false, message: e.message || "연결 테스트 실패" });
    } finally {
      setIsTestingPing(false);
    }
  };

  const handleCopyLink = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setStatusMsg({
        type: "info",
        text: "모바일 접속용 동기화 링크가 클립보드에 복사되었습니다! (카톡/메신저로 공유 가능)",
      });
    }
  };

  const handleSaveRoomKey = () => {
    const cleanKey = roomKey.trim().toUpperCase() || "WITHTECH-VISIONPASS-2026";
    setSyncRoomKey(cleanKey);
    setStatusMsg({
      type: "info",
      text: `동기화 방 코드가 [${cleanKey}] 로 설정되었습니다.`,
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
        text: `클라우드 저장 완료! 총 ${projects.length}개 프로젝트가 [${key}] 방에 보관되었습니다.`,
      });
    } else {
      setStatusMsg({
        type: "error",
        text: `동기화 실패: ${res.message || "네트워크 상태를 확인해주세요."}`,
      });
    }
  };

  const handleCloudPull = async () => {
    setIsSyncing(true);
    setStatusMsg(null);
    const key = roomKey.trim().toUpperCase() || "WITHTECH-VISIONPASS-2026";
    setSyncRoomKey(key);

    const res = await pullProjectsFromCloud(key, true);
    setIsSyncing(false);

    if (res.success && res.projects && res.projects.length > 0) {
      onUpdateProjects(res.projects);
      try {
        const pJson = JSON.stringify(res.projects);
        localStorage.setItem("VISION_PASS_PROJECTS_DATA_V8", pJson);
        localStorage.setItem("VISION_PASS_PERMANENT_SERIALS_SNAPSHOT", pJson);
      } catch {}
      setStatusMsg({
        type: "success",
        text: `클라우드에서 최신 ${res.projects.length}개 프로젝트를 성공적으로 불러왔습니다!`,
      });
    } else {
      setStatusMsg({
        type: "error",
        text: `불러오기 실패: [${key}] 방에 저장된 데이터가 없습니다. PC에서 먼저 [클라우드에 올리기]를 눌러주세요.`,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-800 bg-slate-950/90">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-glow-cyan">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base sm:text-lg flex items-center gap-2">
                <span>PC ↔ 모바일 실시간 데이터 연동</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700">
                  LIVE
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                PC에서 입력한 설비 데이터를 스마트폰에서 실시간으로 공유하고 OCR 검증합니다
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

        {/* Body Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* ⚡ 완전 자동 동기화 안내 배너 */}
          <div className="p-3.5 rounded-xl bg-cyan-950/40 border border-cyan-500/40 text-xs text-cyan-200 flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <strong className="text-cyan-300 font-bold block">
                ⚡ 실시간 자동 동기화 가동 중 (Zero-Click)
              </strong>
              <p className="text-[11px] text-cyan-100/90 leading-relaxed">
                별도의 [저장]이나 [내려받기] 버튼을 누르지 않아도, 프로젝트 추가·수정·시리얼 입력 시 <strong>0.3초 내로 중앙 DB에 자동 저장</strong>되며, 다른 PC/모바일/Edge 브라우저로 <strong>2초 내에 실시간 자동 공유</strong>됩니다.
              </p>
            </div>
          </div>

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
              <span className="flex-1">{statusMsg.text}</span>
            </div>
          )}

          {/* 클라우드 실시간 동기화 + QR 코드 */}
          <div className="space-y-4">
            {/* 동기화 키 설정 박스 & DB 연결 테스트 */}
            <div className="rounded-xl bg-slate-950 p-3.5 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <KeyRound className="h-4 w-4 text-cyan-400" />
                  <span>팀/설비 동기화 방 코드 (Sync Room Key)</span>
                </label>
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isTestingPing}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition-all cursor-pointer"
                  title="중앙 Supabase DB 연결 상태 즉시 진단"
                >
                  <Activity className={`h-3 w-3 ${isTestingPing ? "animate-spin text-amber-400" : "text-cyan-400"}`} />
                  <span>{isTestingPing ? "연결 확인 중..." : "DB 연결 진단"}</span>
                </button>
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
              {pingResult && (
                <div
                  className={`mt-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono flex items-center gap-1.5 ${
                    pingResult.ok
                      ? "bg-emerald-950/60 text-emerald-300 border border-emerald-800/60"
                      : "bg-red-950/60 text-red-300 border border-red-800/60"
                  }`}
                >
                  {pingResult.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                  )}
                  <span>{pingResult.message}</span>
                </div>
              )}
            </div>

            {/* 📱 스마트폰 즉시 연결 QR 코드 & 링크 */}
            <div className="rounded-xl bg-slate-950 p-3.5 border border-cyan-900/40 flex flex-col sm:flex-row items-center gap-4">
              <div className="bg-white p-2 rounded-xl shadow-md shrink-0 flex items-center justify-center">
                <img
                  src={qrCodeUrl}
                  alt="스마트폰 연결용 QR 코드"
                  className="w-24 h-24 sm:w-28 sm:h-28 object-contain"
                />
              </div>
              <div className="flex-1 space-y-2 text-center sm:text-left">
                <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs font-bold text-cyan-300">
                  <Smartphone className="h-4 w-4 text-cyan-400" />
                  <span>스마트폰 카메라로 QR 코드를 비추세요</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  스마트폰 카메라로 위 QR 코드를 스캔하면, PC와 동일한 동기화 방으로 즉시 접속되어 <strong>PC의 모든 프로젝트 데이터가 스마트폰에 실시간 표시</strong>됩니다.
                </p>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-cyan-300 border border-slate-700 transition-all cursor-pointer"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copied ? "링크 복사 완료!" : "모바일 접속 링크 복사 (카톡/메신저 공유)"}</span>
                </button>
              </div>
            </div>

            {/* Manual Override Action Buttons */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-semibold text-slate-300">수동 강제 동기화 (선택 사항)</span>
                <span className="text-[10px] text-emerald-400 font-medium">● 자동 동기화 가동 중</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={handleCloudPush}
                  className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 p-3 text-xs font-bold text-slate-950 shadow-glow-cyan hover:opacity-95 disabled:opacity-50 transition-all cursor-pointer flex flex-col items-center justify-center gap-1"
                >
                  <CloudUpload className="h-5 w-5" />
                  <span>PC 데이터 ➔ 클라우드 즉시 저장</span>
                  <span className="text-[10px] font-normal text-slate-900/80">(지금 즉시 강제 업로드)</span>
                </button>

                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={handleCloudPull}
                  className="rounded-xl bg-slate-800 hover:bg-slate-750 border border-cyan-500/40 p-3 text-xs font-bold text-cyan-300 hover:text-cyan-200 disabled:opacity-50 transition-all cursor-pointer flex flex-col items-center justify-center gap-1 shadow-sm"
                >
                  <CloudDownload className="h-5 w-5 text-cyan-400" />
                  <span>클라우드 ➔ 데이터 즉시 내려받기</span>
                  <span className="text-[10px] font-normal text-slate-400">(지금 즉시 최신본 새로고침)</span>
                </button>
              </div>
            </div>

            {/* 💡 모바일 동기화 안내 및 문제 해결 */}
            <div className="rounded-xl bg-slate-950/70 p-3 border border-slate-800 text-[11px] text-slate-400 space-y-1.5">
              <div className="font-bold text-cyan-400 flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>스마트폰/모바일에서 5개만 보이고 동기화가 안 될 때:</span>
              </div>
              <ul className="list-disc pl-4 space-y-1 text-slate-300">
                <li>
                  <strong>모바일 웹 브라우저(권장):</strong> 스마트폰 기본 카메라로 상단 QR 코드를 비추어 열면 PC의 10개 프로젝트가 즉시 동기화됩니다.
                </li>
                <li>
                  <strong>강제 새로고침:</strong> 모바일에서 위 <code>[클라우드 ➔ 스마트폰 내려받기]</code> 버튼을 누르면 클라우드의 최신 10개 프로젝트를 즉시 전수 반영합니다.
                </li>
                <li>
                  <strong>APK 앱 사용 시:</strong> 스마트폰에 설치된 앱(APK)이 과거 빌드본인 경우, PC에서 <code>build-apk.bat</code>를 실행하여 최신 APK로 갱신해주세요.
                </li>
              </ul>
            </div>
          </div>
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
