"use client";

import React, { useState, Fragment } from "react";
import { PartItem } from "@/types";
import { generateId } from "@/lib/utils";
import {
  Camera,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Edit2,
  Check,
  PackagePlus,
  Sparkles,
  Search,
  CheckCheck,
} from "lucide-react";

interface PartsTableProps {
  parts: PartItem[];
  unitIndex: number;
  onUpdateParts: (parts: PartItem[]) => void;
  onOpenOcrModal: (part: PartItem) => void;
  onOpenPresetModal: () => void;
}

export const PartsTable: React.FC<PartsTableProps> = ({
  parts,
  unitIndex,
  onUpdateParts,
  onOpenOcrModal,
  onOpenPresetModal,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPartName, setEditPartName] = useState("");
  const [editSubSpec, setEditSubSpec] = useState("");
  const [editSpec, setEditSpec] = useState("");
  const [editSerial, setEditSerial] = useState("");
  const [searchFilter, setSearchFilter] = useState("");

  const verifiedCount = parts.filter((p) => p.isVerified).length;
  const totalCount = parts.length;
  const progressPercent = totalCount > 0 ? Math.round((verifiedCount / totalCount) * 100) : 0;

  // 인라인 수정 시작
  const startEditing = (part: PartItem) => {
    setEditingId(part.id);
    setEditPartName(part.partName);
    setEditSubSpec(part.subSpec || "");
    setEditSpec(part.spec);
    setEditSerial(part.detectedSerial || "");
  };

  // 인라인 수정 저장
  const saveEditing = (partId: string) => {
    onUpdateParts(
      parts.map((p) => {
        if (p.id === partId) {
          const hasSerial = editSerial.trim().length > 0;
          return {
            ...p,
            partName: editPartName.trim() || p.partName,
            subSpec: editSubSpec.trim() || "-",
            spec: editSpec.trim(),
            detectedSerial: editSerial.trim().toUpperCase(),
            isVerified: hasSerial ? p.isVerified : false,
          };
        }
        return p;
      })
    );
    setEditingId(null);
  };

  // 검증 상태 토글
  const toggleVerify = (partId: string) => {
    onUpdateParts(
      parts.map((p) => {
        if (p.id === partId) {
          return {
            ...p,
            isVerified: !p.isVerified,
          };
        }
        return p;
      })
    );
  };

  // 부품 삭제
  const deletePart = (partId: string) => {
    if (confirm("이 부품을 목록에서 삭제하시겠습니까?")) {
      onUpdateParts(parts.filter((p) => p.id !== partId));
    }
  };

  // 신규 부품 수동 추가
  const addNewEmptyPart = () => {
    const newPart: PartItem = {
      id: generateId(),
      category: "[ MAIN ]",
      partName: "신규 공정 부품",
      subSpec: "-",
      spec: "표준 규격 입력",
      detectedSerial: "",
      isVerified: false,
    };
    onUpdateParts([...parts, newPart]);
    startEditing(newPart);
  };

  // 전체 검증 일괄 토글
  const markAllVerified = () => {
    onUpdateParts(
      parts.map((p) => ({
        ...p,
        isVerified: true,
      }))
    );
  };

  const filteredParts = parts.filter(
    (p) =>
      p.partName.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (p.subSpec && p.subSpec.toLowerCase().includes(searchFilter.toLowerCase())) ||
      p.spec.toLowerCase().includes(searchFilter.toLowerCase()) ||
      p.detectedSerial.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (p.category && p.category.toLowerCase().includes(searchFilter.toLowerCase()))
  );

  return (
    <div className="space-y-4">
      {/* Action Toolbar & Progress Stats */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3.5 rounded-2xl bg-slate-900/90 p-4 border border-slate-800 shadow-lg">
        {/* Progress Bar & Stats */}
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-950 border border-slate-800">
            <span className="font-mono text-sm font-extrabold text-cyan-400">
              {progressPercent}%
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">
                {unitIndex}호기 부품 검증 진행률
              </span>
              <span className="rounded-full bg-cyan-950 px-2 py-0.5 text-[11px] font-mono text-cyan-300 border border-cyan-800">
                {verifiedCount} / {totalCount} 완료
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              카메라 스캔 또는 입력을 통해 부품 시리얼을 확인하세요.
            </p>
          </div>
        </div>

        {/* Action Buttons (Mobile Wrap) */}
        <div className="flex flex-wrap items-center gap-2 pt-1 sm:pt-0">
          <button
            type="button"
            onClick={onOpenPresetModal}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-xl bg-cyan-500/15 px-3.5 py-2.5 sm:py-2 text-xs font-semibold text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/25 transition-all shadow-sm cursor-pointer"
            title="모델별 표준 BOM 템플릿 불러오기 또는 엑셀 업로드"
          >
            <PackagePlus className="h-4 w-4 text-cyan-400" />
            <span>양식 변경</span>
          </button>

          <button
            type="button"
            onClick={addNewEmptyPart}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-800 px-3.5 py-2.5 sm:py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-all border border-slate-700 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>부품 추가</span>
          </button>

          {parts.length > 0 && (
            <button
              type="button"
              onClick={markAllVerified}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/15 px-3.5 py-2 text-xs font-bold text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all cursor-pointer"
              title="전체 항목을 검증 완료로 처리"
            >
              <CheckCheck className="h-4 w-4" />
              <span>전체 일괄 검증</span>
            </button>
          )}
        </div>
      </div>

      {/* Search Input Bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-500" />
        <input
          type="text"
          placeholder="품명, 규격, 세부사항, 시리얼 검색..."
          value={searchFilter}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchFilter(e.target.value)}
          className="w-full rounded-xl bg-slate-900 border border-slate-800 pl-10 pr-4 py-2.5 text-xs sm:text-sm text-slate-200 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none shadow-inner"
        />
        {searchFilter && (
          <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-mono">
            {filteredParts.length}건
          </span>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 1. 모바일 전용 카드 뷰 (스마트폰 화면: sm:hidden) */}
      {/* ========================================================================= */}
      <div className="block sm:hidden space-y-3">
        {filteredParts.map((part, index) => {
          const isEditing = editingId === part.id;
          const hasSerial = Boolean(part.detectedSerial?.trim());

          // 카테고리 헤더
          const prevPart = index > 0 ? filteredParts[index - 1] : null;
          const showCategoryHeader = part.category && (!prevPart || prevPart.category !== part.category);

          return (
            <div key={part.id} className="space-y-2">
              {showCategoryHeader && (
                <div className="flex items-center gap-2 pt-2 pb-1 font-mono font-bold text-xs text-cyan-300">
                  <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-glow-cyan" />
                  <span>{part.category}</span>
                </div>
              )}

              <div
                className={`rounded-2xl border p-3.5 transition-all shadow-md ${
                  part.isVerified
                    ? "bg-slate-900/95 border-emerald-500/40 shadow-emerald-950/20"
                    : hasSerial
                    ? "bg-slate-900 border-cyan-500/30"
                    : "bg-slate-900/90 border-slate-800"
                }`}
              >
                {isEditing ? (
                  /* 모바일 인라인 편집 모드 */
                  <div className="space-y-2.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-mono text-cyan-400 font-bold">
                        #{String(index + 1).padStart(2, "0")} 편집 중
                      </span>
                      <button
                        type="button"
                        onClick={() => saveEditing(part.id)}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-500 text-slate-950 text-xs font-bold shadow-md cursor-pointer"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>저장</span>
                      </button>
                    </div>

                    <div>
                      <label className="text-[10px] text-slate-400">품명</label>
                      <input
                        type="text"
                        value={editPartName}
                        onChange={(e) => setEditPartName(e.target.value)}
                        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-400">세부사항</label>
                        <input
                          type="text"
                          value={editSubSpec}
                          onChange={(e) => setEditSubSpec(e.target.value)}
                          className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400">규격</label>
                        <input
                          type="text"
                          value={editSpec}
                          onChange={(e) => setEditSpec(e.target.value)}
                          className="w-full rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-xs text-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400">시리얼 번호</label>
                      <input
                        type="text"
                        value={editSerial}
                        onChange={(e) => setEditSerial(e.target.value.toUpperCase())}
                        placeholder="시리얼 번호 직접 입력"
                        className="w-full rounded-lg bg-slate-950 border border-cyan-500 px-2.5 py-1.5 text-xs font-mono font-bold text-cyan-300 uppercase"
                      />
                    </div>
                  </div>
                ) : (
                  /* 모바일 일반 카드 뷰 */
                  <div className="space-y-3">
                    {/* 상단 품명 & 검증 상태 */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-mono font-bold text-slate-500">
                            #{String(index + 1).padStart(2, "0")}
                          </span>
                          <h4 className="text-sm font-bold text-white truncate">
                            {part.partName}
                          </h4>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 font-mono">
                          <span className="bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 text-slate-300">
                            {part.subSpec || "-"}
                          </span>
                          <span className="text-slate-400">
                            {part.spec || "-"}
                          </span>
                        </div>
                      </div>

                      {/* 검증 토글 버튼 */}
                      <button
                        type="button"
                        onClick={() => toggleVerify(part.id)}
                        className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition-all cursor-pointer ${
                          part.isVerified
                            ? "bg-emerald-500 text-slate-950 shadow-glow-emerald"
                            : "bg-slate-800 text-slate-400 border border-slate-700"
                        }`}
                      >
                        {part.isVerified ? (
                          <>
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>검증완료</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                            <span>미검증</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* 시리얼 번호 표시 & OCR 촬영 대형 액션 버튼 */}
                    <div className="flex items-stretch gap-2 pt-1 border-t border-slate-800/80">
                      {/* OCR 카메라 버튼 (엄지손가락으로 누르기 편한 크기) */}
                      <button
                        type="button"
                        onClick={() => onOpenOcrModal(part)}
                        className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 py-2.5 px-3 text-xs font-bold text-slate-950 shadow-glow-cyan active:scale-98 transition-all cursor-pointer"
                      >
                        <Camera className="h-4 w-4" />
                        <span>📷 OCR 명판 스캔</span>
                      </button>

                      {/* 수정 & 삭제 */}
                      <button
                        type="button"
                        onClick={() => startEditing(part)}
                        className="px-3 rounded-xl bg-slate-800 text-slate-300 hover:text-white border border-slate-700 flex items-center justify-center cursor-pointer"
                        title="직접 수정"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deletePart(part.id)}
                        className="px-3 rounded-xl bg-slate-800 text-slate-500 hover:text-red-400 border border-slate-700 flex items-center justify-center cursor-pointer"
                        title="삭제"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {/* 감지된 시리얼 표시 박스 */}
                    <div className="rounded-xl bg-slate-950 px-3 py-2 border border-slate-800 flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 font-mono">S/N:</span>
                      {hasSerial ? (
                        <span className="font-mono font-bold text-sm tracking-wider text-cyan-300">
                          {part.detectedSerial}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-xs italic font-mono">
                          (스캔 전 - 미인식)
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {filteredParts.length === 0 && (
          <div className="rounded-2xl bg-slate-900 p-8 text-center text-slate-500 border border-slate-800 text-xs">
            등록된 부품이 없습니다. 상단의 <strong>[양식 변경]</strong> 또는{" "}
            <strong>[부품 추가]</strong> 버튼을 눌러주세요.
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 2. 데스크톱/태블릿 전용 고밀도 테이블 뷰 (sm:block) */}
      {/* ========================================================================= */}
      <div className="hidden sm:block overflow-hidden rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl backdrop-blur-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
              <tr>
                <th className="py-3.5 px-3 w-12 text-center">No</th>
                <th className="py-3.5 px-3 min-w-[150px]">품명 (Part Name)</th>
                <th className="py-3.5 px-3 min-w-[140px]">세부 사항 (Sub Spec)</th>
                <th className="py-3.5 px-3 min-w-[180px]">규격 (Spec)</th>
                <th className="py-3.5 px-3 min-w-[200px]">시리얼 번호 (Serial No.)</th>
                <th className="py-3.5 px-3 w-28 text-center">검증 상태</th>
                <th className="py-3.5 px-3 w-20 text-center">관리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredParts.map((part, index) => {
                const isEditing = editingId === part.id;
                const hasSerial = Boolean(part.detectedSerial?.trim());

                const prevPart = index > 0 ? filteredParts[index - 1] : null;
                const showCategoryHeader = part.category && (!prevPart || prevPart.category !== part.category);

                return (
                  <Fragment key={part.id}>
                    {showCategoryHeader && (
                      <tr className="bg-slate-950/90 border-y border-slate-700/80">
                        <td colSpan={7} className="py-2 px-4">
                          <div className="flex items-center gap-2 font-mono font-extrabold text-xs text-cyan-300">
                            <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-glow-cyan" />
                            <span>{part.category}</span>
                          </div>
                        </td>
                      </tr>
                    )}
                    <tr
                      className={`transition-colors ${
                        part.isVerified
                          ? "bg-emerald-950/10 hover:bg-emerald-950/20"
                          : "hover:bg-slate-800/40"
                      }`}
                    >
                      {/* Index */}
                      <td className="py-3 px-3 text-center font-mono text-slate-500 font-bold">
                        {String(index + 1).padStart(2, "0")}
                      </td>

                      {/* Part Name */}
                      <td className="py-3 px-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editPartName}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditPartName(e.target.value)}
                            className="w-full rounded-lg bg-slate-950 border border-cyan-500 px-2 py-1 text-xs text-white focus:outline-none"
                          />
                        ) : (
                          <span className="font-semibold text-slate-200">
                            {part.partName}
                          </span>
                        )}
                      </td>

                      {/* Sub Spec */}
                      <td className="py-3 px-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editSubSpec}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditSubSpec(e.target.value)}
                            className="w-full rounded-lg bg-slate-950 border border-cyan-500 px-2 py-1 text-xs text-white focus:outline-none"
                          />
                        ) : (
                          <span className="text-slate-300 font-mono text-xs">
                            {part.subSpec || "-"}
                          </span>
                        )}
                      </td>

                      {/* Spec */}
                      <td className="py-3 px-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editSpec}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditSpec(e.target.value)}
                            className="w-full rounded-lg bg-slate-950 border border-cyan-500 px-2 py-1 text-xs text-white focus:outline-none"
                          />
                        ) : (
                          <span className="font-mono text-slate-400 text-xs">
                            {part.spec || "-"}
                          </span>
                        )}
                      </td>

                      {/* Serial & OCR Scan Button */}
                      <td className="py-3 px-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editSerial}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditSerial(e.target.value)}
                            placeholder="시리얼 직접 입력"
                            className="w-full rounded-lg bg-slate-950 border border-cyan-500 px-2 py-1 font-mono text-xs text-cyan-300 uppercase focus:outline-none"
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onOpenOcrModal(part)}
                              className="flex h-7 items-center gap-1.5 rounded-lg bg-cyan-500/15 px-2 text-[11px] font-bold text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/30 transition-all shrink-0 shadow-sm cursor-pointer"
                              title="모바일 카메라 인메모리 OCR 스캔"
                            >
                              <Camera className="h-3.5 w-3.5" />
                              <span>OCR 스캔</span>
                            </button>

                            {hasSerial ? (
                              <span className="font-mono font-bold tracking-wider text-cyan-300 truncate text-xs">
                                {part.detectedSerial}
                              </span>
                            ) : (
                              <span className="text-slate-600 italic font-mono text-[11px]">
                                (시리얼 미인식)
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Verification Status Badge */}
                      <td className="py-3 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => toggleVerify(part.id)}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer ${
                            part.isVerified
                              ? "bg-emerald-950/80 text-emerald-400 border border-emerald-700/60 shadow-glow-emerald"
                              : "bg-amber-950/50 text-amber-400 border border-amber-800/40 hover:bg-amber-950"
                          }`}
                        >
                          {part.isVerified ? (
                            <>
                              <CheckCircle2 className="h-3 w-3" />
                              <span>VERIFIED</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="h-3 w-3" />
                              <span>PENDING</span>
                            </>
                          )}
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {isEditing ? (
                            <button
                              type="button"
                              onClick={() => saveEditing(part.id)}
                              className="p-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 cursor-pointer"
                              title="저장"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEditing(part)}
                              className="p-1 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                              title="수정"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => deletePart(part.id)}
                            className="p-1 rounded-lg text-slate-500 hover:bg-red-950 hover:text-red-400 cursor-pointer"
                            title="삭제"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}

              {filteredParts.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    등록된 부품이 없습니다. 상단의 <strong>[BOM 프리셋]</strong> 또는{" "}
                    <strong>[부품 추가]</strong> 버튼을 눌러주세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
