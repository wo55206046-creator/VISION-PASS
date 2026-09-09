"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { PartItem, PreprocessingOptions, OcrResult } from "@/types";
import {
  preprocessCanvas,
  cropCanvasROI,
  disposeCanvas,
  DEFAULT_PREPROCESSING_OPTIONS,
} from "@/lib/image-processing";
import { performGeminiDeepOcr } from "@/lib/gemini-ocr";
import { scanNativeBarcode, quickScanLiveRoi, getOcrWorker } from "@/lib/ocr-worker";
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
  Layers,
  Eye,
  AlertCircle,
  AlertTriangle,
  Cpu,
  FileText,
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
  const [hardwareZoomSupported, setHardwareZoomSupported] = useState(false);

  // Preview & Processing State
  const [zoomLevel, setZoomLevel] = useState<1 | 2 | 3>(1);
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
  const [showRawText, setShowRawText] = useState(false);

  // Canvas Refs (In-Memory Only, Zero-Storage)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const cycleGuideMode = () => {
    setGuideMode((prev) => (prev === "horizontal" ? "vertical" : prev === "vertical" ? "full" : "horizontal"));
  };

  // 스마트폰 하드웨어 카메라 줌 & 디지털 줌 통합 제어
  const handleZoomChange = async (z: 1 | 2 | 3) => {
    setZoomLevel(z);
    if (stream) {
      const track = stream.getVideoTracks()[0];
      if (track) {
        const capabilities = (track.getCapabilities?.() || {}) as any;
        if (capabilities?.zoom) {
          try {
            const minZ = capabilities.zoom.min || 1;
            const maxZ = capabilities.zoom.max || 3;
            const targetZ = Math.min(maxZ, Math.max(minZ, z));
            await track.applyConstraints({ advanced: [{ zoom: targetZ }] } as any);
          } catch (e) {
            console.warn("Hardware zoom error:", e);
          }
        }
      }
    }
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
          "카메라 접근 권한이 없거나 지원되지 않는 브라우저 환경입니다. 브라우저 설정에서 카메라 접근을 허용해주세요."
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
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facingMode },
            audio: false,
          });
        } catch (e2) {
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

      // 플래시(토치) 및 하드웨어 줌 지원 여부 확인
      const videoTrack = mediaStream.getVideoTracks()[0];
      const capabilities = (videoTrack?.getCapabilities?.() || {}) as any;

      setTorchSupported(Boolean(capabilities.torch));
      setHardwareZoomSupported(Boolean(capabilities.zoom));
    } catch (err: unknown) {
      const isNotFound =
        err instanceof Error &&
        (err.name === "NotFoundError" || err.name === "DevicesNotFoundError");
      
      if (!isNotFound) {
        console.warn("Camera access failed:", err);
      }
      
      setHasCameraError(
        isNotFound
          ? "연결된 카메라 장치가 감지되지 않았습니다. PC에 웹캠이 연결되어 있는지 확인하시거나, 스마트폰 모바일 기기 또는 [이미지 파일 업로드]를 이용해주세요."
          : "카메라 연결에 실패하였습니다. 브라우저/앱 설정에서 [카메라 권한]이 허용되어 있는지 확인 후 [카메라 다시 연결]을 눌러주세요."
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
      // 🚀 초고속 2초 시리얼 추출을 위한 백그라운드 Tesseract 워커 사전 로드 (지연 0ms)
      getOcrWorker().catch(console.warn);
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



  /**
   * 🔍 스마트 라벨 오토-타겟팅 & 고해상도 확대 캔버스 생성 (Smart Label Zoom)
   * 전체 프레임에서 노란색 라벨의 위치를 0.002초 만에 탐색하여,
   * 라벨이 화면 구석이나 아래에 있더라도 라벨 영역을 화면 중앙에 큼직하게 꽉 채워(1.8x 확대) AI에 전달
   */
  const getSmartTargetCanvas = (rawCanvas: HTMLCanvasElement, croppedCanvas: HTMLCanvasElement): HTMLCanvasElement => {
    try {
      const ctx = rawCanvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return croppedCanvas;
      const imgData = ctx.getImageData(0, 0, rawCanvas.width, rawCanvas.height);
      const data = imgData.data;

      let minX = rawCanvas.width, maxX = 0, minY = rawCanvas.height, maxY = 0;
      let yellowCount = 0;

      // 4픽셀 간격 스킵 샘플링 (초고속 2ms 분석)
      for (let y = 0; y < rawCanvas.height; y += 4) {
        for (let x = 0; x < rawCanvas.width; x += 4) {
          const idx = (y * rawCanvas.width + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          
          // 노란색 스티커 판정 (붉은색 아크릴 및 주변 노이즈 배제)
          const isYellow =
            r > 90 &&
            g > 75 &&
            Math.abs(r - g) < 70 &&
            r - b > 30 &&
            g - b > 20 &&
            r + g > b * 2.1;

          if (isYellow) {
            yellowCount++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      // 노란색 라벨이 선명하게 포착된 경우 (50샘플 이상 & 유효 크기)
      if (yellowCount >= 45 && maxX > minX + 35 && maxY > minY + 12) {
        const padX = Math.round((maxX - minX) * 0.4);
        const padY = Math.round((maxY - minY) * 0.6);
        const x1 = Math.max(0, minX - padX);
        const y1 = Math.max(0, minY - padY);
        const w = Math.min(rawCanvas.width - x1, (maxX - minX) + padX * 2);
        const h = Math.min(rawCanvas.height - y1, (maxY - minY) + padY * 2);

        const target = document.createElement("canvas");
        target.width = Math.max(1024, Math.round(w * 2.2));
        target.height = Math.round(target.width * (h / w));
        const tCtx = target.getContext("2d");
        if (tCtx) {
          tCtx.imageSmoothingEnabled = true;
          tCtx.imageSmoothingQuality = "high";
          tCtx.drawImage(rawCanvas, x1, y1, w, h, 0, 0, target.width, target.height);
          console.log("🎯 [Smart Label Zoom] 노란색 라벨 고해상도 확대 캔버스 생성 완료:", { w, h, targetW: target.width, targetH: target.height });
          return target;
        }
      }
    } catch (e) {
      console.warn("Smart label detection fallback:", e);
    }

    // 노란 라벨이 특정되지 않은 경우(금속 명판 등): 정밀 크롭 캔버스 사용
    return croppedCanvas;
  };

  // 인메모리 원터치 셔터 캡처 & Gemini 2.0 AI OCR 수행 (Storage Zero: 사진 즉시 휘발)
  const captureAndRecognize = async () => {
    setIsProcessing(true);
    setOcrProgress(5);
    setOcrStatusText("명판 프레임 순간 캡처 중...");

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

    const rawCanvas = document.createElement("canvas");
    rawCanvas.width = video.videoWidth || 1280;
    rawCanvas.height = video.videoHeight || 720;
    const ctx = rawCanvas.getContext("2d");
    if (!ctx) {
      setIsProcessing(false);
      return;
    }
    ctx.drawImage(video, 0, 0, rawCanvas.width, rawCanvas.height);

    // ROI 타겟팅 정밀 크롭 (프리뷰 및 로컬 Tesseract 보조용)
    let baseRoiW: number;
    let baseRoiH: number;

    if (guideMode === "vertical") {
      baseRoiW = rawCanvas.width * 0.58;
      baseRoiH = rawCanvas.height * 0.88;
    } else if (guideMode === "full") {
      baseRoiW = rawCanvas.width * 0.96;
      baseRoiH = rawCanvas.height * 0.94;
    } else {
      baseRoiW = rawCanvas.width * 0.92;
      baseRoiH = rawCanvas.height * 0.52;
    }

    const roiWidth = hardwareZoomSupported
      ? baseRoiW
      : Math.max(baseRoiW / zoomLevel, rawCanvas.width * 0.85);
    const roiHeight = hardwareZoomSupported
      ? baseRoiH
      : Math.max(baseRoiH / zoomLevel, rawCanvas.height * 0.38);

    const roiX = (rawCanvas.width - roiWidth) / 2;
    const roiY = (rawCanvas.height - roiHeight) / 2;

    const croppedCanvas = cropCanvasROI(
      rawCanvas,
      {
        x: Math.max(0, roiX),
        y: Math.max(0, roiY),
        width: Math.min(rawCanvas.width, roiWidth),
        height: Math.min(rawCanvas.height, roiHeight),
      },
      2.2 // 고선명 2.2배 슈퍼샘플링
    );

    const colorCanvas = croppedCanvas;

    // 1. 프리뷰 캔버스에 표시
    setOcrProgress(20);
    setOcrStatusText("⚡ 듀얼 채널(Stream A/B) 광학 획 강화 생성 중...");

    if (previewCanvasRef.current) {
      const pCtx = previewCanvasRef.current.getContext("2d");
      if (pCtx) {
        previewCanvasRef.current.width = colorCanvas.width;
        previewCanvasRef.current.height = colorCanvas.height;
        pCtx.drawImage(colorCanvas, 0, 0);
      }
    }

    // 2. Gemini 2.0 Vision AI & 고정밀 광학 OCR 심층 실행
    setOcrProgress(45);
    setOcrStatusText("🤖 Gemini 2.0 Vision AI 라벨 확대 & 시리얼 분석 중...");

    let targetCanvas: HTMLCanvasElement = rawCanvas;

    try {
      // 🎯 스마트 라벨 오토 타겟팅: 노란 라벨을 화면 중앙에 큼직하게 꽉 채운 고해상도 확대 캔버스 생성
      targetCanvas = getSmartTargetCanvas(rawCanvas, croppedCanvas);

      const result = await performGeminiDeepOcr(
        targetCanvas,
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
      if (targetCanvas && targetCanvas !== rawCanvas && targetCanvas !== croppedCanvas) {
        disposeCanvas(targetCanvas);
      }

      setOcrProgress(100);
      setIsProcessing(false);
    }
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
            <div className="w-full h-full overflow-hidden flex items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                muted
                className="w-full h-full object-cover transition-transform duration-200 ease-out"
                style={{ transform: `scale(${zoomLevel})` }}
              />
            </div>

            {/* Quick Digital Zoom Control (1x / 2x / 3x 원터치 정밀 확대) */}
            <div className="absolute bottom-2.5 left-2.5 z-10 flex items-center gap-1 bg-slate-900/85 backdrop-blur-md p-1 rounded-xl border border-cyan-500/40 shadow-glow-cyan">
              {[1, 2, 3].map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => handleZoomChange(z as 1 | 2 | 3)}
                  className={`px-2 py-0.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                    zoomLevel === z
                      ? "bg-cyan-500 text-slate-950 shadow-glow-cyan font-extrabold"
                      : "text-slate-300 hover:text-cyan-300"
                  }`}
                  title={`${z}배 정밀 확대`}
                >
                  {z}x
                </button>
              ))}
            </div>

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
                    <span className="bg-emerald-950/90 text-emerald-300 text-[10px] font-mono font-bold px-3 py-1 rounded-full border border-emerald-500/60 shadow-glow-emerald">
                      ✓ 촬영 완료 (시리얼/품번 추출 완료)
                    </span>
                  ) : (
                    <span className="bg-slate-950/90 text-cyan-300 text-[10px] font-mono font-bold px-3 py-1 rounded-full border border-cyan-400/60 shadow-glow-cyan">
                      [ 가이드 박스에 라벨을 맞추고 아래 [촬영] 버튼을 누르세요 ]
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Camera Floating Controls (Guide, Torch, Flip) */}
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

          {/* Action Trigger Buttons (사용자가 [촬영] 버튼을 누를 때만 캡처 & 인식) */}
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
                    <span>AI 시리얼/라벨 정밀 판독 중...</span>
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4 stroke-[2.5]" />
                    <span>📸 명판/라벨 촬영 & 시리얼 인식</span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                disabled={isProcessing}
                onClick={handleRetake}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold py-3.5 px-3 rounded-xl text-xs border border-slate-700 hover:border-cyan-500 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-98"
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
                placeholder="시리얼 번호 (예: KSA7965797 또는 JHTBB-N94YW-9HGGV-78RD3-3PH23)"
                value={selectedSerial}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSelectedSerial(e.target.value.toUpperCase())
                }
                className="w-full rounded-xl bg-slate-900 border border-slate-700 px-3.5 py-2.5 pr-10 text-xs sm:text-sm font-mono font-bold text-cyan-300 tracking-wider uppercase focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 break-all"
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

            {/* Serial Candidates Pills (다중 후보 원터치 선택: 1순위 WIN 25자리 키 추천 / 2순위 PC S/N) */}
            {ocrResult && ocrResult.candidates && ocrResult.candidates.length > 0 && (
              <div className="space-y-1.5 pt-0.5">
                <span className="text-[10px] font-semibold text-slate-400">
                  인식된 시리얼 번호 목록 (터치하여 원하는 번호 즉시 선택):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {ocrResult.candidates.map((cand, idx) => {
                    const isWinKey = /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(cand);
                    const isPcSsn = /^KSA[0-9]{6,10}$/i.test(cand);
                    const isDateSerial = /^[0-9]{6}-[0-9]{1,4}$/.test(cand);
                    const isConTag = /^CON-[A-Z0-9]+$/i.test(cand);

                    const labelBadge = isWinKey
                      ? "WIN11 25자리 키"
                      : isPcSsn
                      ? "PC S/N"
                      : isDateSerial
                      ? "S/N 일련번호"
                      : isConTag
                      ? "모듈 태그"
                      : `번호 ${idx + 1}`;

                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedSerial(cand)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all cursor-pointer flex items-center gap-1.5 max-w-full text-left ${
                          selectedSerial === cand
                            ? "bg-cyan-500 text-slate-950 shadow-glow-cyan font-bold ring-2 ring-cyan-300"
                            : "bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700"
                        }`}
                      >
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0 ${
                            selectedSerial === cand
                              ? "bg-slate-950 text-cyan-300"
                              : idx === 0
                              ? "bg-amber-950 text-amber-300 border border-amber-600/70 shadow-sm"
                              : idx === 1
                              ? "bg-cyan-950 text-cyan-300 border border-cyan-700/60"
                              : "bg-slate-900 text-slate-400"
                          }`}
                        >
                          {labelBadge}
                        </span>
                        <span className="break-all tracking-tight font-bold">{cand}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 📜 엔진 판독 원문 (RAW 텍스트) 실시간 확인 아코디언 */}
            {ocrResult && ocrResult.rawText && (
              <div className="rounded-xl bg-slate-900/60 border border-slate-800 p-2 text-xs">
                <button
                  type="button"
                  onClick={() => setShowRawText(!showRawText)}
                  className="w-full flex items-center justify-between text-slate-400 hover:text-cyan-300 font-mono text-[11px] font-semibold py-0.5 cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-cyan-400" />
                    <span>📜 엔진 판독 텍스트 원문 (RAW)</span>
                  </span>
                  <span className="text-[10px] text-slate-500">{showRawText ? "▲ 접기" : "▼ 펼쳐보기"}</span>
                </button>
                {showRawText && (
                  <pre className="mt-2 p-2 rounded-lg bg-slate-950 text-slate-300 font-mono text-[11px] max-h-32 overflow-y-auto whitespace-pre-wrap break-all border border-slate-800">
                    {ocrResult.rawText}
                  </pre>
                )}
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
    </div>
  );
};
