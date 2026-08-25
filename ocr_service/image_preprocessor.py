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

    def get_center_guide_roi(
        self,
        img_bgr: np.ndarray,
        width_ratio: float = 0.72,
        height_ratio: float = 0.38,
    ) -> Tuple[int, int, int, int]:
        """
        Calculates the exact bounding box (x, y, w, h) of the center guide frame
        corresponding to the camera UI viewfinder box.
        Forces the model to only analyze the targeted center slot.
        """
        h, w = img_bgr.shape[:2]
        roi_w = max(10, min(w, int(w * width_ratio)))
        roi_h = max(10, min(h, int(h * height_ratio)))
        roi_x = max(0, (w - roi_w) // 2)
        roi_y = max(0, (h - roi_h) // 2)
        return (roi_x, roi_y, roi_w, roi_h)

    def crop_high_res_roi(
        self,
        img_bgr: np.ndarray,
        roi: Optional[Tuple[int, int, int, int]] = None
    ) -> np.ndarray:
        """
        Crops target center guide region at 100% native resolution to preserve every micro-pixel.
        Never sends the full image or outer peripheral regions.
        """
        if roi is None:
            roi = self.get_center_guide_roi(img_bgr)

        x, y, w, h = roi
        # Bound coordinates safely
        img_h, img_w = img_bgr.shape[:2]
        x1 = max(0, min(img_w - 1, x))
        y1 = max(0, min(img_h - 1, y))
        x2 = max(x1 + 1, min(img_w, x + w))
        y2 = max(y1 + 1, min(img_h, y + h))

        cropped = img_bgr[y1:y2, x1:x2]
        if cropped.size == 0:
            return img_bgr
        return cropped

    def generate_stream_a_color(self, crop_bgr: np.ndarray) -> np.ndarray:
        """
        Stream A: Native High-Res RGB of the center ROI with unsharp masking for sharp stroke edges
        while retaining full color context (tape color, ink shade, metal luster).
        """
        gaussian = cv2.GaussianBlur(crop_bgr, (0, 0), sigmaX=2.0)
        sharpened = cv2.addWeighted(crop_bgr, 1.4, gaussian, -0.4, 0)
        return sharpened

    def generate_stream_b_enhanced(self, crop_bgr: np.ndarray) -> np.ndarray:
        """
        Stream B: CLAHE (Contrast Limited Adaptive Histogram Equalization) + Bilateral Denoising
        + Morphological Stroke Micro-Contrast Boost on the same center ROI.
        Extracts faint pen writing, low-contrast ink, laser markings, and stamped/engraved indentations.
        """
        # 1. Grayscale conversion
        gray = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2GRAY)

        # 2. Bilateral Filter: Preserves character stroke edges while smoothing surface noise
        denoised = cv2.bilateralFilter(gray, d=7, sigmaColor=50, sigmaSpace=50)

        # 3. CLAHE adaptive contrast
        clahe_applied = self.clahe.apply(denoised)

        # 4. Morphological Top-Hat & Black-Hat to amplify stroke edges and dark indentations
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
        tophat = cv2.morphologyEx(clahe_applied, cv2.MORPH_TOPHAT, kernel)
        blackhat = cv2.morphologyEx(clahe_applied, cv2.MORPH_BLACKHAT, kernel)

        # Combined enhancement
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
        Executes complete precision center ROI preprocessing pipeline:
        1. Loads image without downsampling.
        2. Strictly crops only the central guide frame ROI at 100% native pixel density.
        3. Generates Dual-Stream:
           - Stream A: High-res native RGB cropped image.
           - Stream B: CLAHE high-contrast stroke & engraving maximized image.
        4. Encodes both streams to JPEG bytes for multimodal Gemini inference.
        """
        img_bgr = self.load_image(input_source)
        h, w = img_bgr.shape[:2]

        # 1. Determine precision center ROI
        roi = custom_roi if custom_roi is not None else self.get_center_guide_roi(img_bgr)
        crop_bgr = self.crop_high_res_roi(img_bgr, roi)

        # Ensure minimum working size
        if crop_bgr.shape[0] < 30 or crop_bgr.shape[1] < 30:
            crop_bgr = img_bgr
            roi = (0, 0, w, h)

        # 2. Generate Dual Streams from the exact cropped center ROI
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
