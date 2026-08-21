import { PreprocessingOptions } from "@/types";

export const DEFAULT_PREPROCESSING_OPTIONS: PreprocessingOptions = {
  grayscale: true,
  contrastStretch: true,
  adaptiveThreshold: true,
  invert: false,
  blurReduction: true,
  windowSize: 21,
  thresholdDelta: 15,
};

/**
 * 3x3 샤프닝(Unsharp Mask) 필터 적용 (타각 및 레이저 인쇄 폰트 엣지 극대화)
 */
function applySharpenFilter(
  gray: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const output = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    const yOffset = y * width;
    const yPrev = (y - 1) * width;
    const yNext = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      const center = gray[yOffset + x];
      const top = gray[yPrev + x];
      const bottom = gray[yNext + x];
      const left = gray[yOffset + x - 1];
      const right = gray[yOffset + x + 1];

      const val = 5 * center - top - bottom - left - right;
      output[yOffset + x] = val < 0 ? 0 : val > 255 ? 255 : val;
    }
  }

  for (let x = 0; x < width; x++) {
    output[x] = gray[x];
    output[(height - 1) * width + x] = gray[(height - 1) * width + x];
  }
  for (let y = 0; y < height; y++) {
    output[y * width] = gray[y * width];
    output[y * width + width - 1] = gray[y * width + width - 1];
  }

  return output;
}

/**
 * 인메모리 Canvas 상에서 금속/라벨 명판 초정밀 전처리 파이프라인 수행
 */
export function preprocessCanvas(
  sourceCanvas: HTMLCanvasElement,
  options: PreprocessingOptions = DEFAULT_PREPROCESSING_OPTIONS
): HTMLCanvasElement {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;

  const processedCanvas = document.createElement("canvas");
  processedCanvas.width = width;
  processedCanvas.height = height;
  const ctx = processedCanvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) return sourceCanvas;

  ctx.drawImage(sourceCanvas, 0, 0, width, height);

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const totalPixels = width * height;

  // 1. Grayscale 변환 (Luminance: 0.299R + 0.587G + 0.114B)
  let gray = new Uint8Array(totalPixels);
  let graySum = 0;
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const val = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    gray[i] = val;
    graySum += val;
  }

  // 1-1. 배경 밝기 및 대비 표준편차 검사
  const mean = graySum / totalPixels;
  let varianceSum = 0;
  const step = 16;
  for (let i = 0; i < totalPixels; i += step) {
    const diff = gray[i] - mean;
    varianceSum += diff * diff;
  }
  const stdDev = Math.sqrt(varianceSum / (totalPixels / step));
  const isTooLowContrast = stdDev < 7;

  // 1-2. 다크 명판(미쓰비시 등 어두운 배경에 흰 글씨) 자동 감지 및 반전
  const shouldAutoInvert = mean < 110 || options.invert;
  if (shouldAutoInvert && !isTooLowContrast) {
    for (let i = 0; i < totalPixels; i++) {
      gray[i] = 255 - gray[i];
    }
  }

  // 1-3. 엣지 샤프닝 필터 적용
  if (!isTooLowContrast && options.blurReduction) {
    gray = applySharpenFilter(gray, width, height);
  }

  // 2. 대비 정규화 (Min-Max Contrast Stretching / Percentile Clipping)
  if (options.contrastStretch && !isTooLowContrast) {
    const hist = new Int32Array(256);
    for (let i = 0; i < totalPixels; i++) {
      hist[gray[i]]++;
    }

    const lowCutoff = Math.floor(totalPixels * 0.02);
    const highCutoff = Math.floor(totalPixels * 0.98);

    let minVal = 0;
    let maxVal = 255;
    let accum = 0;

    for (let i = 0; i < 256; i++) {
      accum += hist[i];
      if (accum >= lowCutoff) {
        minVal = i;
        break;
      }
    }

    accum = 0;
    for (let i = 255; i >= 0; i--) {
      accum += hist[i];
      if (accum >= totalPixels - highCutoff) {
        maxVal = i;
        break;
      }
    }

    const range = maxVal - minVal || 1;
    for (let i = 0; i < totalPixels; i++) {
      let val = gray[i];
      if (val < minVal) val = minVal;
      if (val > maxVal) val = maxVal;
      gray[i] = Math.round(((val - minVal) * 255) / range);
    }
  }

  // 3. 적응형 임계처리 (Adaptive Bradley-Roth Thresholding with Integral Image)
  if (options.adaptiveThreshold && !isTooLowContrast) {
    const s = Math.max(3, Math.floor(options.windowSize || 21));
    const s2 = Math.floor(s / 2);
    const delta = (options.thresholdDelta || 15) / 100;

    const intImg = new Uint32Array((width + 1) * (height + 1));
    const stride = width + 1;

    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      const grayRowOffset = y * width;
      const intRowOffset = (y + 1) * stride;
      const prevIntRowOffset = y * stride;

      for (let x = 0; x < width; x++) {
        rowSum += gray[grayRowOffset + x];
        intImg[intRowOffset + (x + 1)] = intImg[prevIntRowOffset + (x + 1)] + rowSum;
      }
    }

    for (let y = 0; y < height; y++) {
      const y1 = Math.max(0, y - s2);
      const y2 = Math.min(height - 1, y + s2);
      const rowOffset = y * width;

      for (let x = 0; x < width; x++) {
        const x1 = Math.max(0, x - s2);
        const x2 = Math.min(width - 1, x + s2);
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);

        const sum =
          intImg[(y2 + 1) * stride + (x2 + 1)] -
          intImg[y1 * stride + (x2 + 1)] -
          intImg[(y2 + 1) * stride + x1] +
          intImg[y1 * stride + x1];

        const threshold = (sum / count) * (1 - delta);
        const val = gray[rowOffset + x];

        gray[rowOffset + x] = val < threshold ? 0 : 255;
      }
    }
  }

  // ImageData로 다시 쓰기
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const v = gray[i];
    data[idx] = v;
    data[idx + 1] = v;
    data[idx + 2] = v;
    data[idx + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
  return processedCanvas;
}

/**
 * 관심 영역 (ROI) 고해상도 2.5배 업스케일링 및 고화질 크롭
 */
export function cropCanvasROI(
  sourceCanvas: HTMLCanvasElement,
  roi: { x: number; y: number; width: number; height: number },
  scale: number = 2.5
): HTMLCanvasElement {
  const targetW = Math.max(1, Math.floor(roi.width * scale));
  const targetH = Math.max(1, Math.floor(roi.height * scale));

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = targetW;
  cropCanvas.height = targetH;
  const ctx = cropCanvas.getContext("2d", { willReadFrequently: true });

  if (ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      sourceCanvas,
      roi.x,
      roi.y,
      roi.width,
      roi.height,
      0,
      0,
      targetW,
      targetH
    );
  }
  return cropCanvas;
}

/**
 * 스토리지 제로 메모리 해제 유틸리티
 */
export function disposeCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  try {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    canvas.width = 1;
    canvas.height = 1;
    canvas.remove();
  } catch {
    // ignore
  }
}

/**
 * Blob URL 즉시 폐기 유틸
 */
export function revokeUrl(url?: string | null) {
  if (url && url.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }
}
