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
} from "lucide-react";

interface CameraOcrModalProps {
  isOpen: boolean;
  targetPart: PartItem | null;
  unitIndex: number;
  equipmentSerial?: string;
  allUnitParts?: PartItem[];
  onClose: () => void;
  onConfirm: (partId: string, serial: string, isVerified: boolean, confidence?: number) => void;
  onSelectTargetPart?: (nextPart: PartItem) => void;
}

export const CameraOcrModal: React.FC<CameraOcrModalProps> = ({
  isOpen,
  targetPart,
  unitIndex,
  equipmentSerial,
  allUnitParts = [],
  onClose,
  onConfirm,
  onSelectTargetPart,
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

  // Canvas Refs (In-Memory Only, Zero-Storage)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const nativeFileInputRef = useRef<HTMLInputElement>(null);

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

      // 1단계 시도: QHD/Full HD 고해상도 후면 카메라 & 연속 자동초점
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 2560, min: 1280 },
            height: { ideal: 1440, min: 720 },
            advanced: [{ focusMode: "continuous" }, { exposureMode: "continuous" }] as any,
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

  // 모달 열림/닫힘 시 카메라 스트림 라이프사이클 (연속 촬영으로 targetPart가 바뀔 때는 카메라를 끄지 않고 그대로 유지!)
  useEffect(() => {
    if (isOpen) {
      startCamera();
      // 🚀 초고속 1초 시리얼 추출을 위한 백그라운드 워커 사전 로드
      getOcrWorker().catch(console.warn);
    } else {
      stopCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isOpen, facingMode]);

  // 대상 부품(targetPart)이 변경될 때 입력값 초기화 및 라이브 프리뷰 즉시 재개
  useEffect(() => {
    if (isOpen && targetPart) {
      setSelectedSerial(targetPart.detectedSerial || "");
      setIsVerifiedCheck(true);
      setOcrResult(null);
      setIsFrozen(false);
      try {
        videoRef.current?.play().catch(() => {});
      } catch {}
    }
  }, [isOpen, targetPart?.id]);

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
    } catch { }
  };



  /**
   * 🎯 스마트폰 뷰파인더(object-cover)와 100% 일치하는 가시 영역 및 가이드 박스(ROI) 정밀 추출
   * 화면 비율 차이로 인해 엉뚱한 배경이 찍히거나 노란 배선에 오작동하던 문제를 완전히 해결
   */
  const extractViewfinderCanvases = (
    video: HTMLVideoElement
  ): { roiCanvas: HTMLCanvasElement; visibleFullCanvas: HTMLCanvasElement } => {
    const vw = video.videoWidth || 1920;
    const vh = video.videoHeight || 1080;
    const boxW = video.clientWidth || vw;
    const boxH = video.clientHeight || vh;

    // 1. object-cover 에 의해 실제 화면에 보이는 비디오 영역 계산
    const videoAspect = vw / vh;
    const boxAspect = boxW / boxH;

    let visibleW = vw;
    let visibleH = vh;
    let offsetX = 0;
    let offsetY = 0;

    if (videoAspect > boxAspect) {
      // 비디오가 더 넓은 경우: 좌우가 잘림
      visibleW = vh * boxAspect;
      offsetX = (vw - visibleW) / 2;
    } else {
      // 비디오가 더 높은 경우: 상하가 잘림
      visibleH = vw / boxAspect;
      offsetY = (vh - visibleH) / 2;
    }

    // 디지털 줌(scale)이 적용된 경우 중앙 기준으로 한 번 더 좁혀줌
    if (!hardwareZoomSupported && zoomLevel > 1) {
      const zoomedW = visibleW / zoomLevel;
      const zoomedH = visibleH / zoomLevel;
      offsetX += (visibleW - zoomedW) / 2;
      offsetY += (visibleH - zoomedH) / 2;
      visibleW = zoomedW;
      visibleH = zoomedH;
    }

    // 가시 전체 프레임 캔버스 생성 (가이드 박스를 살짝 벗어난 긴 시리얼 보조 판독용)
    const visibleFullCanvas = document.createElement("canvas");
    const fullTargetW = Math.min(1920, Math.max(1280, Math.round(visibleW)));
    const fullTargetH = Math.round(fullTargetW * (visibleH / visibleW));
    visibleFullCanvas.width = fullTargetW;
    visibleFullCanvas.height = fullTargetH;
    const fCtx = visibleFullCanvas.getContext("2d");
    if (fCtx) {
      fCtx.imageSmoothingEnabled = true;
      fCtx.imageSmoothingQuality = "high";
      fCtx.drawImage(video, offsetX, offsetY, visibleW, visibleH, 0, 0, fullTargetW, fullTargetH);
    }

    // 2. 가이드 박스(horizontal / vertical / full) 비율에 맞춘 정밀 ROI 크롭 (여유 마진 포함)
    let guideWFactor = 0.96;
    let guideHFactor = 0.56;
    if (guideMode === "vertical") {
      guideWFactor = 0.66;
      guideHFactor = 0.90;
    } else if (guideMode === "full") {
      guideWFactor = 0.98;
      guideHFactor = 0.96;
    }

    const roiW = visibleW * guideWFactor;
    const roiH = visibleH * guideHFactor;
    const roiX = offsetX + (visibleW - roiW) / 2;
    const roiY = offsetY + (visibleH - roiH) / 2;

    const roiCanvas = document.createElement("canvas");
    const targetRoiW = Math.min(2048, Math.max(1280, Math.round(roiW * 1.8)));
    const targetRoiH = Math.round(targetRoiW * (roiH / roiW));
    roiCanvas.width = targetRoiW;
    roiCanvas.height = targetRoiH;
    const rCtx = roiCanvas.getContext("2d");
    if (rCtx) {
      rCtx.imageSmoothingEnabled = true;
      rCtx.imageSmoothingQuality = "high";
      rCtx.drawImage(video, roiX, roiY, roiW, roiH, 0, 0, targetRoiW, targetRoiH);
    }

    return { roiCanvas, visibleFullCanvas };
  };

  // 스마트폰 기본 카메라 촬영 또는 고화질 사진 파일 선택 시 즉시 AI OCR 수행
  const handleNativePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setOcrProgress(10);
    setOcrStatusText("고화질 사진 로드 및 시리얼 정밀 분석 중...");

    let imgCanvas: HTMLCanvasElement | null = null;
    try {
      const bitmap = await createImageBitmap(file);
      imgCanvas = document.createElement("canvas");
      const maxDim = 2200;
      let w = bitmap.width;
      let h = bitmap.height;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      imgCanvas.width = w;
      imgCanvas.height = h;
      const ctx = imgCanvas.getContext("2d");
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, w, h);
      }

      const result = await performGeminiDeepOcr(
        imgCanvas,
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
        triggerScanFeedback();
      } else {
        setSelectedSerial("");
      }
    } catch (err) {
      console.error("Native photo OCR error:", err);
      setHasCameraError("사진 분석 중 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      if (imgCanvas) disposeCanvas(imgCanvas);
      if (nativeFileInputRef.current) nativeFileInputRef.current.value = "";
      setOcrProgress(100);
      setIsProcessing(false);
    }
  };

  // 인메모리 원터치 셔터 캡처 & Gemini Flash Vision AI OCR 수행 (Storage Zero: 사진 즉시 휘발)
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
    } catch { }

    const { roiCanvas, visibleFullCanvas } = extractViewfinderCanvases(video);

    // 1. 프리뷰 캔버스에 표시
    setOcrProgress(20);
    setOcrStatusText("⚡ 고선명 샤프닝 및 빛 반사 보정 이미지 생성 중...");

    if (previewCanvasRef.current) {
      const pCtx = previewCanvasRef.current.getContext("2d");
      if (pCtx) {
        previewCanvasRef.current.width = roiCanvas.width;
        previewCanvasRef.current.height = roiCanvas.height;
        pCtx.drawImage(roiCanvas, 0, 0);
      }
    }

    // 2. Gemini Flash Vision AI & 고정밀 광학 OCR 심층 실행
    setOcrProgress(40);
    setOcrStatusText("🤖 Gemini Flash Vision AI 명판 시리얼 정밀 판독 중...");

    try {
      const result = await performGeminiDeepOcr(
        roiCanvas,
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
          : undefined,
        visibleFullCanvas
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
      disposeCanvas(roiCanvas);
      disposeCanvas(visibleFullCanvas);

      setOcrProgress(100);
      setIsProcessing(false);
    }
  };

  // 현재 호기 내 동일 시리얼 중복 여부 검사
  const normalizedSelected = selectedSerial.trim().toUpperCase();
  const duplicatePartIndex =
    normalizedSelected.length >= 3 && targetPart
      ? allUnitParts.findIndex(
          (p) =>
            p.id !== targetPart.id &&
            p.detectedSerial &&
            p.detectedSerial.trim().toUpperCase() === normalizedSelected
        )
      : -1;
  const duplicatePart = duplicatePartIndex >= 0 ? allUnitParts[duplicatePartIndex] : null;

  // 현재 부품 다음 순서의 미검증 부품 탐색 (연속 촬영용)
  const currentPartIdx = targetPart ? allUnitParts.findIndex((p) => p.id === targetPart.id) : -1;
  const nextUnverifiedPart: PartItem | null = (() => {
    if (!targetPart || allUnitParts.length <= 1) return null;
    const startIdx = currentPartIdx >= 0 ? currentPartIdx + 1 : 0;
    for (let offset = 0; offset < allUnitParts.length; offset++) {
      const idx = (startIdx + offset) % allUnitParts.length;
      const cand = allUnitParts[idx];
      if (cand && cand.id !== targetPart.id && (!cand.isVerified || !cand.detectedSerial?.trim())) {
        return cand;
      }
    }
    return null;
  })();
  const nextPartNumber = nextUnverifiedPart
    ? allUnitParts.findIndex((p) => p.id === nextUnverifiedPart.id) + 1
    : 0;

  // 최종 저장 & 창 닫기
  const handleSave = () => {
    if (!targetPart) return;
    onConfirm(targetPart.id, selectedSerial.trim(), isVerifiedCheck, ocrResult?.confidence);
    onClose();
  };

  // 저장 후 카메라를 끄지 않고 곧바로 다음 미검증 부품으로 연속 이동
  const handleSaveAndNext = () => {
    if (!targetPart) return;
    onConfirm(targetPart.id, selectedSerial.trim(), isVerifiedCheck, ocrResult?.confidence);
    if (nextUnverifiedPart && onSelectTargetPart) {
      onSelectTargetPart(nextUnverifiedPart);
    } else {
      onClose();
    }
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
                  className={`px-2 py-0.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${zoomLevel === z
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
                className={`relative border-2 border-cyan-400/90 rounded-xl shadow-glow-cyan transition-all duration-300 ${guideMode === "vertical"
                    ? "w-[58%] h-[84%]"
                    : guideMode === "full"
                      ? "w-[96%] h-[92%]"
                      : "w-[94%] h-[48%]"
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
                className={`p-2 rounded-xl backdrop-blur-md border text-xs transition-all cursor-pointer ${torchOn
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

          {/* Action Trigger Buttons (사용자가 [촬영] 버튼을 누를 때만 캡처 & 인식 + 초근접 고화질 사진 선택 지원) */}
          <input
            ref={nativeFileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleNativePhotoUpload}
            className="hidden"
          />
          <div className="flex gap-2">
            {!isFrozen ? (
              <>
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
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => nativeFileInputRef.current?.click()}
                  className="bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/40 font-bold py-3.5 px-3 rounded-xl text-xs transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0 active:scale-98"
                  title="초소형 글씨나 접사가 필요할 때 스마트폰 기본 고화질 카메라로 촬영"
                >
                  <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                  <span>고화질 접사</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleRetake}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold py-3.5 px-3 rounded-xl text-xs border border-slate-700 hover:border-cyan-500 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-98"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>🔄 다시 촬영하기</span>
                </button>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => nativeFileInputRef.current?.click()}
                  className="bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/40 font-bold py-3.5 px-3 rounded-xl text-xs transition-all flex items-center justify-center gap-1 cursor-pointer shrink-0 active:scale-98"
                  title="스마트폰 기본 고화질 카메라로 다시 촬영"
                >
                  <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                  <span>고화질 접사</span>
                </button>
              </>
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
              <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5 flex-wrap">
                <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                <span>추출된 시리얼 번호 (최종 확인 및 수정)</span>
                {ocrResult?.detectedLabel && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-500/60 font-extrabold shadow-glow-cyan">
                    [{ocrResult.detectedLabel} 기준 추출]
                  </span>
                )}
              </label>
              {ocrResult?.confidence !== undefined && ocrResult.cleanedSerial && (
                <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-500/40 font-bold shrink-0">
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
                placeholder="시리얼 번호 (예: KSA7965797 또는 230600231746059-A)"
                value={selectedSerial}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSelectedSerial(e.target.value.toUpperCase())
                }
                className={`w-full rounded-xl bg-slate-900 border px-3.5 py-2.5 pr-10 text-xs sm:text-sm font-mono font-bold tracking-wider uppercase focus:outline-none focus:ring-2 break-all ${
                  duplicatePart
                    ? "border-amber-500 text-amber-300 focus:border-amber-400 focus:ring-amber-500/30"
                    : "border-slate-700 text-cyan-300 focus:border-cyan-400 focus:ring-cyan-500/30"
                }`}
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

            {/* 동일 호기 내 시리얼 중복 촬영 경고 배너 */}
            {duplicatePart && (
              <div className="rounded-xl bg-amber-950/85 border border-amber-500/80 px-3 py-2 flex items-center gap-2 text-amber-200 animate-fadeIn">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <p className="text-[11px] font-bold leading-snug">
                  ⚠️ 중복 주의: 이 시리얼 번호는 이미{" "}
                  <span className="text-amber-300 underline font-extrabold">
                    #{duplicatePartIndex + 1} {duplicatePart.partName}
                  </span>
                  에 입력되어 있습니다!
                </p>
              </div>
            )}

            {/* Serial Candidates Pills (다중 후보 원터치 선택: 라벨 기준 명칭 표시) */}
            {ocrResult && ocrResult.candidates && ocrResult.candidates.length > 0 && (
              <div className="space-y-1.5 pt-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-400">
                    인식된 시리얼 번호 목록 (라벨 기준 판독 완료):
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    총 {ocrResult.candidates.length}개 검출
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ocrResult.candidates.map((cand, idx) => {
                    const detail = ocrResult.candidateDetails?.find((d) => d.serial === cand);
                    const sourceLabel = detail?.sourceLabel || (
                      /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(cand)
                        ? "WIN11 S/N"
                        : /^KSA[0-9]{6,10}$/i.test(cand)
                          ? "PC S/N"
                          : /^[0-9]{6,14}$/.test(cand)
                            ? "SN"
                            : cand.includes("-")
                              ? "S/N"
                              : "SN"
                    );

                    const isWin = sourceLabel.includes("WIN");
                    const isPn = sourceLabel.includes("P/N");
                    const isBarcode = sourceLabel === "BARCODE";
                    const isSn = sourceLabel === "SN" || sourceLabel === "S/N" || sourceLabel === "SERIAL";

                    const badgeStyle = selectedSerial === cand
                      ? "bg-slate-950 text-cyan-300 font-black ring-1 ring-cyan-400"
                      : isWin
                        ? "bg-amber-950 text-amber-300 border border-amber-600/70 shadow-sm"
                        : isPn
                          ? "bg-blue-950 text-blue-300 border border-blue-600/70"
                          : isBarcode
                            ? "bg-purple-950 text-purple-300 border border-purple-600/70"
                            : isSn
                              ? "bg-cyan-950 text-cyan-300 border border-cyan-600/70 shadow-glow-cyan"
                              : "bg-slate-900 text-slate-300 border border-slate-700";

                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedSerial(cand)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all cursor-pointer flex items-center gap-1.5 max-w-full text-left ${selectedSerial === cand
                            ? "bg-cyan-500 text-slate-950 shadow-glow-cyan font-bold ring-2 ring-cyan-300"
                            : "bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700"
                          }`}
                      >
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-black shrink-0 ${badgeStyle}`}>
                          {sourceLabel}
                        </span>
                        <span className="break-all tracking-tight font-bold">{cand}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Verification Checkbox & Main Confirm Buttons */}
            <div className="pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
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

              <div className="flex items-center gap-1.5 ml-auto">
                {/* 🚀 [시리얼 확정 및 저장] 버튼 */}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!selectedSerial.trim()}
                  className="inline-flex items-center justify-center gap-1 rounded-xl bg-slate-800 hover:bg-slate-700 border border-emerald-500/50 px-3 py-2.5 text-xs font-extrabold text-emerald-300 disabled:opacity-40 transition-all cursor-pointer shrink-0 whitespace-nowrap"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 stroke-[2.5] shrink-0" />
                  <span>저장 후 닫기</span>
                </button>

                {/* 🚀 [저장 후 다음 부품 바로 촬영] 연속 스캔 버튼 */}
                {nextUnverifiedPart && onSelectTargetPart ? (
                  <button
                    type="button"
                    onClick={handleSaveAndNext}
                    disabled={!selectedSerial.trim()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-3.5 py-2.5 text-xs font-extrabold text-slate-950 hover:brightness-110 disabled:opacity-40 shadow-glow-emerald transition-all cursor-pointer shrink-0 whitespace-nowrap"
                    title={`저장 후 #${nextPartNumber} ${nextUnverifiedPart.partName} 연속 촬영`}
                  >
                    <span>저장 후 다음 촬영 (#{nextPartNumber}) ➔</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!selectedSerial.trim()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2.5 text-xs font-extrabold text-slate-950 hover:brightness-110 disabled:opacity-40 shadow-glow-emerald transition-all cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    <CheckCircle2 className="h-4 w-4 stroke-[2.5] shrink-0" />
                    <span>시리얼 확정 및 저장</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
