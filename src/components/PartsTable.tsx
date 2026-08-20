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
    onUpdateParts(parts.filter((p) => p.id !== partId));
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
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 rounded-2xl bg-slate-900/90 p-4 border border-slate-800 shadow-lg">
        {/* Progress Bar & Stats */}
        <div className="flex items-center gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 border border-slate-800">
            <span className="font-mono text-xs font-extrabold text-cyan-400">
              {progressPercent}%
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">
                {unitIndex}호기 부품 검증 진행률
              </span>
              <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-mono text-cyan-300">
                {verifiedCount} / {totalCount} 완료
              </span>
            </div>
            <p className="text-xs text-slate-400">
              카메라 스캔 또는 수동 입력을 통해 모든 부품의 시리얼을 검증하세요.
            </p>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenPresetModal}
            className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500/15 px-3.5 py-2 text-xs font-semibold text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/25 transition-all shadow-sm cursor-pointer"
            title="모델별 표준 BOM 템플릿 불러오기 또는 엑셀(.xlsx) 파일 업로드"
          >
            <PackagePlus className="h-4 w-4 text-cyan-400" />
            <span>PJT 부품 양식 변경</span>
          </button>

          <button
            type="button"
            onClick={addNewEmptyPart}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition-all border border-slate-700"
          >
            <Plus className="h-4 w-4" />
            <span>부품 추가</span>
          </button>

          {parts.length > 0 && (
            <button
              type="button"
              onClick={markAllVerified}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all"
              title="전체 항목을 검증 완료로 처리"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>전체 검증</span>
            </button>
          )}
        </div>
      </div>

      {/* Parts Table Card */}
      <div className="overflow-hidden rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl backdrop-blur-sm">
        {/* Table Filter / Search */}
        <div className="p-3.5 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="모듈, 품명, 세부사항, 규격, 시리얼 검색..."
              value={searchFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchFilter(e.target.value)}
              className="w-full rounded-xl bg-slate-900 border border-slate-700 pl-9 pr-4 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <span className="text-xs font-mono text-slate-400 hidden sm:inline">
            총 {filteredParts.length}개 항목
          </span>
        </div>

        {/* Table Content */}
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

                // 이전 항목과 category가 다르면 모듈 구분 바 렌더링
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
