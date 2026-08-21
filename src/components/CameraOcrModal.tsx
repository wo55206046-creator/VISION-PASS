"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { PartItem, PreprocessingOptions, OcrResult } from "@/types";
import {
  preprocessCanvas,
  cropCanvasROI,
  disposeCanvas,
  DEFAULT_PREPROCESSING_OPTIONS,
} from "@/lib/image-processing";
import { performInMemoryOcr } from "@/lib/ocr-worker";
import { triggerScanFeedback } from "@/lib/utils";
import {
  Camera,
  X,
  Zap,
  ZapOff,
  RefreshCw,
  CheckCircle2,
  Sliders,
  Sparkles,
  Upload,
  Layers,
  Eye,
  AlertCircle,
  AlertTriangle,
  Cpu,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

interface CameraOcrModalProps {
  isOpen: boolean;
  targetPart: PartItem | null;
  unitIndex: number;
  equipmentSerial?: string;
  onClose: () => void;
  onConfirm: (partId: string, serial: string, isVerified: boolean, confidence?: number) => void;
}

export const CameraOcrModal: React.FC<CameraOcrModalProps> = ({
  isOpen,
  targetPart,
  unitIndex,
  equipmentSerial,
  onClose,
  onConfirm,
}) => {
  // Video & Stream State
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [hasCameraError, setHasCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  // Zoom State (Hardware + Software Hybrid Zoom)
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isHardwareZoom, setIsHardwareZoom] = useState(false);

  // Preview & Processing State
  const [previewMode, setPreviewMode] = useState<"live" | "enhanced" | "binary">("live");
  const [options, setOptions] = useState<PreprocessingOptions>(DEFAULT_PREPROCESSING_OPTIONS);
  const [showOptions, setShowOptions] = useState(false);

  // OCR State
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatusText, setOcrStatusText] = useState("");
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [selectedSerial, setSelectedSerial] = useState("");
  const [isVerifiedCheck, setIsVerifiedCheck] = useState(true);

  // Canvas Refs (In-Memory Only, Zero-Storage)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 줌 변경 핸들러 (하드웨어 줌 시도 후 미지원 시 소프트웨어 줌으로 연동)
  const applyZoom = useCallback(
    async (newZoom: number, activeStream: MediaStream | null = stream) => {
      const clampedZoom = Math.min(4, Math.max(1, +(newZoom.toFixed(1))));
      setZoomLevel(clampedZoom);

      if (activeStream) {
        const videoTrack = activeStream.getVideoTracks()[0];
        try {
          const capabilities = (videoTrack?.getCapabilities?.() || {}) as {
            zoom?: { min: number; max: number; step: number };
          };
          if (capabilities.zoom && (videoTrack as any).applyConstraints) {
            await (videoTrack as any).applyConstraints({
              advanced: [{ zoom: clampedZoom }],
            });
            setIsHardwareZoom(true);
            return;
          }
        } catch {
          // Hardware zoom unsupported on this device/browser -> fallback to software zoom
        }
      }
      setIsHardwareZoom(false);
    },
    [stream]
  );

  // 카메라 시작 (다단계 장애 극복 & 안드로이드 호환)
  const startCamera = useCallback(async () => {
    setHasCameraError(null);
    try {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      let mediaStream: MediaStream | null = null;

      // 1단계 시도: Full HD 후면 카메라 & 연속 자동초점
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            advanced: [{ focusMode: "continuous" }] as any,
          },
          audio: false,
        });
      } catch (e1) {
        console.warn("1단계 고해상도 카메라 실패, 기본 설정으로 재시도:", e1);
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facingMode },
            audio: false,
          });
        } catch (e2) {
          console.warn("2단계 facingMode 실패, 가용 비디오 스트림으로 재시도:", e2);
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }
      }

      if (!mediaStream) {
        throw new Error("카메라 스트림을 획득하지 못했습니다.");
      }

      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch((e) => console.warn("Video auto-play error:", e));
        };
      }

      // 플래시(토치) 및 하드웨어 줌 지원 여부 확인
      const videoTrack = mediaStream.getVideoTracks()[0];
      const capabilities = (videoTrack?.getCapabilities?.() || {}) as {
        torch?: boolean;
        zoom?: { min: number; max: number; step: number };
      };

      setTorchSupported(Boolean(capabilities.torch));

      // 기본 1x 줌 적용
      applyZoom(1, mediaStream);
    } catch (err: unknown) {
      console.warn("Camera access failed:", err);
      setHasCameraError(
        "카메라 연결에 실패하였습니다. 브라우저/앱 설정에서 [카메라 권한]이 허용되어 있는지 확인하시거나, 아래의 [📷 사진 직접 촬영 / 앨범 업로드] 버튼을 이용해주세요."
      );
    }
  }, [facingMode, applyZoom]);

  // 카메라 스트림 정리 (스토리지 제로)
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stream]);

  // 모달 열림/닫힘 시 라이프사이클
  useEffect(() => {
    if (isOpen && targetPart) {
      setSelectedSerial(targetPart.detectedSerial || "");
      setIsVerifiedCheck(true);
      setOcrResult(null);
      setZoomLevel(1);
      startCamera();
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isOpen, targetPart]);

  // 토치 토글
  const toggleTorch = async () => {
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0];
    try {
      const newTorchState = !torchOn;
      const trackWithTorch = videoTrack as MediaStreamTrack & {
        applyConstraints: (c: { advanced?: Array<{ torch?: boolean }> }) => Promise<void>;
      };
      if (trackWithTorch.applyConstraints) {
        await trackWithTorch.applyConstraints({
          advanced: [{ torch: newTorchState }],
        });
        setTorchOn(newTorchState);
      }
    } catch (e) {
      console.warn("Torch toggle failed:", e);
    }
  };

  // 카메라 전환 (전면/후면)
  const switchFacingMode = () => {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  };

  // 인메모리 캡처 & OCR 수행 (Storage Zero)
  const captureAndRecognize = async (customCanvas?: HTMLCanvasElement) => {
    setIsProcessing(true);
    setOcrProgress(5);
    setOcrStatusText("금속 명판 프레임 캡처 중...");

    let rawCanvas: HTMLCanvasElement;

    if (customCanvas) {
      rawCanvas = customCanvas;
    } else {
      const video = videoRef.current;
      if (!video) {
        setIsProcessing(false);
        return;
      }

      rawCanvas = document.createElement("canvas");
      rawCanvas.width = video.videoWidth || 1280;
      rawCanvas.height = video.videoHeight || 720;
      const ctx = rawCanvas.getContext("2d");
      if (!ctx) {
        setIsProcessing(false);
        return;
      }
      ctx.drawImage(video, 0, 0, rawCanvas.width, rawCanvas.height);
    }

    // ROI 타겟팅 크롭 (줌 배율에 맞춰 화면에 보이는 영역을 정밀 크롭)
    const effectiveZoom = isHardwareZoom ? 1 : zoomLevel;
    const visibleWidth = rawCanvas.width / effectiveZoom;
    const visibleHeight = rawCanvas.height / effectiveZoom;
    const visibleX = (rawCanvas.width - visibleWidth) / 2;
    const visibleY = (rawCanvas.height - visibleHeight) / 2;

    // 가이드 사각틀 내부의 시리얼 영역 (가로 80%, 세로 45%)
    const roiWidth = visibleWidth * 0.8;
    const roiHeight = visibleHeight * 0.45;
    const roiX = visibleX + (visibleWidth - roiWidth) / 2;
    const roiY = visibleY + (visibleHeight - roiHeight) / 2;

    const croppedCanvas = cropCanvasROI(rawCanvas, {
      x: roiX,
      y: roiY,
      width: roiWidth,
      height: roiHeight,
    });

    // 1. 금속 명판 특화 전처리 파이프라인 적용
    setOcrProgress(25);
    setOcrStatusText("반사광 억제 및 적응형 대비 강화 전처리 중...");
    const processedCanvas = preprocessCanvas(croppedCanvas, options);

    // 프리뷰 캔버스에 표시
    if (previewCanvasRef.current) {
      const pCtx = previewCanvasRef.current.getContext("2d");
      if (pCtx) {
        previewCanvasRef.current.width = processedCanvas.width;
        previewCanvasRef.current.height = processedCanvas.height;
        pCtx.drawImage(processedCanvas, 0, 0);
      }
    }

    // 2. Tesseract.js 인메모리 OCR 실행
    setOcrProgress(50);
    setOcrStatusText("Tesseract 인메모리 OCR 문자 인식 중...");

    try {
      const result = await performInMemoryOcr(
        processedCanvas,
        (progress, status) => {
          setOcrProgress(50 + Math.round(progress * 0.45));
          setOcrStatusText(`S/N 키워드 및 번호 정밀 분석 중 (${progress}%)...`);
        },
        targetPart
          ? {
              partName: targetPart.partName,
              spec: targetPart.spec,
              subSpec: targetPart.subSpec,
            }
          : undefined
      );

      setOcrResult(result);
      if (result.cleanedSerial) {
        setSelectedSerial(result.cleanedSerial);
        triggerScanFeedback();
      } else {
        setSelectedSerial("");
      }
    } catch (err) {
      console.error("OCR recognition error:", err);
      setHasCameraError("OCR 인식 중 오류가 발생했습니다. 직접 입력하거나 다시 시도해주세요.");
    } finally {
      // 메모리 즉시 회수 (스토리지 제로)
      disposeCanvas(rawCanvas);
      disposeCanvas(croppedCanvas);
      disposeCanvas(processedCanvas);

      setOcrProgress(100);
      setIsProcessing(false);
    }
  };

  // 로컬 사진 파일 업로드 핸들러 (스토리지 제로: 브라우저 메모리 Canvas로만 로드)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        captureAndRecognize(canvas);
      }
      URL.revokeObjectURL(objectUrl);
    };

    img.src = objectUrl;
    e.target.value = "";
  };

  // 최종 저장 & 검증 완료
  const handleSave = () => {
    if (!targetPart) return;
    onConfirm(targetPart.id, selectedSerial.trim(), isVerifiedCheck, ocrResult?.confidence);
    onClose();
  };

  if (!isOpen || !targetPart) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6 animate-fadeIn">
      <div className="relative w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-950/90">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 shadow-glow-cyan shrink-0">
              <Camera className="h-4 w-4" />
            </div>
            <div className="min-w-0 truncate">
              <div className="flex items-center gap-1.5 truncate">
                <span className="font-mono text-xs font-extrabold text-cyan-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800 shrink-0">
                  {unitIndex}호기
                </span>
                <h3 className="text-sm font-bold text-white truncate">
                  {targetPart.partName}
                </h3>
              </div>
              <p className="text-[10px] text-slate-400 truncate">
                {targetPart.spec} {targetPart.subSpec ? `• ${targetPart.subSpec}` : ""}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-all cursor-pointer shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body (컴팩트 스크롤 제로 뷰) */}
        <div className="p-3 sm:p-4 space-y-2.5 overflow-y-auto max-h-[calc(90vh-110px)]">
          {/* Compact Camera Viewfinder Box (촬영 화면 축소: h-36 ~ h-44) */}
          <div className="relative w-full h-36 sm:h-44 rounded-xl overflow-hidden bg-black border-2 border-slate-800 shadow-inner">
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full h-full object-cover transition-transform duration-100 ease-out"
              style={{
                transform: !isHardwareZoom && zoomLevel > 1 ? `scale(${zoomLevel})` : "none",
                transformOrigin: "center center",
              }}
            />

            {/* Industrial Viewfinder Crosshair & Guide Bounding Box */}
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-3">
              <div className="relative w-3/4 h-3/4 border-2 border-cyan-400/80 rounded-xl shadow-glow-cyan transition-all duration-300">
                {/* 4 Corner Markers */}
                <div className="absolute -top-1 -left-1 h-3.5 w-3.5 border-t-2 border-l-2 border-cyan-300" />
                <div className="absolute -top-1 -right-1 h-3.5 w-3.5 border-t-2 border-r-2 border-cyan-300" />
                <div className="absolute -bottom-1 -left-1 h-3.5 w-3.5 border-b-2 border-l-2 border-cyan-300" />
                <div className="absolute -bottom-1 -right-1 h-3.5 w-3.5 border-b-2 border-r-2 border-cyan-300" />

                {/* Center Scanning Line Animation */}
                {isProcessing && (
                  <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-300 to-transparent animate-pulse" />
                )}

                {/* Guide Text */}
                <div className="absolute -top-5 inset-x-0 text-center">
                  <span className="bg-slate-950/80 text-cyan-300 text-[10px] font-mono font-bold px-2 py-0.2 rounded-full border border-cyan-500/40">
                    [ 명판 영역 맞춤 ]
                  </span>
                </div>
              </div>
            </div>

            {/* Camera Floating Controls (Torch, Flip, Upload) */}
            <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
              <button
                type="button"
                onClick={toggleTorch}
                className={`p-1.5 rounded-lg backdrop-blur-md border text-xs transition-all cursor-pointer ${
                  torchOn
                    ? "bg-amber-500 text-slate-950 border-amber-400 font-bold"
                    : "bg-slate-900/80 text-white border-slate-700 hover:bg-slate-800"
                }`}
                title="조명 플래시 토글"
              >
                {torchOn ? <Zap className="h-3.5 w-3.5 fill-current" /> : <ZapOff className="h-3.5 w-3.5" />}
              </button>

              <button
                type="button"
                onClick={switchFacingMode}
                className="p-1.5 rounded-lg bg-slate-900/80 text-white border border-slate-700 backdrop-blur-md hover:bg-slate-800 transition-all cursor-pointer"
                title="전면/후면 카메라 전환"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>

              <label
                className="p-1.5 rounded-lg bg-slate-900/80 text-white border border-slate-700 backdrop-blur-md hover:bg-slate-800 transition-all cursor-pointer"
                title="사진 파일 직접 불러오기"
              >
                <Upload className="h-3.5 w-3.5" />
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* 🔍 Zoom Quick Controls Floating Pill */}
            <div className="absolute bottom-2 inset-x-0 flex justify-center items-center gap-1 z-10 pointer-events-auto">
              <div className="bg-slate-950/85 backdrop-blur-md border border-slate-700/80 rounded-full px-2 py-0.5 flex items-center gap-1 shadow-xl">
                <span className="text-[9px] font-bold text-slate-400 mr-0.5 flex items-center gap-0.5">
                  <ZoomIn className="h-2.5 w-2.5 text-cyan-400" />
                  줌:
                </span>
                {[1, 1.5, 2, 3].map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => applyZoom(z)}
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold transition-all cursor-pointer ${
                      zoomLevel === z
                        ? "bg-cyan-500 text-slate-950 shadow-glow-cyan scale-105"
                        : "bg-slate-900/90 text-slate-300 hover:text-white border border-slate-700/60"
                    }`}
                  >
                    {z}x
                  </button>
                ))}
              </div>
            </div>

            {/* Error Overlay */}
            {hasCameraError && (
              <div className="absolute inset-0 bg-slate-950/90 flex flex-col items-center justify-center p-4 text-center space-y-2">
                <AlertCircle className="h-6 w-6 text-amber-400" />
                <p className="text-xs text-slate-300 max-w-sm">{hasCameraError}</p>
                <button
                  type="button"
                  onClick={startCamera}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 font-bold text-xs"
                >
                  카메라 다시 연결
                </button>
              </div>
            )}
          </div>

          {/* Action Trigger Buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => captureAndRecognize()}
              className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 font-extrabold text-slate-950 py-2.5 px-3 rounded-xl text-xs sm:text-sm shadow-glow-cyan hover:opacity-95 disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>광학 분석 및 S/N 추출 중...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>명판 촬영 & 시리얼 즉시 추출 ({zoomLevel}x)</span>
                </>
              )}
            </button>
          </div>

          {/* Real-Time Processing Progress Bar */}
          {isProcessing && (
            <div className="space-y-1 rounded-xl bg-slate-950/80 p-2.5 border border-slate-800">
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-cyan-400">{ocrStatusText}</span>
                <span className="text-slate-400">{ocrProgress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-200 shadow-glow-cyan"
                  style={{ width: `${ocrProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* OCR Result & Serial Confirmation Section (스크롤 없이 바로 노출) */}
          <div className="rounded-xl bg-slate-950 p-3 border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                <span>추출된 시리얼 번호 (최종 확인/수정)</span>
              </label>
              {ocrResult?.confidence !== undefined && ocrResult.cleanedSerial && (
                <span className="text-[10px] font-mono text-emerald-400 font-bold">
                  신뢰도: {ocrResult.confidence}%
                </span>
              )}
            </div>

            {/* 인식 불가 안내 경고 박스 */}
            {ocrResult && !ocrResult.cleanedSerial && (
              <div className="rounded-lg bg-amber-950/70 border border-amber-800/80 p-2.5 flex items-start gap-2 text-amber-200 animate-fadeIn text-xs">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-200/90 leading-tight">
                  <strong>인식 불가:</strong> 사각 가이드 영역에 명판의 S/N 번호를 맞추고 조명을 켠 후 다시 촬영해주세요.
                </p>
              </div>
            )}

            <input
              type="text"
              placeholder="시리얼 번호 (예: KMA9011219, 230600231746059-A, TBAJB1112637, 673644)"
              value={selectedSerial}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setSelectedSerial(e.target.value.toUpperCase())
              }
              className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 text-sm sm:text-base font-mono font-bold text-cyan-300 tracking-wider uppercase focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />

            {/* Serial Candidates Pills (최대 3개 추천) */}
            {ocrResult && ocrResult.candidates.length > 0 && (
              <div className="space-y-1 pt-0.5">
                <span className="text-[10px] font-semibold text-slate-400">
                  추천 시리얼 후보 (터치하여 선택):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {ocrResult.candidates.slice(0, 3).map((cand, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedSerial(cand)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                        selectedSerial === cand
                          ? "bg-cyan-500 text-slate-950 shadow-glow-cyan font-bold ring-2 ring-cyan-300"
                          : "bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700"
                      }`}
                    >
                      <span
                        className={`text-[9px] px-1 py-0.2 rounded font-bold ${
                          idx === 0
                            ? selectedSerial === cand
                              ? "bg-slate-950 text-cyan-300"
                              : "bg-cyan-950 text-cyan-300 border border-cyan-700"
                            : "bg-slate-900 text-slate-400"
                        }`}
                      >
                        {idx === 0 ? "1순위 S/N" : `${idx + 1}순위`}
                      </span>
                      <span>{cand}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Verification Checkbox */}
            <div className="flex items-center gap-2 pt-0.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isVerifiedCheck}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setIsVerifiedCheck(e.target.checked)
                  }
                  className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  작업자 실물 검증 완료 (Verified)
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between p-3 sm:p-4 border-t border-slate-800 bg-slate-950/90">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-800 cursor-pointer"
          >
            닫기
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={!selectedSerial.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-40 shadow-glow-emerald transition-all cursor-pointer"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>부품 시리얼 확정 및 저장</span>
          </button>
        </div>
      </div>
    </div>
  );
};
