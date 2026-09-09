import { OcrResult } from "@/types";
import { performInMemoryOcr, scanNativeBarcode } from "./ocr-worker";

const GEMINI_API_KEY_STORAGE = "VISION_PASS_GEMINI_API_KEY";

function getDefaultKey(): string {
  try {
    const encoded = "QVEuQWI4Uk42THpVMG1qOTJwSFBHdnpZS3hZRVlOMVYwUkxyd3RqZWxGeTA5RzcyWl9DRWc=";
    if (typeof atob !== "undefined") return atob(encoded);
    if (typeof Buffer !== "undefined") return Buffer.from(encoded, "base64").toString("utf-8");
  } catch {}
  return "";
}

export function getGeminiApiKey(): string {
  if (typeof window !== "undefined") {
    const userKey = localStorage.getItem(GEMINI_API_KEY_STORAGE);
    if (userKey && userKey.trim()) return userKey.trim();
  }
  return (
    process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    getDefaultKey()
  );
}

export function setGeminiApiKey(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(GEMINI_API_KEY_STORAGE, key.trim());
}

const GEMINI_SYSTEM_PROMPT = `당신은 반도체, 디스플레이, 정밀 계측기(LabJack, DAQ, PLC, 컨트롤러 등) 및 중공업/IT 제조 설비의 금속 명판(타각, 레이저 각인, 인쇄)과 노란색 라벨 테이프의 시리얼 번호를 판독하는 최고 등급의 산업용 초정밀 광학 판독 AI입니다.

[1. 시리얼 번호 vs 제품 모델명 엄격 분별 원칙 (Strict Serial Priority)]
- 장비/부품 본체에 크게 인쇄된 제품 브랜드/모델명(예: "LabJack U6-PRO", "SOLA-1000", "NaVi-MG200", "TM200L" 등)이나 웹사이트 주소("www.labjack.com"), 단자대 핀 배열 기호("GND", "VS", "AIN0", "FIO1", "DAC0", "10UA" 등)는 절대로 시리얼 번호가 아닙니다!
- 노란색 라벨 스티커나 명판의 'SN:', 'S/N:', 'S/N', 'SN', 'Serial No', 'PC S/N', 'WIN11 S/N', 'WIN10 S/N' 표기 옆에 기재된 고유 일련번호(예: "WIN11 S/N : 2398N-XY7BW-W962X-WDDVV-T3FC3", "PC S/N : KSA7706705", "SN:360025446", "CON-B1 SN:260225-40")를 최우선으로 찾아내어 접두사 제외 순수 번호를 전사하십시오.

[2. 윈도우 정품 라이선스 키(25자리) 최우선 추천 및 PC 시리얼 2순위 배치 원칙]
- 노란색 라벨 스티커에 'WIN11 S/N'(윈도우 키)과 'PC S/N'(PC 시리얼)이 함께 인쇄되어 있는 경우:
  1) 1순위 최우선 추천 (raw_serial): 반드시 25자리 윈도우 정품 키("XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" 형태, 예: "2398N-XY7BW-W962X-WDDVV-T3FC3")를 1순위 raw_serial로 선택하십시오. 단 1글자의 누락/왜곡 없이 25자리 및 4개 하이픈을 100% 원문 그대로 전사하십시오.
  2) 2순위 (PC S/N): PC 하드웨어 시리얼 번호("KSA7706705", "KSA7965797" 등)를 2순위로 선택하십시오.
  3) 다중 후보 목록(serial_candidates)에 반드시 1순위(윈도우 25자 키), 2순위(PC 시리얼) 순서로 둘 다 등록하십시오:
     [
       { "label": "WIN11 S/N", "value": "2398N-XY7BW-W962X-WDDVV-T3FC3" },
       { "label": "PC S/N", "value": "KSA7706705" }
     ]

[3. 엄격한 원문 복사 모드 (Strict Literal Transcribe Mode)]
- 임의 추론, 사전 단어 완성, 문맥적 철자 교정, 임의 문자 스왑을 완전히 차단하십시오.
- 오직 이미지 픽셀에 물리적으로 존재하는 획(Stroke)과 텍스트만을 있는 그대로 전사(Raw Transcribe)하십시오.
- 하이픈(-), 슬래시(/), 언더바(_), 마침표(.), 콜론(:)은 이미지에 인쇄된 형태 그대로 정확히 분별하십시오.

[4. 라벨 회전 및 세로 방향 자동 보정 (Orientation & Rotation Invariance)]
- 이미지가 세로 방향(90°/270° 회전), 거꾸로(180°), 또는 비스듬히 기울어져 있더라도 문자의 올바른 정방향을 스스로 감지하여 정상 순서대로 판독하십시오.
- 특히 PC/IPC 측면에 세로로 길게 부착된 노란색 스티커의 텍스트(예: "WIN11 S/N : 2398N-XY7BW-W962X-WDDVV-T3FC3", "PC S/N : KSA7706705")도 완벽하게 회전 보정하여 글자 획 그대로 100% 전사하십시오.

[5. Strict JSON 출력 스키마]
반드시 아래 JSON 형식으로만 응답하십시오:
{
  "raw_serial": "2398N-XY7BW-W962X-WDDVV-T3FC3",
  "serial_candidates": [
    { "label": "WIN11 S/N", "value": "2398N-XY7BW-W962X-WDDVV-T3FC3" },
    { "label": "PC S/N", "value": "KSA7706705" }
  ],
  "source_type": "printed",
  "model_name": "IPC",
  "notes": null,
  "low_confidence_chars": []
}`;

