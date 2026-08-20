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
 * 인메모리 Canvas 상에서 금속 명판 전처리 파이프라인 수행
 * (스토리지 제로: 메모리 상의 ImageData 직접 조작)
 */
export function preprocessCanvas(
  sourceCanvas: HTMLCanvasElement,
  options: PreprocessingOptions = DEFAULT_PREPROCESSING_OPTIONS
): HTMLCanvasElement {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;

  // 작업용 전처리 캔버스 생성
  const processedCanvas = document.createElement("canvas");
  processedCanvas.width = width;
  processedCanvas.height = height;
  const ctx = processedCanvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) return sourceCanvas;

  // 원본 복사
  ctx.drawImage(sourceCanvas, 0, 0, width, height);

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const totalPixels = width * height;

  // 1. Grayscale 변환 (Luminance: 0.299R + 0.587G + 0.114B)
  const gray = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // 2. 대비 정규화 (Min-Max Contrast Stretching / Percentile Clipping)
  if (options.contrastStretch) {
    // 히스토그램 생성
    const hist = new Int32Array(256);
    for (let i = 0; i < totalPixels; i++) {
      hist[gray[i]]++;
    }

    // 상/하위 2% 클리핑으로 금속 난반사 억제
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
      if (accum >= (totalPixels - highCutoff)) {
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
  if (options.adaptiveThreshold) {
    const s = Math.max(3, Math.floor(options.windowSize || 21));
    const s2 = Math.floor(s / 2);
    const delta = (options.thresholdDelta || 15) / 100;

    // Integral Image (적분 영상) 생성 - O(1) 영역 평균 계산용
    // 32비트 정수 배열: width+1 x height+1
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

    // 적응형 비교
    for (let y = 0; y < height; y++) {
      const y1 = Math.max(0, y - s2);
      const y2 = Math.min(height - 1, y + s2);
      const rowOffset = y * width;

      for (let x = 0; x < width; x++) {
        const x1 = Math.max(0, x - s2);
        const x2 = Math.min(width - 1, x + s2);
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);

        // O(1) 사각형 합
        const sum =
          intImg[(y2 + 1) * stride + (x2 + 1)] -
          intImg[y1 * stride + (x2 + 1)] -
          intImg[(y2 + 1) * stride + x1] +
          intImg[y1 * stride + x1];

        const threshold = (sum / count) * (1 - delta);
        const val = gray[rowOffset + x];

        // 텍스트는 어둡고 배경은 밝게 (기본)
        gray[rowOffset + x] = val < threshold ? 0 : 255;
      }
    }
  }

  // 4. 색상 반전 (옵션)
  if (options.invert) {
    for (let i = 0; i < totalPixels; i++) {
      gray[i] = 255 - gray[i];
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
 * 관심 영역 (ROI: Region Of Interest) 크롭 캔버스 생성
 */
export function cropCanvasROI(
  sourceCanvas: HTMLCanvasElement,
  roi: { x: number; y: number; width: number; height: number }
): HTMLCanvasElement {
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = Math.max(1, Math.floor(roi.width));
  cropCanvas.height = Math.max(1, Math.floor(roi.height));
  const ctx = cropCanvas.getContext("2d", { willReadFrequently: true });

  if (ctx) {
    ctx.drawImage(
      sourceCanvas,
      roi.x,
      roi.y,
      roi.width,
      roi.height,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height
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
