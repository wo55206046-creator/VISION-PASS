import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 고유 ID 생성기 (경량 nano-id 대체)
export function generateId(): string {
  return "id-" + Math.random().toString(36).substring(2, 9) + "-" + Date.now().toString(36);
}

// 오늘 날짜 포맷 (YYYY-MM-DD)
export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 시리얼 번호 기본 검증 유틸 (빈 문자열 여부 등)
export function isValidSerial(serial: string): boolean {
  if (!serial) return false;
  const trimmed = serial.trim();
  return trimmed.length >= 3 && !/^[-_]+$/.test(trimmed);
}

// 촉각/오디오 피드백 (스마트폰 진동 및 비프음)
export function triggerScanFeedback() {
  if (typeof window !== "undefined") {
    // 1. 진동 피드백 (모바일 지원 시)
    if (navigator.vibrate) {
      navigator.vibrate([40, 30, 80]);
    }

    // 2. 사운드 피드백 (Web Audio API 인메모리 합성 비프음)
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 (880Hz)
        osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.08); // A6 (1760Hz)
        
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
        
        setTimeout(() => {
          ctx.close();
        }, 150);
      }
    } catch (e) {
      // AudioContext 정책상 실패 시 무시
    }
  }
}

/**
 * 이전 호기의 시리얼 번호 끝자리를 자동 +1 증가시키는 인텔리전트 시리얼 생성기
 * 예: "SOTSU-SK26-1002" -> "SOTSU-SK26-1003"
 *     "CMP-SK26-01" -> "CMP-SK26-02"
 *     "STEC-2026-H8821" -> "STEC-2026-H8822"
 */
export function generateNextSerial(
  prevSerial: string | undefined,
  pjtCode: string = "S26-15-01",
  nextIndex: number = 1
): string {
  if (prevSerial && prevSerial.trim()) {
    const trimmed = prevSerial.trim();
    const match = trimmed.match(/^(.*?)(\d+)$/);
    if (match) {
      const prefix = match[1];
      const numStr = match[2];
      const nextNum = parseInt(numStr, 10) + 1;
      const paddedNextNum = String(nextNum).padStart(numStr.length, "0");
      return `${prefix}${paddedNextNum}`;
    }
  }
  return `SOTSU-SK26-100${nextIndex}`;
}

/**
 * 1호기 시리얼 번호 기준으로 N호기 시리얼 번호를 자동 연속 채번 (+1, +2...)
 * 예: 1호기 "SOTSU-SK26-1007" 입력 시
 *     2호기 -> "SOTSU-SK26-1008"
 *     3호기 -> "SOTSU-SK26-1009"
 */
export function cascadeSerialFromUnit1(baseSerial: string, unitIndex: number): string {
  if (unitIndex === 1) return baseSerial;
  if (!baseSerial || !baseSerial.trim()) return "";
  const trimmed = baseSerial.trim();
  const match = trimmed.match(/^(.*?)(\d+)$/);
  if (match) {
    const prefix = match[1];
    const numStr = match[2];
    const baseNum = parseInt(numStr, 10);
    const offset = unitIndex - 1;
    const nextNum = baseNum + offset;
    const padded = String(nextNum).padStart(numStr.length, "0");
    return `${prefix}${padded}`;
  }
  return `${baseSerial}-U${String(unitIndex).padStart(2, "0")}`;
}

