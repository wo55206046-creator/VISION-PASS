"""
Google GenAI Multimodal OCR Engine with Literal Transcribe Mode & Strict Structured Output
Utilizes official modern google-genai SDK with dual-stream cross-visual analysis.
"""

from typing import Optional, Dict, Any, Union
import os
import json
import logging
from pydantic import ValidationError

from .schemas import SerialExtractionResult, GeminiOcrRawResponse, ProcessedImageStreams

logger = logging.getLogger("ocr_service.gemini_engine")

SYSTEM_INSTRUCTION = """당신은 반도체, 디스플레이, 중공업 제조 설비의 금속 명판(타각, 레이저 각인, 인쇄) 및 마스킹 테이프/금속 표면의 수기(매직, 네임펜, 볼펜) 시리얼 번호를 판독하는 최고 등급의 산업용 초정밀 광학 판독 AI입니다.

[1. 엄격한 원문 복사 모드 (Strict Literal Transcribe Mode)]
- 임의 추론, 사전 단어 완성, 문맥적 철자 교정, 임의 문자 스왑을 완전히 차단하십시오.
- 오직 이미지 픽셀에 물리적으로 존재하는 획(Stroke)과 각인 홈만을 있는 그대로 전사(Raw Transcribe)하십시오.
- 하이픈(-), 슬래시(/), 언더바(_), 마침표(.), 공백은 이미지에 획이 명확할 때만 그대로 보존하고, 없는 기호를 임의로 삽입하거나 생략하지 마십시오.

[2. 카메라 중앙 가이드 영역 최우선 타겟팅 (Strict Center Priority)]
- 제공된 이미지는 카메라 가이드 프레임의 실제 기하학적 중앙 영역(ROI)입니다.
- 당신은 오로지 이미지 중앙의 가이드 칸 안에 명확하게 위치한 핵심 문자열만 시리얼 번호(raw_serial)로 전사해야 합니다.
- 중앙 칸 주변이나 구석의 일반 설명 라벨, 회사명 등은 무시하십시오.

[3. 유사 문자 정밀 분별 (Visual Disambiguation)]
- 0 (숫자 영) vs O (영문 오) vs D (영문 디): 세로 타원 비율, 내부 획/사선, 좌측 수직선 유무 확인.
- 1 (숫자 일) vs I (대문자 아이) vs l (소문자 엘) vs | (구분선): 상단 꺾임 훅, 상하 세리프 유무 확인.
- 5 (숫자 오) vs S (영문 에스): 상단 수평 직선과 각진 모서리 vs 부드러운 이중 곡선 확인.
- 8 (숫자 팔) vs B (영문 비): 좌측 수직 기둥 연속성 vs 상하 대칭 루프 확인.
- 2 (숫자 이) vs Z (영문 제트): 상단 둥근 곡선 vs 상단 수평선/대각 꺾임 확인.
- 획이 번지거나 훼손되어 확신도가 낮은 문자는 low_confidence_chars에 기재하십시오.

[4. Strict Pydantic JSON 출력 스키마]
반드시 아래 JSON 스키마 구조로만 응답하십시오:
{
  "raw_serial": "가이드 중앙 칸에서 전사한 시리얼 번호 원문 (임의 수정 금지)",
  "source_type": "printed" 또는 "handwritten" 또는 "engraved",
  "model_name": "함께 식별된 모델명 (있는 경우, 없으면 null)",
  "notes": "수기 메모, 날짜, 특이사항 (있는 경우, 없으면 null)",
  "low_confidence_chars": ["획이 번지거나 훼손되어 판독 확신도가 낮은 문자 목록"]
}
"""


