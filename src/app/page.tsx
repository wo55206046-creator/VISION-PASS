"use client";

import dynamic from "next/dynamic";

const MainApp = dynamic(() => import("@/components/MainApp"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950 pb-20 md:pb-6">
      <header className="sticky top-0 z-40 w-full border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
          <div className="flex h-14 sm:h-16 items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-base sm:text-lg font-black tracking-tight text-white">WITHTECH</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-lg bg-cyan-950/40 px-2 sm:px-2.5 py-1 text-[11px] sm:text-xs font-medium text-cyan-300 border border-cyan-800/40">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                </span>
                <span>Live Sync</span>
              </div>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent"></div>
          <span className="text-xs font-mono tracking-wider text-slate-400">데이터를 불러오는 중...</span>
        </div>
      </main>
    </div>
  ),
});

export default function Home() {
  return <MainApp />;
}
