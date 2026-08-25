"""
Unit and Integration Tests for VISION-PASS Industrial OCR Service
"""

import os
import sys
import unittest
import numpy as np
import cv2

# Ensure ocr_service is on python path
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from ocr_service.schemas import (
    GeminiOcrRawResponse,
    OcrPipelineResult,
    ProcessedImageStreams,
)
from ocr_service.image_preprocessor import DualStreamPreprocessor
from ocr_service.post_validator import IndustrialSerialValidator


class TestImagePreprocessor(unittest.TestCase):
    def setUp(self):
        self.preprocessor = DualStreamPreprocessor()

    def test_center_guide_roi_calculation(self):
        # 1000x600 image: center ROI with 72% width and 38% height
        img = np.full((600, 1000, 3), 190, dtype=np.uint8)
        roi = self.preprocessor.get_center_guide_roi(img, width_ratio=0.72, height_ratio=0.38)
        x, y, w, h = roi
        self.assertEqual(w, 720)
        self.assertEqual(h, 228)
        self.assertEqual(x, (1000 - 720) // 2)
        self.assertEqual(y, (600 - 228) // 2)

    def test_synthetic_image_dual_stream_generation(self):
        # Create a test canvas 400x300 with synthetic high-contrast text in center
        img = np.full((300, 400, 3), 190, dtype=np.uint8)
        cv2.putText(img, "S/N: WT24AB01", (80, 150), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (20, 20, 20), 2)

        streams = self.preprocessor.process(img)
        self.assertIsInstance(streams, ProcessedImageStreams)
        self.assertGreater(len(streams.stream_a_color_bytes), 500)
        self.assertGreater(len(streams.stream_b_enhanced_bytes), 500)
        self.assertEqual(streams.original_dims, (400, 300))

    def test_clahe_enhancement_contrast(self):
        gray_plate = np.full((100, 200, 3), 150, dtype=np.uint8)
        cv2.putText(gray_plate, "673644", (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (135, 135, 135), 2)
        stream_b = self.preprocessor.generate_stream_b_enhanced(gray_plate)
        self.assertEqual(stream_b.shape, (100, 200, 3))


class TestIndustrialSerialValidator(unittest.TestCase):
    def setUp(self):
        self.validator = IndustrialSerialValidator(
            known_models=["VISION-PASS-200", "ETCH-PRO-800", "TM1L-SERIES"]
        )

    def test_prefix_stripping(self):
        self.assertEqual(self.validator.clean_prefix("S/N: 25X-0049H"), "25X-0049H")
        self.assertEqual(self.validator.clean_prefix("SERIAL NO. ABC-1234"), "ABC-1234")
        self.assertEqual(self.validator.clean_prefix("시리얼 : 673644"), "673644")
        self.assertEqual(self.validator.clean_prefix("일련번호: TM1L-HK26-1007"), "TM1L-HK26-1007")

    def test_digit_slot_disambiguation(self):
        corrections = []
        # '10O7' where 'O' is surrounded by digits -> should convert to '1007'
        fixed = self.validator.disambiguate_segment_slots("TM1L-HK26-10O7", corrections)
        self.assertEqual(fixed, "TM1L-HK26-1007")
        self.assertEqual(len(corrections), 1)
        self.assertEqual(corrections[0].original_value, "O")
        self.assertEqual(corrections[0].corrected_value, "0")

    def test_digit_slot_i_to_1_disambiguation(self):
        corrections = []
        # '67364I' where 'I' is at the end of digit string -> should convert to '673641'
        fixed = self.validator.disambiguate_segment_slots("67364I", corrections)
        self.assertEqual(fixed, "673641")
        self.assertEqual(len(corrections), 1)

    def test_digit_slot_s_to_5_disambiguation(self):
        corrections = []
        # '2024S8' in digit context -> '202458'
        fixed = self.validator.disambiguate_segment_slots("2024S8", corrections)
        self.assertEqual(fixed, "202458")

    def test_full_validation_workflow(self):
        raw = GeminiOcrRawResponse(
            serial_number_primary="S/N: 25X-0049H",
            confidence="high",
            ambiguous_characters=[],
            analysis_path="1단계 중앙 칸 획 식별 -> 2단계 혼동 문자 없음 -> 3단계 25X-0049H 확정"
        )
        res = self.validator.validate_and_normalize(raw)
        self.assertTrue(res.success)
        self.assertEqual(res.primary_serial, "25X-0049H")
        self.assertGreaterEqual(res.confidence_score, 95.0)


if __name__ == "__main__":
    unittest.main()
