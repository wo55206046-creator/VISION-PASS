import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Serial Report | 설비 제작완료 보고서 & 인메모리 OCR",
  description:
    "반도체 설비 제작 완료 보고서 작성을 위한 PJT List 관리, 호기별 시리얼 구분, 모바일 인메모리 금속 명판 OCR 및 초경량 엑셀 추출 솔루션",
  keywords: [
    "반도체 설비",
    "제작완료보고서",
    "인메모리 OCR",
    "Storage Zero",
    "금속 명판 인식",
    "Tesseract.js",
    "엑셀 리포트",
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#07090e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="dark">
      <body className="antialiased selection:bg-cyan-500 selection:text-slate-950">
        {children}
      </body>
    </html>
  );
}
