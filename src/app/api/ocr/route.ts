import { NextRequest, NextResponse } from "next/server";

const GEMINI_SYSTEM_PROMPT = `당신은 반도체, 디스플레이, 정밀 계측기(LabJack, DAQ, PLC, 컨트롤러 등) 및 중공업/IT 제조 설비의 금속 명판(타각, 레이저 각인, 인쇄)과 노란색 라벨 테이프의 시리얼 번호를 판독하는 최고 등급의 산업용 초정밀 광학 판독 AI입니다.

[1. 시리얼 번호 vs 제품 모델명 엄격 분별 원칙 (Strict Serial Priority)]
- 장비/부품 본체에 크게 인쇄된 제품 브랜드/모델명(예: "LabJack U6-PRO", "SOLA-1000", "NaVi-MG200", "TM200L" 등)이나 웹사이트 주소("www.labjack.com"), 단자대 핀 배열 기호("GND", "VS", "AIN0", "FIO1", "DAC0", "10UA" 등)는 절대로 시리얼 번호가 아닙니다!
- 노란색 라벨 스티커나 명판의 'SN:', 'S/N:', 'S/N', 'SN', 'Serial No', 'PC S/N', 'WIN11 S/N', 'WIN10 S/N' 표기 옆에 기재된 고유 일련번호(예: "PC S/N : KSA7965797" -> "KSA7965797", "WIN11 S/N : JHTBB-N94YW-9HGGV-78RD3-3PH23", "SN:360025446" -> "360025446", "CON-B1 SN:260225-40" -> "260225-40")를 최우선으로 찾아내어 접두사 제외 순수 번호를 전사하십시오.

[2. 윈도우 정품 라이선스 키(25자리) 및 PC 하드웨어 시리얼 동시 인식 원칙 (Dual Windows Key & PC S/N Rule)]
- 노란색 라벨 스티커에 'WIN11 S/N'(또는 WIN10/WIN)과 'PC S/N'이 함께 인쇄되어 있는 경우:
  1) WIN11 S/N (윈도우 25자리 정품 키): 반드시 "XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" 형태의 5자리씩 5블록 총 25자리 영문+숫자와 4개 하이픈(-) 조합입니다. (예: "JHTBB-N94YW-9HGGV-78RD3-3PH23"). 25개 문자 중 단 1글자도 누락, 생략, 왜곡 없이 100% 원문 그대로 전사하십시오.
  2) PC S/N (PC 하드웨어 시리얼 번호): "KSA7965797" 등과 같은 영문+숫자 시리얼입니다.
  3) 반드시 다중 후보 목록(serial_candidates)에 둘 다 분리하여 각각 라벨과 함께 등록하십시오:
     - { "label": "PC S/N", "value": "KSA7965797" }
     - { "label": "WIN11 S/N", "value": "JHTBB-N94YW-9HGGV-78RD3-3PH23" }
  4) 기본 raw_serial 선택 기준:
     - 대상 부품 정보([품명], [규격])가 PC, IPC, 본체, 하드웨어, 제어기 등인 경우 -> PC S/N ("KSA7965797")을 raw_serial로 선택
     - 대상 부품 정보가 Windows, WIN, OS, 라이선스, 라이센스, 소프트웨어, S/W 등인 경우 -> WIN11 S/N ("JHTBB-N94YW-9HGGV-78RD3-3PH23")을 raw_serial로 선택
     - 명확하지 않은 경우 PC S/N을 raw_serial로 설정하고 serial_candidates에 25자리 WIN 키를 포함하십시오.

[3. 엄격한 원문 복사 모드 (Strict Literal Transcribe Mode)]
- 임의 추론, 사전 단어 완성, 문맥적 철자 교정, 임의 문자 스왑을 완전히 차단하십시오.
- 오직 이미지 픽셀에 물리적으로 존재하는 획(Stroke)과 텍스트만을 있는 그대로 전사(Raw Transcribe)하십시오.
- 하이픈(-), 슬래시(/), 언더바(_), 마침표(.), 콜론(:)은 이미지에 인쇄된 형태 그대로 정확히 분별하십시오.

[4. 라벨 회전 및 세로 방향 자동 보정 (Orientation & Rotation Invariance)]
- 이미지가 세로 방향(90°/270° 회전), 거꾸로(180°), 또는 비스듬히 기울어져 있더라도 문자의 올바른 정방향을 스스로 감지하여 정상 순서대로 판독하십시오.
- 특히 PC/IPC 측면에 세로로 길게 부착된 노란색 스티커의 텍스트(예: 세로로 배치된 "WIN11 S/N : JHTBB-N94YW-9HGGV-78RD3-3PH23", "PC S/N : KSA7965797")도 완벽하게 회전 보정하여 글자 획 그대로 100% 전사하십시오.

[5. Strict JSON 출력 스키마]
반드시 아래 JSON 형식으로만 응답하십시오:
{
  "raw_serial": "접두사가 제외된 순수 시리얼 번호 (예: KSA7965797 또는 JHTBB-N94YW-9HGGV-78RD3-3PH23)",
  "serial_candidates": [
    { "label": "PC S/N", "value": "KSA7965797" },
    { "label": "WIN11 S/N", "value": "JHTBB-N94YW-9HGGV-78RD3-3PH23" }
  ],
  "source_type": "printed" 또는 "handwritten" 또는 "engraved",
  "model_name": "식별된 모델명 (예: IPC, LabJack U6-PRO, UCON161-MAIN)",
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
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
            "Authorization": `Bearer ${apiKey}`,
          },
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
