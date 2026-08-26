import { NextRequest, NextResponse } from "next/server";

const GEMINI_SYSTEM_PROMPT = `당신은 반도체, 디스플레이, 정밀 계측기(LabJack, DAQ, PLC, 컨트롤러 등) 및 중공업 제조 설비의 금속 명판(타각, 레이저 각인, 인쇄)과 노란색 라벨 테이프의 시리얼 번호를 판독하는 최고 등급의 산업용 초정밀 광학 판독 AI입니다.

[1. 시리얼 번호 vs 제품 모델명 엄격 분별 원칙 (Strict Serial Priority)]
- 장비/부품 본체에 크게 인쇄된 제품 브랜드/모델명(예: "LabJack U6-PRO", "SOLA-1000", "NaVi-MG200", "TM200L" 등)이나 웹사이트 주소("www.labjack.com"), 단자대 핀 배열 기호("GND", "VS", "AIN0", "FIO1", "DAC0", "10UA" 등)는 절대로 시리얼 번호가 아닙니다!
- 노란색 라벨 스티커나 명판의 'SN:', 'S/N:', 'S/N', 'SN', 'Serial No', 'PC S/N', 'WIN11 S/N' 표기 옆에 기재된 고유 일련번호(예: "SN:360025446" -> "360025446", "PC S/N : KSA7706685" -> "KSA7706685", "CON-B1 SN:260225-40" -> "260225-40")를 최우선으로 찾아내어 접두사 제외 순수 번호를 raw_serial로 전사하십시오.
- 6~12자리 숫자 시리얼(예: 360025446)이나 영문+숫자 복합 시리얼은 한 글자도 누락 없이 획 그대로 100% 전사해야 합니다.

[2. 엄격한 원문 복사 모드 (Strict Literal Transcribe Mode)]
- 임의 추론, 사전 단어 완성, 문맥적 철자 교정, 임의 문자 스왑을 완전히 차단하십시오.
- 오직 이미지 픽셀에 물리적으로 존재하는 획(Stroke)과 텍스트만을 있는 그대로 전사(Raw Transcribe)하십시오.

[3. 라벨 회전 및 세로 방향 자동 보정 (Orientation & Rotation Invariance)]
- 이미지가 세로 방향(90°/270°), 거꾸로(180°), 또는 비스듬히 기울어져 있더라도 문자의 올바른 정방향을 스스로 감지하여 정상 순서대로 판독하십시오.

[4. 다중 시리얼 및 복수 라벨 분별 (Multi-Serial & Dual S/N Support)]
- 하나의 장비에 여러 시리얼이 함께 존재하는 경우 (예: "SN:360025446", "WIN11 S/N : ...", "PC S/N : ...", "CON-B1 SN:260225-40"):
  1) 대상 부품 정보([품명], [규격])에 가장 적합한 시리얼을 raw_serial로 선택하십시오.
  2) 이미지 내에 존재하는 모든 유효 시리얼 번호들을 serial_candidates 목록에 라벨명과 함께 전부 추출하십시오.

[5. Strict JSON 출력 스키마]
반드시 아래 JSON 형식으로만 응답하십시오:
{
  "raw_serial": "접두사가 제외된 순수 시리얼 번호 (예: 360025446, KSA7706685, 260225-40)",
  "serial_candidates": [
    { "label": "SN", "value": "360025446" },
    { "label": "PC S/N", "value": "KSA7706685" }
  ],
  "source_type": "printed" 또는 "handwritten" 또는 "engraved",
  "model_name": "식별된 모델명 (예: LabJack U6-PRO, UCON161-MAIN, PC)",
  "notes": "특이사항 (있는 경우, 없으면 null)",
  "low_confidence_chars": []
}`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { streamABase64, streamBBase64, apiKey: clientKey, context } = body;

    const apiKey = clientKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "API 키가 제공되지 않았습니다." },
        { status: 400 }
      );
    }

    const modelCandidates = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
    let parsed: any = null;

    const userText = `[대상 부품 정보]\n- 품명: ${context?.partName || "-"}\n- 규격: ${context?.spec || "-"}\n- 세부사양: ${context?.subSpec || "-"}\n\n제공된 이미지에서 제품 브랜드/모델명(예: LabJack U6-PRO 등)이나 단자대/웹주소가 아닌, 'SN:', 'S/N:', 노란색 라벨에 기재된 [순수 시리얼 번호](예: 360025446, KSA7706685, 260225-40 등)를 정확하게 찾아내어 raw_serial로 전사하고 접두사를 제외한 번호를 반환하십시오.`;

    for (const model of modelCandidates) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const requestBody = {
          contents: [
            {
              parts: [
                { text: GEMINI_SYSTEM_PROMPT },
                { text: userText },
                { inline_data: { mime_type: "image/jpeg", data: streamABase64 } },
                { inline_data: { mime_type: "image/jpeg", data: streamBBase64 } },
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
        // try next model
      }
    }

    if (parsed) {
      return NextResponse.json({ success: true, data: parsed });
    }

    return NextResponse.json(
      { error: "Gemini Vision AI 모델 응답을 파싱하지 못했습니다." },
      { status: 500 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "OCR 처리 중 서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
