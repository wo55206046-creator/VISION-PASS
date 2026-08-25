"""
End-to-End Industrial OCR Pipeline Orchestrator
Coordinates: Preprocessing (OpenCV Dual-Stream) -> Gemini Vision AI -> Rule-Based Post-Validator
"""

from typing import Union, Optional, Dict, Any
import time
import logging
from PIL import Image
import numpy as np

from .schemas import OcrPipelineResult
from .image_preprocessor import DualStreamPreprocessor
from .gemini_ocr_engine import GeminiOcrEngine
from .post_validator import IndustrialSerialValidator

logger = logging.getLogger("ocr_service.pipeline")


class OcrPipeline:
    """
    Main orchestrator for the 4-Stage High-Precision Industrial OCR Service:
    1. Preprocessing & Dual-Stream Generation (OpenCV)
    2. Multimodal Gemini 2.0/2.5 Vision Inference (google-genai)
    3. Structured Pydantic Output Extraction
    4. Positional Slot Disambiguation & Rule-Based Post-Processing
    """

    def __init__(
        self,
        gemini_api_key: Optional[str] = None,
        gemini_model_name: str = "gemini-2.0-flash",
        clahe_clip_limit: float = 3.2,
        known_models: Optional[list] = None,
    ):
        self.preprocessor = DualStreamPreprocessor(clahe_clip_limit=clahe_clip_limit)
        self.engine = GeminiOcrEngine(api_key=gemini_api_key, model_name=gemini_model_name)
        self.validator = IndustrialSerialValidator(known_models=known_models)

    def process(
        self,
        image_input: Union[str, bytes, np.ndarray, Image.Image],
        context: Optional[Dict[str, Any]] = None,
        override_api_key: Optional[str] = None,
    ) -> OcrPipelineResult:
        """
        Executes complete end-to-end OCR processing on an input image.

        Args:
            image_input: File path (str), raw image bytes, OpenCV numpy array, or PIL Image.
            context: Optional dictionary with 'part_name', 'spec', 'unit_no'.
            override_api_key: Optional API key override per request.

        Returns:
            OcrPipelineResult with 95%+ precision normalized serial numbers and audit trail.
        """
        start_time = time.perf_counter()

        # Step 1: Preprocessing & Dual-Stream Generation
        logger.info("Executing Stage 1: OpenCV High-Res ROI & Dual-Stream generation...")
        streams = self.preprocessor.process(image_input)

        # Step 2 & 3: Gemini Multimodal Literal Transcribe & Structured Output
        logger.info("Executing Stage 2 & 3: Gemini Multimodal Literal Transcribe with Structured Pydantic Output...")
        raw_response = self.engine.call_ocr(
            streams=streams,
            context=context,
            override_api_key=override_api_key,
        )

        # Step 4: Rule-based Positional Post-Validation & Normalization
        elapsed_ms = (time.perf_counter() - start_time) * 1000.0
        logger.info("Executing Stage 4: Rule-based positional validation and slot disambiguation...")
        result = self.validator.validate_and_normalize(
            raw_response=raw_response,
            processing_time_ms=elapsed_ms,
        )

        logger.info(
            f"OCR Pipeline complete in {elapsed_ms:.1f}ms. Primary Serial: '{result.primary_serial}' (Confidence: {result.confidence_score}%)"
        )
        return result
