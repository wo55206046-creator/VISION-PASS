"""
OpenCV Image Preprocessor & Dual-Stream Generation Engine
Provides native resolution ROI cropping and dual-channel (Color Context + CLAHE/Stroke Enhanced) generation.
"""

from typing import Tuple, List, Optional, Union
import io
import cv2
import numpy as np
from PIL import Image

from .schemas import ProcessedImageStreams


class DualStreamPreprocessor:
    """
    Industrial-grade image preprocessor designed for metal nameplates (engraved/laser/stamped)
    and handwritten ink on masking tape or metallic surfaces.
    """

    def __init__(
        self,
        clahe_clip_limit: float = 3.2,
        clahe_grid_size: Tuple[int, int] = (8, 8),
        jpeg_quality: int = 95,
        max_dimension_for_full_view: int = 2400,
    ):
        self.clahe_clip_limit = clahe_clip_limit
        self.clahe_grid_size = clahe_grid_size
        self.jpeg_quality = jpeg_quality
        self.max_dimension_for_full_view = max_dimension_for_full_view
        self.clahe = cv2.createCLAHE(
            clipLimit=self.clahe_clip_limit,
            tileGridSize=self.clahe_grid_size
        )

    def load_image(self, input_source: Union[str, bytes, np.ndarray, Image.Image]) -> np.ndarray:
        """Loads and normalizes image into a BGR numpy array."""
        if isinstance(input_source, str):
            # Load from file path (supports unicode paths in Windows)
            img_array = np.fromfile(input_source, np.uint8)
            img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
            if img is None:
                raise ValueError(f"Failed to read image from path: {input_source}")
            return img

        elif isinstance(input_source, bytes):
            nparr = np.frombuffer(input_source, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                raise ValueError("Failed to decode image from raw bytes")
            return img

        elif isinstance(input_source, Image.Image):
            rgb_img = np.array(input_source)
            if len(rgb_img.shape) == 2:
                return cv2.cvtColor(rgb_img, cv2.COLOR_GRAY2BGR)
            elif rgb_img.shape[2] == 4:
                return cv2.cvtColor(rgb_img, cv2.COLOR_RGBA2BGR)
            return cv2.cvtColor(rgb_img, cv2.COLOR_RGB2BGR)

        elif isinstance(input_source, np.ndarray):
            if len(input_source.shape) == 2:
                return cv2.cvtColor(input_source, cv2.COLOR_GRAY2BGR)
            elif input_source.shape[2] == 4:
                return cv2.cvtColor(input_source, cv2.COLOR_BGRA2BGR)
            return input_source.copy()

        raise TypeError(f"Unsupported image input type: {type(input_source)}")

    def detect_text_roi(self, img_bgr: np.ndarray) -> Tuple[int, int, int, int]:
        """
        Detects bounding box containing text regions (nameplates, stickers, handwriting)
        without downsampling, using morphological gradients and connected components.
        """
        h, w = img_bgr.shape[:2]

        # Use downscaled copy purely for ROI localization speed
        scale = min(1.0, 1200.0 / max(h, w))
        small_w = max(10, int(w * scale))
        small_h = max(10, int(h * scale))
        small = cv2.resize(img_bgr, (small_w, small_h), interpolation=cv2.INTER_AREA)

        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

        # Morphological gradient to isolate text stroke edges
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        gradient = cv2.morphologyEx(gray, cv2.MORPH_GRADIENT, kernel)

        # Binarize with Otsu
        _, thresh = cv2.threshold(gradient, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)

        # Morphological close to bridge adjacent text characters horizontally
        close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 3))
        closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, close_kernel)

        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        valid_boxes = []
        min_area = (small_w * small_h) * 0.005  # At least 0.5% of image area

        for c in contours:
            area = cv2.contourArea(c)
            if area > min_area:
                bx, by, bw, bh = cv2.boundingRect(c)
                aspect = bw / float(bh)
                # Text bands usually have aspect ratio > 0.8 and not full screen
                if 0.5 <= aspect <= 20.0 and bw < small_w * 0.98 and bh < small_h * 0.98:
                    valid_boxes.append((bx, by, bw, bh))

        if not valid_boxes:
            # Fallback to center 80% if no prominent text cluster found
            pad_x = int(w * 0.05)
            pad_y = int(h * 0.05)
            return (pad_x, pad_y, w - 2 * pad_x, h - 2 * pad_y)

        # Merge bounding boxes
        min_x = min(b[0] for b in valid_boxes)
        min_y = min(b[1] for b in valid_boxes)
        max_x = max(b[0] + b[2] for b in valid_boxes)
        max_y = max(b[1] + b[3] for b in valid_boxes)

        # Map back to full high-res coordinates
        inv_scale = 1.0 / scale
        orig_x = max(0, int(min_x * inv_scale) - 30)
        orig_y = max(0, int(min_y * inv_scale) - 30)
        orig_w = min(w - orig_x, int((max_x - min_x) * inv_scale) + 60)
        orig_h = min(h - orig_y, int((max_y - min_y) * inv_scale) + 60)

        return (orig_x, orig_y, orig_w, orig_h)

    def crop_high_res_roi(self, img_bgr: np.ndarray, roi: Optional[Tuple[int, int, int, int]] = None) -> np.ndarray:
        """
        Crops target region at 100% native resolution to preserve every single micro-pixel.
        """
        if roi is None:
            roi = self.detect_text_roi(img_bgr)

        x, y, w, h = roi
        cropped = img_bgr[y:y+h, x:x+w]
        if cropped.size == 0:
            return img_bgr
        return cropped

    def generate_stream_a_color(self, crop_bgr: np.ndarray) -> np.ndarray:
        """
        Stream A: Native High-Res RGB with unsharp masking for sharp edge definition
        while retaining full color context (tape color, ink shade, metal luster).
        """
        # Unsharp masking: sharpened = 1.5 * orig - 0.5 * blurred
        gaussian = cv2.GaussianBlur(crop_bgr, (0, 0), sigmaX=2.0)
        sharpened = cv2.addWeighted(crop_bgr, 1.4, gaussian, -0.4, 0)
        return sharpened

    def generate_stream_b_enhanced(self, crop_bgr: np.ndarray) -> np.ndarray:
        """
        Stream B: CLAHE + Bilateral Filtering + Stroke/Engraving Micro-Contrast Boost.
        Extracts faint laser markings, stamped dots, and low-contrast pen strokes on specular metal.
        """
        # 1. Grayscale conversion
        gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)

        # 2. Bilateral Filter: Preserves sharp character edges while smoothing metal grain / specular noise
        denoised = cv2.bilateralFilter(gray, d=7, sigmaColor=50, sigmaSpace=50)

        # 3. CLAHE (Contrast Limited Adaptive Histogram Equalization)
        clahe_applied = self.clahe.apply(denoised)

        # 4. Morphological Top-Hat & Black-Hat to amplify both dark strokes and bright engravings
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
        tophat = cv2.morphologyEx(clahe_applied, cv2.MORPH_TOPHAT, kernel)
        blackhat = cv2.morphologyEx(clahe_applied, cv2.MORPH_BLACKHAT, kernel)

        # Combined enhancement: Base CLAHE + (Bright Engravings) - (Dark Marker Indentations)
        enhanced = cv2.add(clahe_applied, tophat)
        enhanced = cv2.subtract(enhanced, blackhat // 2)

        # 5. Normalization to full dynamic range [0, 255]
        normalized = cv2.normalize(enhanced, None, alpha=0, beta=255, norm_type=cv2.NORM_MINMAX)

        # Convert back to 3-channel for Gemini Multimodal API compatibility
        return cv2.cvtColor(normalized, cv2.COLOR_GRAY2BGR)

    def encode_image(self, img_bgr: np.ndarray) -> bytes:
        """Encodes BGR image to high-quality JPEG bytes."""
        encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality]
        success, encoded = cv2.imencode(".jpg", img_bgr, encode_params)
        if not success:
            raise RuntimeError("Failed to encode image to JPEG bytes")
        return encoded.tobytes()

    def process(
        self,
        input_source: Union[str, bytes, np.ndarray, Image.Image],
        custom_roi: Optional[Tuple[int, int, int, int]] = None
    ) -> ProcessedImageStreams:
        """
        Executes complete preprocessing pipeline:
        1. Loads image without downsampling.
        2. Detects/crops text ROI at 100% native pixel density.
        3. Generates Stream A (Color Context) and Stream B (CLAHE High-Contrast Stroke).
        4. Encodes both streams to bytes ready for Gemini Multimodal API.
        """
        img_bgr = self.load_image(input_source)
        h, w = img_bgr.shape[:2]

        # 1. Determine ROI
        roi = custom_roi if custom_roi is not None else self.detect_text_roi(img_bgr)
        crop_bgr = self.crop_high_res_roi(img_bgr, roi)

        # If crop is too small or detection was full, ensure minimum working size
        if crop_bgr.shape[0] < 50 or crop_bgr.shape[1] < 50:
            crop_bgr = img_bgr
            roi = (0, 0, w, h)

        # 2. Generate Dual Streams
        stream_a_bgr = self.generate_stream_a_color(crop_bgr)
        stream_b_bgr = self.generate_stream_b_enhanced(crop_bgr)

        # 3. Encode to JPEG bytes
        stream_a_bytes = self.encode_image(stream_a_bgr)
        stream_b_bytes = self.encode_image(stream_b_bgr)

        return ProcessedImageStreams(
            stream_a_color_bytes=stream_a_bytes,
            stream_b_enhanced_bytes=stream_b_bytes,
            roi_box=roi,
            original_dims=(w, h),
            tile_count=1,
        )
