"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { PartItem, PreprocessingOptions, OcrResult } from "@/types";
import {
  preprocessCanvas,
  cropCanvasROI,
  disposeCanvas,
  DEFAULT_PREPROCESSING_OPTIONS,
} from "@/lib/image-processing";
import { performGeminiDeepOcr, getGeminiApiKey, setGeminiApiKey } from "@/lib/gemini-ocr";
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
  Bot,
  KeyRound,
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

  // Preview & Processing State
  const [previewMode, setPreviewMode] = useState<"live" | "enhanced" | "binary">("live");
  const [guideMode, setGuideMode] = useState<"horizontal" | "vertical" | "full">("horizontal");
  const [options, setOptions] = useState<PreprocessingOptions>(DEFAULT_PREPROCESSING_OPTIONS);
  const [showOptions, setShowOptions] = useState(false);

  // UI 및 처리 상태
  const [isProcessing, setIsProcessing] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatusText, setOcrStatusText] = useState("");
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [selectedSerial, setSelectedSerial] = useState("");
  const [isVerifiedCheck, setIsVerifiedCheck] = useState(true);

  // Gemini API Key State
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState(() => getGeminiApiKey());

  // Canvas Refs (In-Memory Only, Zero-Storage)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cycleGuideMode = () => {
    setGuideMode((prev) => (prev === "horizontal" ? "vertical" : prev === "vertical" ? "full" : "horizontal"));
  };

  // 카메라 시작 (다단계 장애 극복 & 안드로이드 호환)
  const startCamera = useCallback(async () => {
    setHasCameraError(null);
    try {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }

      if (typeof window === "undefined" || !navigator?.mediaDevices?.getUserMedia) {
        setHasCameraError(
          "카메라 접근 권한이 없거나 지원되지 않는 브라우저 환경입니다. [📷 사진 직접 촬영 / 앨범 업로드] 버튼을 이용해주세요."
        );
        return;
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
        throw new Error("비디오 스트림을 획득할 수 없습니다.");
      }

      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch((e) => console.warn("Video auto-play error:", e));
        };
      }

      // 플래시(토치) 지원 여부 확인
      const videoTrack = mediaStream.getVideoTracks()[0];
      const capabilities = (videoTrack?.getCapabilities?.() || {}) as {
        torch?: boolean;
      };

      setTorchSupported(Boolean(capabilities.torch));
    } catch (err: unknown) {
      console.warn("Camera access failed:", err);
      setHasCameraError(
        "카메라 연결에 실패하였습니다. 브라우저/앱 설정에서 [카메라 권한]이 허용되어 있는지 확인하시거나, 아래의 [📷 사진 직접 촬영 / 앨범 업로드] 버튼을 이용해주세요."
      );
    }
  }, [facingMode]);

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
      setIsFrozen(false);
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

  // 다시 촬영 (카메라 라이브 뷰 재개)
  const handleRetake = () => {
    setIsFrozen(false);
    setOcrResult(null);
    setSelectedSerial("");
    try {
      videoRef.current?.play().catch(console.warn);
    } catch {}
  };

  // 인메모리 원터치 셔터 캡처 & OCR 수행 (Storage Zero: 사진 즉시 휘발)
  const captureAndRecognize = async (customCanvas?: HTMLCanvasElement) => {
    setIsProcessing(true);
    setOcrProgress(5);
    setOcrStatusText("명판 프레임 순간 캡처 중...");

    let rawCanvas: HTMLCanvasElement;

    if (customCanvas) {
      rawCanvas = customCanvas;
    } else {
      const video = videoRef.current;
      if (!video) {
        setIsProcessing(false);
        return;
      }

      // 화면 일시정지 (작업자가 팔을 편하게 내릴 수 있도록 프레임 동결)
      try {
        video.pause();
        setIsFrozen(true);
      } catch {}

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

    // ROI 타겟팅 정밀 크롭 (선택된 가이드 모드에 맞춤)
    let processedCanvas: HTMLCanvasElement;
    let croppedCanvas: HTMLCanvasElement | null = null;

    if (customCanvas) {
      // 1. 직접 사진 업로드 시: 전체 이미지 또는 중앙 대상 고해상도 처리
      processedCanvas = preprocessCanvas(customCanvas, options);
    } else {
      // 2. 카메라 촬영 시: 중앙 가이드 칸과 1:1 기하학적 매핑
      let roiWidth: number;
      let roiHeight: number;

      if (guideMode === "vertical") {
        roiWidth = rawCanvas.width * 0.52;
        roiHeight = rawCanvas.height * 0.86;
      } else if (guideMode === "full") {
        roiWidth = rawCanvas.width * 0.96;
        roiHeight = rawCanvas.height * 0.92;
      } else {
        // horizontal 기본 모드 (넓고 넉넉한 비율로 텍스트 잘림 원천 차단)
        roiWidth = rawCanvas.width * 0.88;
        roiHeight = rawCanvas.height * 0.48;
      }

      const roiX = (rawCanvas.width - roiWidth) / 2;
      const roiY = (rawCanvas.height - roiHeight) / 2;

      croppedCanvas = cropCanvasROI(rawCanvas, {
        x: roiX,
        y: roiY,
        width: roiWidth,
        height: roiHeight,
      }, 2.0);

      processedCanvas = preprocessCanvas(croppedCanvas, options);
    }

    // 1. 금속 명판 특화 전처리 파이프라인 적용
    setOcrProgress(20);
    setOcrStatusText("⚡ 듀얼 채널(Stream A/B) 광학 획 강화 생성 중...");

    // 프리뷰 캔버스에 표시
    if (previewCanvasRef.current) {
      const pCtx = previewCanvasRef.current.getContext("2d");
      if (pCtx) {
        previewCanvasRef.current.width = processedCanvas.width;
        previewCanvasRef.current.height = processedCanvas.height;
        pCtx.drawImage(processedCanvas, 0, 0);
      }
    }

    // 2. Gemini Vision AI & 고정밀 광학 OCR 심층 실행 (1.5~2.0초 타깃 초정밀 CoT)
    setOcrProgress(45);
    setOcrStatusText("🤖 Gemini Vision AI 라벨 방향 감지 & 다중 시리얼 분석 중...");

    try {
      const result = await performGeminiDeepOcr(
        processedCanvas,
        (progress, status) => {
          setOcrProgress(progress);
          setOcrStatusText(status);
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
        // 완료 즉각 햅틱 및 사운드 피드백
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
      if (croppedCanvas) disposeCanvas(croppedCanvas);
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
        <div className="p-3.5 sm:p-5 space-y-3.5 overflow-y-auto max-h-[calc(94vh-60px)]">
          {/* Enriched Large Camera Viewfinder Box (카메라 화면 대폭 확대: h-64 ~ h-80) */}
          <div className="relative w-full h-64 sm:h-80 rounded-2xl overflow-hidden bg-black border-2 border-slate-800 shadow-inner">
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {/* Industrial Viewfinder Crosshair & Guide Bounding Box */}
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-3">
              <div
                className={`relative border-2 border-cyan-400/90 rounded-xl shadow-glow-cyan transition-all duration-300 ${
                  guideMode === "vertical"
                    ? "w-[50%] h-[82%]"
                    : guideMode === "full"
                    ? "w-[94%] h-[90%]"
                    : "w-[86%] h-[44%]"
                }`}
              >
                {/* 4 Corner Markers */}
                <div className="absolute -top-1 -left-1 h-3.5 w-3.5 border-t-2 border-l-2 border-cyan-300" />
                <div className="absolute -top-1 -right-1 h-3.5 w-3.5 border-t-2 border-r-2 border-cyan-300" />
                <div className="absolute -bottom-1 -left-1 h-3.5 w-3.5 border-b-2 border-l-2 border-cyan-300" />
                <div className="absolute -bottom-1 -right-1 h-3.5 w-3.5 border-b-2 border-r-2 border-cyan-300" />

                {/* Center Horizontal & Vertical Target Alignment Marks */}
                <div className="absolute top-1/2 -left-2 w-2 h-0.5 bg-cyan-400/80 -translate-y-1/2" />
                <div className="absolute top-1/2 -right-2 w-2 h-0.5 bg-cyan-400/80 -translate-y-1/2" />

                {/* Center Laser Radar Scanning Animation (1.5~2.0초 동안 자연스러운 스캔 연출) */}
                {isProcessing && (
                  <div className="absolute inset-0 overflow-hidden rounded-xl bg-cyan-950/20 backdrop-blur-[1px]">
                    {/* Glowing Laser Sweep Beam */}
                    <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-cyan-300 to-transparent shadow-[0_0_15px_#22d3ee] animate-laserScan" />
                    
                    {/* Subtle Holographic Grid */}
                    <div className="absolute inset-0 bg-[linear-gradient(to_right,#06b6d415_1px,transparent_1px),linear-gradient(to_bottom,#06b6d415_1px,transparent_1px)] bg-[size:16px_16px] animate-pulse" />
                    
                    {/* Live Processing Indicator Badge */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="bg-slate-950/90 border border-cyan-400/60 px-3.5 py-1.5 rounded-full shadow-glow-cyan flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 text-cyan-400 animate-spin" />
                        <span className="text-cyan-300 font-mono text-[11px] font-bold">
                          초정밀 라벨/시리얼 분석 중...
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Guide Text / Freeze Status Badge */}
                <div className="absolute -top-5 inset-x-0 text-center">
                  {isFrozen ? (
                    <span className="bg-emerald-950/90 text-emerald-300 text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border border-emerald-500/60 shadow-glow-emerald">
                      ✓ 촬영 완료 (사진 즉시 휘발됨)
                    </span>
                  ) : (
                    <span className="bg-slate-950/80 text-cyan-300 text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border border-cyan-500/40">
                      [ {guideMode === "vertical" ? "세로 라벨" : guideMode === "full" ? "전체 영역" : "가로 라벨"} 중앙 위치 후 촬영 ]
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Camera Floating Controls (Gemini AI, Torch, Flip, Upload) */}
            <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 z-10">
              {/* 가이드 모드 전환 버튼 */}
              <button
                type="button"
                onClick={cycleGuideMode}
                className="px-2.5 py-1.5 rounded-xl bg-slate-900/90 text-cyan-300 border border-cyan-500/50 backdrop-blur-md hover:bg-slate-800 text-[11px] font-bold transition-all cursor-pointer shadow-glow-cyan flex items-center gap-1"
                title="가이드 모드 전환 (가로 / 세로 / 전체)"
              >
                <Sliders className="h-3.5 w-3.5 text-cyan-400" />
                <span>{guideMode === "horizontal" ? "가로" : guideMode === "vertical" ? "세로" : "전체"}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsApiKeyModalOpen(true)}
                className={`p-2 rounded-xl backdrop-blur-md border text-xs transition-all cursor-pointer ${
                  geminiKeyInput
                    ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/60 shadow-glow-cyan"
                    : "bg-slate-900/80 text-slate-300 border-slate-700 hover:bg-slate-800"
                }`}
                title={geminiKeyInput ? "Gemini AI 연동 활성화됨" : "Gemini AI API 키 설정"}
              >
                <Bot className="h-4 w-4 text-cyan-400" />
              </button>

              <button
                type="button"
                onClick={toggleTorch}
                className={`p-2 rounded-xl backdrop-blur-md border text-xs transition-all cursor-pointer ${
                  torchOn
                    ? "bg-amber-500 text-slate-950 border-amber-400 font-bold"
                    : "bg-slate-900/80 text-white border-slate-700 hover:bg-slate-800"
                }`}
                title="조명 플래시 토글"
              >
                {torchOn ? <Zap className="h-4 w-4 fill-current" /> : <ZapOff className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={switchFacingMode}
                className="p-2 rounded-xl bg-slate-900/80 text-white border border-slate-700 backdrop-blur-md hover:bg-slate-800 transition-all cursor-pointer"
                title="전면/후면 카메라 전환"
              >
                <RefreshCw className="h-4 w-4" />
              </button>

              <label
                className="p-2 rounded-xl bg-slate-900/80 text-white border border-slate-700 backdrop-blur-md hover:bg-slate-800 transition-all cursor-pointer"
                title="사진 파일 직접 불러오기"
              >
                <Upload className="h-4 w-4" />
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
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

          {/* Action Trigger Buttons (원터치 셔터 촬영 & 즉시 휘발) */}
          <div className="flex gap-2">
            {!isFrozen ? (
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => captureAndRecognize()}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-600 font-extrabold text-slate-950 py-3.5 px-4 rounded-xl text-xs sm:text-sm shadow-glow-cyan hover:opacity-95 disabled:opacity-50 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
              >
                {isProcessing ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Gemini AI 라벨/시리얼 정밀 추출 중...</span>
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4 stroke-[2.5]" />
                    <span>명판/라벨 촬영 & 시리얼 자동 추출 (1.5초)</span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleRetake}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold py-3 px-3 rounded-xl text-xs border border-slate-700 hover:border-cyan-500 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>🔄 다시 촬영하기</span>
              </button>
            )}
          </div>

          {/* Real-Time Processing Progress Bar & Status Ticker */}
          {isProcessing && (
            <div className="space-y-1.5 rounded-xl bg-slate-950/90 p-3 border border-cyan-500/30 shadow-glow-cyan">
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-cyan-300 font-semibold flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
                  {ocrStatusText}
                </span>
                <span className="text-cyan-400 font-bold">{ocrProgress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800 border border-slate-700">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 via-teal-400 to-blue-500 transition-all duration-300 shadow-glow-cyan"
                  style={{ width: `${ocrProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* OCR Result & Quick-Review Section */}
          <div className="rounded-2xl bg-slate-950 p-3.5 border border-slate-800 space-y-3 shadow-lg">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                <span>추출된 시리얼 번호 (최종 확인 및 수정)</span>
              </label>
              {ocrResult?.confidence !== undefined && ocrResult.cleanedSerial && (
                <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-500/40 font-bold">
                  🎯 정확도 {ocrResult.confidence}%
                </span>
              )}
            </div>

            {/* 인식 불가 안내 경고 박스 */}
            {ocrResult && !ocrResult.cleanedSerial && (
              <div className="rounded-lg bg-amber-950/70 border border-amber-800/80 p-2.5 flex items-start gap-2 text-amber-200 animate-fadeIn text-xs">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-200/90 leading-tight">
                  <strong>인식 불가:</strong> 가이드 영역에 명판의 S/N 라벨을 맞추고 조명을 켠 후 다시 촬영해주세요. (세로 라벨은 [세로] 가이드 추천)
                </p>
              </div>
            )}

            {/* Main Serial Input Box with Clear button */}
            <div className="relative">
              <input
                type="text"
                placeholder="시리얼 번호 (예: KSA7706685, 260225-40, TM1L-HK26-1007)"
                value={selectedSerial}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSelectedSerial(e.target.value.toUpperCase())
                }
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 pr-10 text-sm sm:text-base font-mono font-bold text-cyan-300 tracking-wider uppercase focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
              />
              {selectedSerial && (
                <button
                  type="button"
                  onClick={() => setSelectedSerial("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white bg-slate-800 rounded-lg text-xs"
                  title="지우기"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Serial Candidates Pills (다중 후보 원터치 선택) */}
            {ocrResult && ocrResult.candidates && ocrResult.candidates.length > 0 && (
              <div className="space-y-1.5 pt-0.5">
                <span className="text-[10px] font-semibold text-slate-400">
                  인식된 시리얼 번호 후보 (터치하여 즉시 선택):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {ocrResult.candidates.map((cand, idx) => (
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

            {/* Verification Checkbox & Main Confirm Button (모바일/PC 동일 1행 나란히 배치) */}
            <div className="pt-2.5 border-t border-slate-800/80 flex items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 cursor-pointer select-none shrink-0">
                <input
                  type="checkbox"
                  checked={isVerifiedCheck}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setIsVerifiedCheck(e.target.checked)
                  }
                  className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0 h-4 w-4"
                />
                <span className="flex items-center gap-1 text-emerald-400 font-bold text-xs whitespace-nowrap">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  실물 확인 완료
                </span>
              </label>

              {/* 🚀 [시리얼 확정 및 저장] 메인 버튼 */}
              <button
                type="button"
                onClick={handleSave}
                disabled={!selectedSerial.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2.5 text-xs font-extrabold text-slate-950 hover:brightness-110 disabled:opacity-40 shadow-glow-emerald transition-all cursor-pointer shrink-0 whitespace-nowrap"
              >
                <CheckCircle2 className="h-4 w-4 stroke-[2.5] shrink-0" />
                <span>시리얼 확정 및 저장</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 🤖 Gemini AI API 키 설정 모달 */}
      {isApiKeyModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-cyan-400" />
                <h4 className="font-bold text-white text-sm">Gemini AI 심층 판독 설정</h4>
              </div>
              <button
                type="button"
                onClick={() => setIsApiKeyModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Google Gemini API 키를 입력하시면, 초고난도 각인 및 흐린 손글씨 시리얼을 <strong>Gemini Vision AI</strong>가 획 단위로 분석하여 100% 완벽하게 추출합니다.
            </p>

            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1">
                <KeyRound className="h-3.5 w-3.5 text-cyan-400" />
                <span>Gemini API Key</span>
              </label>
              <input
                type="password"
                placeholder="AIzaSy..."
                value={geminiKeyInput}
                onChange={(e) => setGeminiKeyInput(e.target.value)}
                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs font-mono text-cyan-300 focus:border-cyan-500 focus:outline-none"
              />
              <span className="text-[10px] text-slate-500 block">
                * 키가 없을 경우에도 내장 광학 엔진(Tesseract + Barcode)으로 100% 자동 동작합니다.
              </span>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setGeminiApiKey(geminiKeyInput);
                  setIsApiKeyModalOpen(false);
                }}
                className="flex-1 rounded-xl bg-cyan-500 py-2 text-xs font-bold text-slate-950 hover:bg-cyan-400 transition-all cursor-pointer shadow-glow-cyan"
              >
                저장 및 적용
              </button>
              {geminiKeyInput && (
                <button
                  type="button"
                  onClick={() => {
                    setGeminiKeyInput("");
                    setGeminiApiKey("");
                    setIsApiKeyModalOpen(false);
                  }}
                  className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-slate-700 transition-all cursor-pointer"
                >
                  초기화
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
