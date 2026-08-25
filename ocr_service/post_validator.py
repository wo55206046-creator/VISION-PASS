from typing import List, Tuple, Optional, Dict, Any
import re
import logging
from .schemas import (
    SerialExtractionResult,
    GeminiOcrRawResponse,
    OcrPipelineResult,
    OcrCorrectionLog,
)

logger = logging.getLogger("ocr_service.post_validator")

# Common prefixes on metal nameplates and handwritten notes to strip
SERIAL_PREFIX_PATTERNS = [
    r"^(?:S/N|SN|SERIAL\s*NO\.?|SERIAL|SER\.NO\.?|일련번호|시리얼|NO\.?)\s*[:：\-\s]*",
    r"^(?:M/N|MODEL\s*NO\.?|MODEL|모델명|형식|TYPE)\s*[:：\-\s]*",
    r"^(?:LOT\s*NO\.?|LOT|로트번호)\s*[:：\-\s]*",
]


class IndustrialSerialValidator:
    """
    Strict Literal post-processor.
    Preserves exact pixel-transcribed characters without arbitrary auto-swaps,
    performing only prefix cleaning and confidence calculation.
    """

    def __init__(self, known_models: Optional[List[str]] = None):
        self.known_models = known_models or []

    def clean_prefix(self, text: Optional[str]) -> str:
        """Strips label prefixes like S/N:, Serial No:, Model: from string."""
        if not text:
            return ""
        cleaned = text.strip()
        for pat in SERIAL_PREFIX_PATTERNS:
            cleaned = re.sub(pat, "", cleaned, flags=re.IGNORECASE).strip()
        return cleaned

    def clean_raw_serial(self, text: Optional[str]) -> str:
        """
        Removes label prefixes and leading/trailing whitespace without altering characters.
        Preserves original letter cases, numbers, hyphens, slashes, and periods.
        """
        cleaned = self.clean_prefix(text)
        if not cleaned:
            return ""
        # Remove spaces around hyphens and slashes
        cleaned = re.sub(r"\s*-\s*", "-", cleaned)
        cleaned = re.sub(r"\s*/\s*", "/", cleaned)
        # Strip trailing/leading punctuation
        cleaned = re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", cleaned)
        return cleaned

    def calculate_confidence(
        self,
        low_confidence_chars: List[str],
        primary_serial: str,
    ) -> float:
        """
        Calculates confidence score (0.0 to 100.0) based on character clarity.
        """
        if not primary_serial:
            return 0.0

        base_score = 99.0
        # Penalty per character marked with low confidence / faint stroke
        if low_confidence_chars:
            base_score -= min(35.0, len(low_confidence_chars) * 6.0)

        # Minor penalty if extremely short
        if len(primary_serial) < 3:
            base_score -= 10.0

        return max(50.0, min(100.0, round(base_score, 1)))

    def validate_and_normalize(
        self,
        raw_response: SerialExtractionResult,
        processing_time_ms: float = 0.0,
    ) -> OcrPipelineResult:
        """
        Transforms raw Gemini OCR response into strictly literal validated result.
        100% preserves original pixel strokes without auto-swap distortion.
        """
        raw_serial = raw_response.raw_serial or ""
        cleaned_serial = self.clean_raw_serial(raw_serial)

        confidence_score = self.calculate_confidence(
            low_confidence_chars=raw_response.low_confidence_chars,
            primary_serial=cleaned_serial,
        )

        return OcrPipelineResult(
            success=bool(cleaned_serial),
            primary_serial=cleaned_serial,
            printed_serial=cleaned_serial if raw_response.source_type != "handwritten" else None,
            handwritten_serial=cleaned_serial if raw_response.source_type == "handwritten" else None,
            model_name=raw_response.model_name,
            notes=raw_response.notes,
            confidence_score=confidence_score,
            confidence_flags=raw_response.low_confidence_chars,
            corrections=[],
            raw_gemini_output=raw_response,
            processing_time_ms=processing_time_ms,
        )
