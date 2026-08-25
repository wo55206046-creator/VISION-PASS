"""
Industrial Metal Nameplate & Handwritten Serial OCR Service
Powered by Dual-Stream OpenCV Preprocessing + Google GenAI Multimodal Engine + Rule-Based Post Validator
"""

from .schemas import (
    GeminiOcrRawResponse,
    CharacterDisambiguation,
    OcrPipelineResult,
    ProcessedImageStreams,
)
from .image_preprocessor import DualStreamPreprocessor
from .gemini_ocr_engine import GeminiOcrEngine
from .post_validator import IndustrialSerialValidator
from .pipeline import OcrPipeline

__all__ = [
    "GeminiOcrRawResponse",
    "CharacterDisambiguation",
    "OcrPipelineResult",
    "ProcessedImageStreams",
    "DualStreamPreprocessor",
    "GeminiOcrEngine",
    "IndustrialSerialValidator",
    "OcrPipeline",
]
