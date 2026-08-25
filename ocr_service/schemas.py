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


class GeminiOcrRawResponse(BaseModel):
    """
    Strict Structured Output schema returned directly by Gemini Vision AI.
    Forces Chain-of-Thought (CoT) stroke analysis and literal character transcription.
    """
    cot_step1_region_detection: str = Field(
        description="Step 1: Spatial separation of metal nameplate engraved/printed region vs masking tape/handwritten marker region"
    )
    cot_step2_stroke_analysis: str = Field(
        description="Step 2: Literal stroke-by-stroke raw transcription without any spelling correction, dictionary lookup, or guessing"
    )
    cot_step3_character_disambiguation: List[CharacterDisambiguation] = Field(
        default_factory=list,
        description="Step 3: Disambiguation records for similar-looking characters (0 vs O/D, 1 vs I/l, 5 vs S, 8 vs B, 2 vs Z)"
    )
    printed_serial: Optional[str] = Field(
        default=None,
        description="Serial number stamped, engraved, or printed on the metal nameplate"
    )
    handwritten_serial: Optional[str] = Field(
        default=None,
        description="Serial number handwritten with marker, magic pen, or ballpoint pen on masking tape or equipment surface"
    )
    model_name: Optional[str] = Field(
        default=None,
        description="Equipment / unit model name or model number"
    )
    notes: Optional[str] = Field(
        default=None,
        description="Additional handwritten text, inspection dates, lot numbers, or special markings"
    )
    confidence_flags: List[str] = Field(
        default_factory=list,
        description="List of ambiguous, low-contrast, or uncertain characters with reason (e.g. '3rd char uncertain between 0 and O due to scratch')"
    )


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
