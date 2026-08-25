"""
Pydantic Schemas for Gemini Structured Output and OCR Pipeline Results
"""

from typing import List, Optional, Tuple
from pydantic import BaseModel, Field


class CharacterDisambiguation(BaseModel):
    """Fine-grained stroke-level character disambiguation for confusable glyphs."""
    position: int = Field(
        description="1-based character position index in the extracted serial string"
    )
    candidate_char: str = Field(
        description="Identified character (e.g. '0', 'O', '1', 'I', '5', 'S')"
    )
    confusable_alternatives: List[str] = Field(
        default_factory=list,
        description="List of possible visual alternatives e.g. ['0', 'O', 'D'] or ['1', 'I', 'l']"
    )
    visual_evidence: str = Field(
        description="Detailed visual stroke rationale (e.g., 'Closed loop without break indicating digit 0', 'Top-left serif absent indicating letter I')"
    )


class SerialExtractionResult(BaseModel):
    """
    Strict Structured Output schema returned directly by Gemini Vision AI.
    Forces literal pixel-level transcription of characters in the center guide box
    without any arbitrary auto-swapping or dictionary word guessing.
    """
    raw_serial: str = Field(
        description="가이드 중앙 칸에서 전사한 시리얼 번호 원문 (임의 수정 금지)"
    )
    source_type: str = Field(
        default="printed",
        description="인식된 텍스트 유형: 'printed', 'handwritten', 'engraved'"
    )
    model_name: Optional[str] = Field(
        default=None,
        description="함께 식별된 모델명 (있는 경우)"
    )
    notes: Optional[str] = Field(
        default=None,
        description="수기 메모, 날짜, 특이사항"
    )
    low_confidence_chars: List[str] = Field(
        default_factory=list,
        description="획이 번지거나 훼손되어 판독 확신도가 낮은 문자 목록"
    )


# Alias for backward compatibility across modules
GeminiOcrRawResponse = SerialExtractionResult


class ProcessedImageStreams(BaseModel):
    """Dual-Stream processed images payload for multimodal inference."""
    stream_a_color_bytes: bytes = Field(description="High-resolution RGB cropped image bytes (JPEG/PNG)")
    stream_b_enhanced_bytes: bytes = Field(description="CLAHE + Denoised high-contrast stroke-enhanced image bytes (JPEG/PNG)")
    roi_box: Tuple[int, int, int, int] = Field(description="Bounding box of cropped ROI (x, y, w, h)")
    original_dims: Tuple[int, int] = Field(description="Original image dimensions (width, height)")
    tile_count: int = Field(default=1, description="Number of high-res tiles generated")

    class Config:
        arbitrary_types_allowed = True


class OcrCorrectionLog(BaseModel):
    """Audit log entry for rule-based post-validation adjustments."""
    original_value: str
    corrected_value: str
    reason: str
    rule_name: str


class OcrPipelineResult(BaseModel):
    """Final, validated and normalized OCR response produced by the pipeline."""
    success: bool = True
    primary_serial: str = Field(description="Final normalized, cleanest serial number ready for system use")
    printed_serial: Optional[str] = Field(default=None, description="Cleaned printed/engraved serial number")
    handwritten_serial: Optional[str] = Field(default=None, description="Cleaned handwritten serial number")
    model_name: Optional[str] = Field(default=None, description="Cleaned equipment model name")
    notes: Optional[str] = Field(default=None, description="Notes and extra metadata")
    confidence_score: float = Field(description="Confidence percentage (0.0 - 100.0)")
    confidence_flags: List[str] = Field(default_factory=list, description="Uncertainty warnings")
    corrections: List[OcrCorrectionLog] = Field(default_factory=list, description="Post-processing transformations applied")
    raw_gemini_output: Optional[GeminiOcrRawResponse] = None
    processing_time_ms: float = Field(default=0.0, description="Total pipeline execution time in milliseconds")
