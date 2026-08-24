import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cleanroom: {
          950: "#07090e",
          900: "#0b0f19",
          850: "#101626",
          800: "#161e33",
          700: "#1e2b48",
          600: "#2d3e66",
          500: "#475d8f",
        },
        laser: {
          cyan: "#00f0ff",
          glow: "#00c8d7",
          amber: "#ffb020",
          emerald: "#00e699",
        },
      },
      fontFamily: {
        sans: [
          '"Malgun Gothic"',
          '"맑은 고딕"',
          '"Apple SD Gothic Neo"',
          '"Noto Sans KR"',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
        mono: [
          "Consolas",
          '"Malgun Gothic"',
          '"맑은 고딕"',
          "ui-monospace",
          "monospace",
        ],
      },
      boxShadow: {
        "glow-cyan": "0 0 20px -5px rgba(0, 240, 255, 0.3)",
        "glow-emerald": "0 0 20px -5px rgba(0, 230, 153, 0.3)",
        "glow-amber": "0 0 20px -5px rgba(255, 176, 32, 0.3)",
      },
      animation: {
        "pulse-subtle": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "scan-line": "scan 2s linear infinite",
      },
      keyframes: {
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(1000%)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
