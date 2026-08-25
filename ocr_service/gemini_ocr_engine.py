"""
Google GenAI Multimodal OCR Engine with Literal Transcribe Mode & Strict Structured Output
Utilizes official modern google-genai SDK with dual-stream cross-visual analysis.
"""

from typing import Optional, Dict, Any, Union
import os
import json
import logging
from pydantic import ValidationError

from .schemas import GeminiOcrRawResponse, ProcessedImageStreams

logger = logging.getLogger("ocr_service.gemini_engine")

SYSTEM_INSTRUCTION = """당신은 반도체, 디스플레이, 중공업 제조 설비의 금속 명판(각인, 레이저 마킹, 타각, 인쇄) 및 마스킹 테이프/금속 표면의 수기(매직, 네임펜, 볼펜) 시리얼 번호를 판독하는 최고 등급의 산업용 초정밀 광학 판독 AI입니다.

[핵심 판독 원칙: 리터럴 픽셀 복사(Literal Pixel Copy Mode)]
1. 절대 규칙: 일반적인 영어 단어 사전, 단어 자동완성, 문맥적 철자 교정을 완전히 차단하십시오. 오직 이미지 픽셀에 물리적으로 존재하는 획(Stroke)과 각인 홈만을 있는 그대로 전사하십시오.
2. 하이픈(-), 슬래시(/), 언더바(_), 마침표(.), 공백은 이미지에 획이 명확할 때만 그대로 보존하고, 없는 기호를 임의로 삽입하거나 생략하지 마십시오.
3. Dual-Stream 교차 검증:
   - 첨부 이미지 1 (Stream A: 고화질 컬러): 테이프 색상, 마커 잉크 농도, 표면 반사광과 실제 잉크 구분에 사용하십시오.
   - 첨부 이미지 2 (Stream B: CLAHE 고대비 획 강화): 금속 음각/타각의 미세 홈, 레이저 도트 핀 각인, 저대비 흐린 펜 획의 경계선 분석에 사용하십시오.

[4단계 CoT (Chain-of-Thought) 판독 절차]
- 1단계 (영역 분리 식별): 이미지 내에서 금속 명판 인쇄/각인 영역과 수기(Handwritten) 테이프/마킹 영역의 위치와 특징을 명확히 분리하십시오.
- 2단계 (획 단위 리터럴 전사): 각 영역에서 보이는 문자열을 문맥 추론 없이 획 단위로 100% 원본 그대로 전사(Raw Transcribe)하십시오.
- 3단계 (유사 문자 정밀 분별 - Disambiguation):
  * 0 (숫자 영) vs O (영문 오) vs D (영문 디): 내부 사선, 세로로 긴 타원 여부, 좌측 수직 기둥 여부 확인.
  * 1 (숫자 일) vs I (영문 대문자 아이) vs l (영문 소문자 엘) vs | (수직선/구분선): 상단 갈고리 꺾임, 상하 수평 세리프(Serif) 유무 정밀 분석.
  * 5 (숫자 오) vs S (영문 에스): 상단 수평 직선과 각진 모서리 vs 부드러운 이중 곡선 확인.
  * 8 (숫자 팔) vs B (영문 비): 좌측 수직 기둥의 연속성 vs 상하 대칭 폐곡선 여부 확인.
  * 2 (숫자 이) vs Z (영문 제트): 상단 둥근 곡선 vs 상단 수평 직선 및 대각 꺾임 확인.
  * 6 (숫자 육) vs G (영문 지) vs b (소문자 비): 상단 개방 여부와 가로 꺾쇠 유무 확인.
- 4단계 (데이터 확정 및 신뢰도 플래그): 확정된 시리얼 번호와 모델명을 추출하고, 스크래치나 빛 반사로 인해 확신이 서지 않는 문자는 confidence_flags에 위치와 사유를 기재하십시오.
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
    ) -> GeminiOcrRawResponse:
        """
        Executes multimodal OCR inference using dual-stream input images.
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
            f"제공된 Stream A(컬러 원본)와 Stream B(CLAHE 고대비 획 강화) 이미지를 교차 분석하여 "
            f"금속 명판 각인/인쇄 시리얼, 수기 마킹 시리얼, 설비 모델명을 4단계 CoT 원칙에 따라 정밀 전사하십시오."
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
                response_schema=GeminiOcrRawResponse,
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
                    
                    if response.parsed and isinstance(response.parsed, GeminiOcrRawResponse):
                        return response.parsed
                    
                    if response.text:
                        data = json.loads(response.text)
                        return GeminiOcrRawResponse.model_validate(data)
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
