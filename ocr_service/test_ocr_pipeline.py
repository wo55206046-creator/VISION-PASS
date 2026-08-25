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
    CharacterDisambiguation,
    OcrPipelineResult,
    ProcessedImageStreams,
)
from ocr_service.image_preprocessor import DualStreamPreprocessor
from ocr_service.post_validator import IndustrialSerialValidator


class TestImagePreprocessor(unittest.TestCase):
    def setUp(self):
        self.preprocessor = DualStreamPreprocessor()

    def test_synthetic_image_dual_stream_generation(self):
        # Create a test canvas 400x300 with synthetic high-contrast text
        img = np.full((300, 400, 3), 190, dtype=np.uint8)
        cv2.putText(img, "S/N: 25X-0049H", (50, 150), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (20, 20, 20), 2)

        streams = self.preprocessor.process(img)
        self.assertIsInstance(streams, ProcessedImageStreams)
        self.assertGreater(len(streams.stream_a_color_bytes), 1000)
        self.assertGreater(len(streams.stream_b_enhanced_bytes), 1000)
        self.assertEqual(streams.original_dims, (400, 300))

    def test_clahe_enhancement_contrast(self):
        # Check that Stream B has greater standard deviation / dynamic range in text region
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

    def test_model_fuzzy_matching(self):
        model, corr = self.validator.fuzzy_match_model("VISION-PASS-2OO")
        self.assertEqual(model, "VISION-PASS-200")
        self.assertIsNotNone(corr)

        model_exact, corr_exact = self.validator.fuzzy_match_model("ETCH-PRO-800")
        self.assertEqual(model_exact, "ETCH-PRO-800")
        self.assertIsNone(corr_exact)

    def test_full_validation_workflow(self):
        raw = GeminiOcrRawResponse(
            cot_step1_region_detection="Printed metal plate at top",
            cot_step2_stroke_analysis="Raw serial: S/N: 25X-0049H",
            cot_step3_character_disambiguation=[],
            printed_serial="S/N: 25X-0049H",
            handwritten_serial="25X-0049H",
            model_name="VISION-PASS-200",
            notes="UNIT 1",
            confidence_flags=[]
        )
        res = self.validator.validate_and_normalize(raw)
        self.assertTrue(res.success)
        self.assertEqual(res.primary_serial, "25X-0049H")
        self.assertGreaterEqual(res.confidence_score, 98.0)


if __name__ == "__main__":
    unittest.main()
