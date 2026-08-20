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
      const result = await performInMemoryOcr(processedCanvas, (progress, status) => {
        setOcrProgress(50 + Math.round(progress * 0.45));
        setOcrStatusText(`S/N 키워드 및 번호 분석 중 (${progress}%)...`);
      });

      setOcrResult(result);
      if (result.cleanedSerial) {
        setSelectedSerial(result.cleanedSerial);
        triggerScanFeedback();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <Camera className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">
                  부품 명판 인메모리 OCR 인식
                </h3>
                <span className="rounded bg-cyan-950 px-2 py-0.5 text-[10px] font-mono text-cyan-300 border border-cyan-800">
                  {unitIndex}호기 / {targetPart.partName}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                규격: {targetPart.spec}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto space-y-4 flex-1">
          {/* Camera Viewfinder Box */}
          <div className="relative aspect-[4/3] sm:aspect-[16/9] w-full overflow-hidden rounded-xl bg-black border border-slate-700 shadow-inner flex items-center justify-center">
            {hasCameraError ? (
              <div className="p-6 text-center space-y-3">
                <AlertCircle className="mx-auto h-8 w-8 text-amber-400" />
                <p className="text-xs text-slate-300">{hasCameraError}</p>
                <div className="flex items-center justify-center gap-2 flex-wrap pt-1">
                  <button
                    type="button"
                    onClick={() => startCamera()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 border border-slate-700 px-3.5 py-2 text-xs font-bold text-cyan-300 hover:bg-slate-700 shadow-md cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>카메라 다시 연결</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-xs font-bold text-slate-950 hover:opacity-95 shadow-md cursor-pointer"
                  >
                    <Upload className="h-4 w-4" />
                    <span>사진 직접 촬영 / 앨범 선택</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{
                    transform:
                      !isHardwareZoom && zoomLevel > 1 ? `scale(${zoomLevel})` : undefined,
                    transformOrigin: "center center",
                    transition: "transform 0.15s ease-out",
                  }}
                  className="h-full w-full object-cover"
                />

                {/* Reticle / ROI Overlay */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="relative w-[80%] h-[45%] rounded-lg border-2 border-dashed border-cyan-400/80 bg-cyan-500/5 shadow-2xl flex flex-col justify-between p-2">
                    <div className="flex justify-between">
                      <div className="h-3 w-3 border-t-2 border-l-2 border-cyan-400" />
                      <div className="h-3 w-3 border-t-2 border-r-2 border-cyan-400" />
                    </div>

                    <div className="text-center">
                      <span className="rounded bg-slate-950/85 px-2 py-0.5 text-[10px] font-mono text-cyan-300 backdrop-blur-sm border border-cyan-500/30">
                        명판의 S/N 또는 Serial No. 영역을 사각 틀에 맞추세요
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <div className="h-3 w-3 border-b-2 border-l-2 border-cyan-400" />
                      <div className="h-3 w-3 border-b-2 border-r-2 border-cyan-400" />
                    </div>

                    {/* Scan Line Animation */}
                    {isProcessing && (
                      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-scan-line shadow-glow-cyan" />
                    )}
                  </div>
                </div>

                {/* 줌(Zoom) 플로팅 컨트롤 바 */}
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-slate-950/85 backdrop-blur-md px-2.5 py-1.5 rounded-full border border-cyan-500/30 shadow-lg z-10">
                  <button
                    type="button"
                    onClick={() => applyZoom(zoomLevel - 0.5)}
                    disabled={zoomLevel <= 1}
                    className="p-1 rounded-full text-slate-300 hover:text-cyan-300 disabled:opacity-30 cursor-pointer"
                    title="축소"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>

                  {[1.0, 1.5, 2.0, 3.0].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => applyZoom(preset)}
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold transition-all cursor-pointer ${
                        Math.abs(zoomLevel - preset) < 0.1
                          ? "bg-cyan-500 text-slate-950 shadow-glow-cyan scale-105"
                          : "text-slate-300 hover:text-white"
                      }`}
                    >
                      {preset}x
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => applyZoom(zoomLevel + 0.5)}
                    disabled={zoomLevel >= 4}
                    className="p-1 rounded-full text-slate-300 hover:text-cyan-300 disabled:opacity-30 cursor-pointer"
                    title="확대"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Viewfinder Action Overlay Controls */}
                <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10">
                  {torchSupported && (
                    <button
                      type="button"
                      onClick={toggleTorch}
                      className={`p-2 rounded-xl backdrop-blur-md transition-all cursor-pointer ${
                        torchOn
                          ? "bg-amber-400 text-slate-950 shadow-glow-amber"
                          : "bg-slate-900/80 text-slate-300 hover:text-white"
                      }`}
                      title={torchOn ? "플래시 끄기" : "플래시 켜기"}
                    >
                      {torchOn ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={switchFacingMode}
                    className="p-2 rounded-xl bg-slate-900/80 text-slate-300 hover:text-white backdrop-blur-md cursor-pointer"
                    title="전/후면 카메라 전환"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-xl bg-slate-900/80 text-white backdrop-blur-md hover:bg-slate-800 cursor-pointer"
                    title="파일로 선택"
                  >
                    <Upload className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>

          {/* Trigger Scan Button */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => captureAndRecognize()}
              disabled={isProcessing}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 py-3 text-sm font-bold text-slate-950 shadow-glow-cyan hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin text-slate-950" />
                  <span>{ocrStatusText || "인식 진행 중..."}</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>부품 명판 촬영 & 시리얼 즉시 추출 ({zoomLevel}x)</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowOptions(!showOptions)}
              className={`p-3 rounded-xl border transition-all cursor-pointer ${
                showOptions
                  ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300"
                  : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
              }`}
              title="전처리 옵션"
            >
              <Sliders className="h-4 w-4" />
            </button>
          </div>

          {/* Real-Time Processing Progress Bar */}
          {isProcessing && (
            <div className="space-y-1.5 rounded-xl bg-slate-950/80 p-3 border border-slate-800">
              <div className="flex justify-between text-xs font-mono">
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

          {/* Preprocessing Options Collapsible Panel */}
          {showOptions && (
            <div className="rounded-xl bg-slate-950 p-4 border border-slate-800 space-y-3">
              <h4 className="text-xs font-bold text-cyan-400 flex items-center gap-1.5">
                <Sliders className="h-3.5 w-3.5" />
                금속 명판 광학 전처리 파이프라인 튜닝
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.contrastStretch}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setOptions((prev) => ({ ...prev, contrastStretch: e.target.checked }))
                    }
                    className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <span>난반사 억제</span>
                </label>
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.adaptiveThreshold}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setOptions((prev) => ({ ...prev, adaptiveThreshold: e.target.checked }))
                    }
                    className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <span>적응형 이진화</span>
                </label>
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={options.invert}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setOptions((prev) => ({ ...prev, invert: e.target.checked }))
                    }
                    className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <span>명암 반전 (Invert)</span>
                </label>
              </div>

              {/* In-Memory Preview Canvas */}
              <div className="pt-2">
                <p className="text-[10px] text-slate-500 mb-1">
                  인메모리 전처리 결과 프리뷰 (Storage Zero Canvas):
                </p>
                <canvas
                  ref={previewCanvasRef}
                  className="w-full h-16 object-contain rounded bg-black border border-slate-800"
                />
              </div>
            </div>
          )}

          {/* OCR Result & Serial Confirmation Section */}
          <div className="rounded-xl bg-slate-950 p-4 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Cpu className="h-4 w-4 text-cyan-400" />
                추출된 시리얼 번호 (최종 확인/수정)
              </label>
              {ocrResult?.confidence !== undefined && (
                <span className="text-[11px] font-mono text-emerald-400">
                  신뢰도: {ocrResult.confidence}%
                </span>
              )}
            </div>

            <input
              type="text"
              placeholder="시리얼 번호 (예: STEC-2026-H8821)"
              value={selectedSerial}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setSelectedSerial(e.target.value.toUpperCase())
              }
              className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 text-base font-mono font-bold text-cyan-300 tracking-wider uppercase focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />

            {/* Serial Candidates Pills */}
            {ocrResult && ocrResult.candidates.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <span className="text-[11px] font-semibold text-slate-400">
                  감지된 시리얼 후보 (터치하여 선택):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {ocrResult.candidates.map((cand, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedSerial(cand)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-all cursor-pointer ${
                        selectedSerial === cand
                          ? "bg-cyan-500 text-slate-950 shadow-glow-cyan font-bold ring-2 ring-cyan-300"
                          : "bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700"
                      }`}
                    >
                      {cand}
                      {idx === 0 && (
                        <span className="ml-1.5 rounded bg-cyan-950/80 px-1 py-0.2 text-[9px] text-cyan-300 border border-cyan-700">
                          S/N 우선
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Verification Checkbox */}
            <div className="flex items-center gap-2 pt-1">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-300 cursor-pointer">
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
        <div className="flex items-center justify-between p-4 border-t border-slate-800 bg-slate-950/80">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-800 cursor-pointer"
          >
            닫기
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={!selectedSerial.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-40 shadow-glow-emerald transition-all cursor-pointer"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>부품 시리얼 확정 및 저장</span>
          </button>
        </div>
      </div>
    </div>
  );
};
