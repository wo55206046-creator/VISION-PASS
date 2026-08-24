import { OcrResult } from "@/types";
import { performInMemoryOcr, scanNativeBarcode } from "./ocr-worker";

const GEMINI_API_KEY_STORAGE = "VISION_PASS_GEMINI_API_KEY";

export function getGeminiApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(GEMINI_API_KEY_STORAGE) || "";
}

export function setGeminiApiKey(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GEMINI_API_KEY_STORAGE, key.trim());
}

const GEMINI_SYSTEM_PROMPT = `당신은 반도체 및 산업 설비의 금속 명판(각인/인쇄)과 수기(Handwritten) 메모 시리얼 판독 최고 전문가입니다.

[엄격한 리터럴 전사 및 오인식 방지 규칙]
1. 획(Stroke) 단위로 한 글자씩 있는 그대로 전사하십시오. 절대 요약하거나 누락하거나 임의로 변경하지 마십시오.
2. 유사 문자 철저 구분:
   - 0(숫자 영) vs O(영문 오): 주변이 숫자 위주이거나 S/N 형식이면 0으로 판정.
   - 1(숫자 일) vs I(아이) vs l(엘) vs |(바코드/수직선): 시리얼 패턴에 따라 정밀 판정.
   - 5(숫자 오) vs S(에스): 상단 수평 직선과 꺾임 확인.
   - 8(숫자 팔) vs B(비): 상하 폐곡선 확인.
3. 수기 글씨 판독: 마스킹 테이프, 포스트잇, 설비 표면에 매직/볼펜으로 적은 글씨와 한글 접두사(시리얼, 일련번호, 호기, 단품, 부품, LOT 등)를 빠짐없이 추출하십시오.
4. 바코드 아래에 인쇄된 시리얼 번호가 있다면 최우선으로 인식하십시오.

반드시 아래 JSON 형식으로만 응답하십시오:
{
  "best_serial": "가장 유력한 시리얼 번호 (예: 673644, 25X-0049H, TM1L-HK26-1007)",
  "model_name": "설비/부품 모델명 (식별 가능한 경우)",
  "manufacturer": "제조사 (식별 가능한 경우)",
  "candidates": ["후보1", "후보2", "후보3"],
  "confidence": 98,
  "source_type": "PRINTED_NAMEPLATE 또는 HANDWRITTEN_MEMO",
  "raw_text": "인식된 전체 텍스트"
}`;

/**
 * 🤖 Gemini Vision AI 심층 판독 파이프라인 (실패 시 On-Device Local OCR로 자동 페일오버)
 */
export async function performGeminiDeepOcr(
  canvas: HTMLCanvasElement,
  onProgress?: (progress: number, status: string) => void,
  context?: { partName?: string; spec?: string; subSpec?: string }
): Promise<OcrResult> {
  const apiKey = getGeminiApiKey();

  // 1. 하드웨어 가속 바코드 우선 검출 (0.005초)
  const nativeBarcode = await scanNativeBarcode(canvas);
  if (nativeBarcode) {
    onProgress?.(100, "⚡ 하드웨어 바코드 100% 즉시 인식 완료!");
    return {
      rawText: `[Barcode]: ${nativeBarcode}`,
      cleanedSerial: nativeBarcode,
      confidence: 100,
      lines: [nativeBarcode],
      candidates: [nativeBarcode],
    };
  }

  // 2. Gemini API Key가 등록되어 있는 경우 Gemini Vision AI 호출
  if (apiKey) {
    try {
      onProgress?.(40, "🤖 Gemini Vision AI 심층 획 분석 및 정밀 판독 중...");

      // Canvas -> Base64 JPEG 변환
      const base64Data = canvas.toDataURL("image/jpeg", 0.95).split(",")[1];

      const modelCandidates = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"];
      let parsed: any = null;

      for (const model of modelCandidates) {
        try {
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

          const requestBody = {
            contents: [
              {
                parts: [
                  { text: GEMINI_SYSTEM_PROMPT },
                  {
                    text: `대상 부품 정보: 품명=[${context?.partName || "-"}], 규격=[${context?.spec || "-"}]\n이 이미지에서 설비 명판 및 수기 시리얼 번호를 정밀 추출해주세요.`,
                  },
                  {
                    inline_data: {
                      mime_type: "image/jpeg",
                      data: base64Data,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.0,
              response_mime_type: "application/json",
            },
          };

          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
          });

          if (res.ok) {
            const jsonRes = await res.json();
            const rawContent = jsonRes?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (rawContent) {
              parsed = JSON.parse(rawContent);
              break;
            }
          }
        } catch (e) {
          // 다음 모델로 순차 시도
        }
      }

      if (parsed) {
        const best = (parsed.best_serial || "").trim().toUpperCase();
        const cands: string[] = Array.isArray(parsed.candidates)
          ? parsed.candidates.map((c: string) => String(c).trim().toUpperCase()).filter(Boolean)
          : [];

        if (best && !cands.includes(best)) {
          cands.unshift(best);
        }

        onProgress?.(100, "✨ Gemini AI 심층 추출 완료!");

        return {
          rawText: parsed.raw_text || JSON.stringify(parsed),
          cleanedSerial: best || (cands[0] || ""),
          confidence: parsed.confidence || 98,
          lines: (parsed.raw_text || "").split("\n"),
          candidates: cands.slice(0, 3),
        };
      }
    } catch (geminiError) {
      console.warn("Gemini API call failed, falling back to local OCR:", geminiError);
    }
  }

  // 3. API Key 미등록 또는 네트워크 실패 시: 로컬 Tesseract 5 + Barcode 엔진으로 100% 무중단 페일오버
  onProgress?.(60, "⚡ 고정밀 로컬 광학 OCR 및 분산 텍스트 분석 중...");
  return await performInMemoryOcr(canvas, onProgress, context);
}
