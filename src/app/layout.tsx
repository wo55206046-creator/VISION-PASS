import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Serial Report | 설비 제작완료 보고서 & 인메모리 OCR",
  description:
    "반도체 설비 제작 완료 보고서 작성을 위한 PJT List 관리, 호기별 시리얼 구분, 모바일 인메모리 금속 명판 OCR 및 초경량 엑셀 추출 솔루션",
  icons: {
    icon: "./favicon.svg",
    shortcut: "./favicon.svg",
    apple: "./favicon.svg",
  },
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
      <head>
        <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
        <link rel="alternate icon" href="./favicon.ico" />
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
      </head>
      <body className="antialiased selection:bg-cyan-500 selection:text-slate-950">
        {children}
      </body>
    </html>
  );
}