class GeminiOcrEngine:
    """
    Multimodal Gemini OCR Engine integrating the latest google-genai SDK
    with dual-stream image inspection and Pydantic structured output.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: str = "gemini-2.0-flash",
    ):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY", "")
        self.model_name = model_name
        self._client = None
        self._init_client()

    def _init_client(self):
        """Initializes the google-genai client."""
        if not self.api_key:
            logger.warning("Gemini API key is not configured. Calls will require api_key parameter.")
            return

        try:
            from google import genai
            self._client = genai.Client(api_key=self.api_key)
            logger.info("Initialized modern google-genai Client successfully.")
        except ImportError:
            logger.warning("google-genai SDK not found. Falling back to direct HTTP or google-generativeai.")
            self._client = None

    def call_ocr(
        self,
        streams: ProcessedImageStreams,
        context: Optional[Dict[str, Any]] = None,
        override_api_key: Optional[str] = None,
    ) -> SerialExtractionResult:
        """
        Executes multimodal OCR inference using dual-stream input images with strict literal mode.
        """
        api_key = override_api_key or self.api_key
        if not api_key:
            raise ValueError(
                "Gemini API Key is required. Provide it via GEMINI_API_KEY environment variable or constructor."
            )

        context_prompt = ""
        if context:
            part_name = context.get("part_name") or context.get("partName") or "-"
            spec = context.get("spec") or "-"
            unit_no = context.get("unit_no") or context.get("unitNo") or "-"
            context_prompt = (
                f"\n[설비 보조 메타데이터 컨텍스트]\n"
                f"- 대상 품명: {part_name}\n"
                f"- 대상 규격: {spec}\n"
                f"- 대상 호기/유닛: {unit_no}\n"
                f"위 메타데이터를 참고하되, 절대 없는 글자를 만들어내지 말고 이미지의 실제 획에 근거하여 시리얼 번호를 추출하십시오.\n"
            )

        user_prompt = (
            f"{context_prompt}"
            f"제공된 중앙 ROI의 Stream A(컬러 원본)와 Stream B(CLAHE 고대비 획 강화) 이미지를 교차 분석하여 "
            f"카메라 가이드 중앙 칸 내부의 시리얼 번호를 임의 변형/치환 없이 획 그대로 정확하게 리터럴 전사하십시오."
        )

        # 1. Attempt with google-genai modern SDK
        try:
            from google import genai
            from google.genai import types

            client = self._client
            if client is None or override_api_key:
                client = genai.Client(api_key=api_key)

            contents = [
                types.Part.from_bytes(
                    data=streams.stream_a_color_bytes,
                    mime_type="image/jpeg",
                ),
                types.Part.from_bytes(
                    data=streams.stream_b_enhanced_bytes,
                    mime_type="image/jpeg",
                ),
                user_prompt,
            ]

            config = types.GenerateContentConfig(
                temperature=0.0,
                top_p=0.95,
                response_mime_type="application/json",
                response_schema=SerialExtractionResult,
                system_instruction=SYSTEM_INSTRUCTION,
            )

            # Try primary model, with fallback candidate list
            candidates = [self.model_name, "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"]
            last_err = None

            for model in dict.fromkeys(candidates):
                try:
                    response = client.models.generate_content(
                        model=model,
                        contents=contents,
                        config=config,
                    )
                    
                    if response.parsed and isinstance(response.parsed, SerialExtractionResult):
                        return response.parsed
                    
                    if response.text:
                        data = json.loads(response.text)
                        return SerialExtractionResult.model_validate(data)
                except Exception as e:
                    last_err = e
                    logger.debug(f"Model {model} failed, trying next candidate. Error: {e}")
                    continue

            if last_err:
                raise last_err

        except ImportError:
            # Fallback to direct HTTP request if google-genai is not yet installed
            return self._call_via_http_fallback(streams, user_prompt, api_key)

        raise RuntimeError("Failed to obtain structured OCR response from Gemini.")

    def _call_via_http_fallback(
        self,
        streams: ProcessedImageStreams,
        user_prompt: str,
        api_key: str,
    ) -> GeminiOcrRawResponse:
        """Direct REST HTTP fallback for environments where google-genai is pending."""
        import base64
        import urllib.request

        models = [self.model_name, "gemini-2.0-flash", "gemini-1.5-flash"]
        b64_a = base64.b64encode(streams.stream_a_color_bytes).decode("utf-8")
        b64_b = base64.b64encode(streams.stream_b_enhanced_bytes).decode("utf-8")

        payload = {
            "system_instruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
            "contents": [
                {
                    "parts": [
                        {"text": user_prompt},
                        {"inline_data": {"mime_type": "image/jpeg", "data": b64_a}},
                        {"inline_data": {"mime_type": "image/jpeg", "data": b64_b}},
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.0,
                "response_mime_type": "application/json",
            },
        }

        data_bytes = json.dumps(payload).encode("utf-8")

        for m in models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={api_key}"
            req = urllib.request.Request(
                url,
                data=data_bytes,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    if resp.status == 200:
                        body = json.loads(resp.read().decode("utf-8"))
                        text = body["candidates"][0]["content"]["parts"][0]["text"]
                        parsed_json = json.loads(text)
                        return GeminiOcrRawResponse.model_validate(parsed_json)
            except Exception as e:
                logger.warning(f"HTTP fallback with model {m} failed: {e}")
                continue

        raise RuntimeError("All Gemini HTTP fallback candidates failed.")