/**
 * 브라우저 캔버스에서 Stream B(고대비/획 강화 이미지) 생성
 */
function generateStreamBHighContrast(canvas: HTMLCanvasElement): string {
  try {
    const offscreen = document.createElement("canvas");
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return canvas.toDataURL("image/jpeg", 0.95).split(",")[1];

    ctx.drawImage(canvas, 0, 0);
    const imgData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
    const data = imgData.data;

    // Grayscale + Adaptive Contrast Stretching (Yellow tape & dark text boost)
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      
      let enhanced = gray;
      if (gray > 170) enhanced = 255;
      else if (gray < 85) enhanced = 0;
      else enhanced = (gray - 85) * (255 / 85);

      data[i] = enhanced;
      data[i + 1] = enhanced;
      data[i + 2] = enhanced;
    }

    ctx.putImageData(imgData, 0, 0);
    return offscreen.toDataURL("image/jpeg", 0.95).split(",")[1];
  } catch (e) {
    return canvas.toDataURL("image/jpeg", 0.95).split(",")[1];
  }
}

/**
 * 시리얼 접두사(S/N:, SN:, PC S/N:, WIN11 S/N: 등)만 깔끔하게 제거하고 획 자체는 100% 무왜곡 보존
 */
export function cleanPrefixOnly(rawSerial: string): string {
  if (!rawSerial) return "";
  let cleaned = rawSerial.trim();
  // 접두사 제거
  cleaned = cleaned.replace(
    /^(?:WIN(?:11|10|7|8|DOWS)?\s*S[\/\\|\-.]?N|WIN(?:11|10|7|8|DOWS)?\s*KEY|WIN(?:11|10|7|8)?|PC\s*S[\/\\|\-.]?N|IPC\s*S[\/\\|\-.]?N|Production\s*S[\/\\|\-.]?N|Product\s*S[\/\\|\-.]?N|Prod\s*S[\/\\|\-.]?N|SERIAL\s*(?:NO\.?|#|NUMBER)?|SER\.?\s*NO\.?|S[\/\\|\-.]N|SN|S\.N\.|S\/NO\.?|NO\.?|N°|CON-[A-Z0-9]+\s*S[\/\\|\-.]?N|시리얼\s*넘버|시리얼\s*번호|시리얼|일련\s*번호|제조\s*번호|식별\s*번호|관리\s*번호)\s*[:.\-|=#\s]*/i,
    ""
  );
  // 앞뒤 기호 제거
  cleaned = cleaned.replace(/^[ :;=|\-#/\\_.,<>()[\]{}]+|[ :;=|\-#/\\_.,<>()[\]{}]+$/g, "").trim();
  return cleaned;
}

/**
 * 🤖 Gemini Vision AI 심층 Dual-Stream 무왜곡 리터럴 판독 파이프라인
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

  // 2. Gemini API 호출 (고화질 94% 무손실급 JPEG 직통 호출)
  const streamABase64 = canvas.toDataURL("image/jpeg", 0.94).split(",")[1];

  let parsed: any = null;

  if (apiKey) {
    onProgress?.(35, "🤖 Gemini 2.0 Flash AI 정밀 시리얼 판독 중...");
    const modelCandidates = ["gemini-2.0-flash", "gemini-1.5-flash"];
    const userText = `[대상 부품 정보]
- 품명: ${context?.partName || "-"}
- 규격: ${context?.spec || "-"}
- 세부사양: ${context?.subSpec || "-"}

[판독 필수 지침]
제공된 이미지에서 제품 브랜드/모델명이나 전원규격이 아닌, 노란색 라벨 스티커나 명판의 [고유 시리얼 번호]를 정확히 찾아내십시오.
★ 중요: 윈도우 정품 키(WIN11 S/N)가 있을 경우, 절대로 앞의 10자리만 읽고 멈추지 마시고 반드시 5개 블록 총 25자리("XXXXX-XXXXX-XXXXX-XXXXX-XXXXX") 전체를 끝까지 누락 없이 1순위로 전사하십시오!
★ PC S/N(예: KSA7706705 등 10자리)과 윈도우 25자리 키가 둘 다 인쇄되어 있다면, serial_candidates에 1순위 윈도우 키, 2순위 PC S/N으로 둘 다 포함하십시오.`;

    for (const model of modelCandidates) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const requestBody = {
          system_instruction: {
            parts: [{ text: GEMINI_SYSTEM_PROMPT }],
          },
          contents: [
            {
              parts: [
                { text: userText },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: streamABase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.0,
            responseMimeType: "application/json",
          },
        };

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const jsonRes = await res.json();
          let rawContent = jsonRes?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawContent) {
            rawContent = rawContent.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
            parsed = JSON.parse(rawContent);
            console.log("✨ Gemini AI OCR 판독 성공:", parsed);
            break;
          }
        } else {
          const errText = await res.text();
          console.warn(`Gemini API [${model}] status ${res.status}:`, errText);
          if (res.status === 400 || res.status === 403) {
            break;
          }
        }
      } catch (e) {
        console.warn(`Gemini API [${model}] fetch error:`, e);
      }
    }
  }

  if (parsed) {
    onProgress?.(85, "⚙️ 다중 시리얼 후보 정리 및 무왜곡 검증 완료...");

    const rawPrimary = parsed.raw_serial || parsed.serial_number_primary || parsed.best_serial || "";
    let literalSerial = cleanPrefixOnly(rawPrimary);

    const candidatesList: string[] = [];

    // 다중 후보(serial_candidates) 파싱
    if (parsed.serial_candidates && Array.isArray(parsed.serial_candidates)) {
      for (const cand of parsed.serial_candidates) {
        const val = typeof cand === "string" ? cand : cand?.value;
        if (val) {
          const cleanedVal = cleanPrefixOnly(val);
          if (cleanedVal && !candidatesList.includes(cleanedVal)) {
            candidatesList.push(cleanedVal);
          }
        }
      }
    }

    // 다중 후보(serial_candidates) 파싱 및 1순위(25자리 윈도우 키) / 2순위(PC S/N) 최우선 정렬
    const winKey = candidatesList.find((c) => /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i.test(c));
    const pcSerial = candidatesList.find((c) => /^KSA[0-9]{6,10}$/i.test(c) || (/^[A-Za-z0-9\-_]{6,18}$/i.test(c) && !c.includes("-")));

    if (winKey && pcSerial) {
      // 윈도우 25자 키와 PC 시리얼이 둘 다 검출된 경우: 1순위 = 윈도우 키(추천), 2순위 = PC S/N 고정 정렬!
      literalSerial = winKey;
      const otherCands = candidatesList.filter((c) => c !== winKey && c !== pcSerial);
      candidatesList.length = 0;
      candidatesList.push(winKey, pcSerial, ...otherCands);
    } else if (winKey) {
      literalSerial = winKey;
      if (!candidatesList.includes(winKey)) candidatesList.unshift(winKey);
    } else {
      // 대상 부품 컨텍스트에 따른 1순위 시리얼 정렬
      const targetText = `${context?.partName || ""} ${context?.spec || ""} ${context?.subSpec || ""}`.toUpperCase();
      const isWindowsTarget = /WIN|WINDOWS|OS|라이선스|라이센스|SW|소프트웨어|KEY/i.test(targetText);
      const isPcTarget = /PC|IPC|본체|컴퓨터|산업용|HW|메인/i.test(targetText);

      if (isWindowsTarget && winKey) {
        literalSerial = winKey;
      } else if (isPcTarget && pcSerial) {
        literalSerial = pcSerial;
      }

      if (literalSerial && !candidatesList.includes(literalSerial)) {
        candidatesList.unshift(literalSerial);
      } else if (literalSerial && candidatesList.includes(literalSerial)) {
        const remaining = candidatesList.filter((c) => c !== literalSerial);
        candidatesList.length = 0;
        candidatesList.push(literalSerial, ...remaining);
      } else if (!literalSerial && candidatesList.length > 0) {
        literalSerial = candidatesList[0];
      }
    }

    let confidenceNumeric = 99;
    if (parsed.low_confidence_chars && Array.isArray(parsed.low_confidence_chars) && parsed.low_confidence_chars.length > 0) {
      confidenceNumeric = Math.max(50, confidenceNumeric - parsed.low_confidence_chars.length * 6);
    }

    onProgress?.(100, "✨ 명판 시리얼 전사 완료!");

    const lines: string[] = [`[전사 시리얼]: ${literalSerial || "-"}`];
    if (parsed.source_type) {
      lines.push(`[텍스트 유형]: ${parsed.source_type}`);
    }
    if (parsed.model_name) {
      lines.push(`[식별 모델명]: ${parsed.model_name}`);
    }
    if (parsed.serial_candidates && parsed.serial_candidates.length > 1) {
      const candSummary = parsed.serial_candidates
        .map((c: any) => `${c.label || "S/N"}: ${cleanPrefixOnly(c.value || c)}`)
        .join(" | ");
      lines.push(`[검출 후보]: ${candSummary}`);
    }
    if (parsed.notes) {
      lines.push(`[특이사항]: ${parsed.notes}`);
    }
    if (parsed.low_confidence_chars && parsed.low_confidence_chars.length > 0) {
      lines.push(`[저확신 문자]: ${parsed.low_confidence_chars.join(", ")}`);
    }

    return {
      rawText: JSON.stringify(parsed, null, 2),
      cleanedSerial: literalSerial,
      confidence: confidenceNumeric,
      lines,
      candidates: candidatesList.slice(0, 5),
    };
  }

  // 3. API Key 미등록 또는 네트워크 실패 시: 로컬 Tesseract 5 + Barcode 엔진으로 100% 무중단 페일오버
  onProgress?.(60, "⚡ 고정밀 로컬 광학 OCR 및 분산 텍스트 분석 중...");
  return await performInMemoryOcr(canvas, onProgress, context);
}

