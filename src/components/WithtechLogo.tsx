import React from "react";

interface WithtechLogoProps {
  className?: string;
  showSubtitle?: boolean;
}

export const WithtechLogo: React.FC<WithtechLogoProps> = ({
  className = "h-8 w-auto",
  showSubtitle = true,
}) => {
  return (
    <div className="flex items-center gap-2.5 select-none cursor-pointer">
      {/* WITHTECH Official SVG Vector Logo */}
      <svg
        viewBox="0 0 172 44"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        <defs>
          {/* Official WITHTECH Orange-Amber Gradient */}
          <linearGradient
            id="wt-gradient"
            x1="2"
            y1="22"
            x2="42"
            y2="22"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FF3500" />
            <stop offset="55%" stopColor="#FF7200" />
            <stop offset="100%" stopColor="#FFA600" />
          </linearGradient>
        </defs>

        {/* 1. Rounded Diamond Icon */}
        <g transform="translate(3, 3)">
          {/* Rotated rounded square */}
          <rect
            x="0"
            y="0"
            width="27"
            height="27"
            rx="5.5"
            transform="rotate(45 19 8)"
            fill="url(#wt-gradient)"
          />

          {/* Inner Geometric 'W' and Triangle in pure white */}
          {/* Top Inverted Triangle */}
          <polygon points="19,16 15,10.5 23,10.5" fill="#FFFFFF" />

          {/* Stylized 'W' shape */}
          <path
            d="M9.5 15 L19 30 L28.5 15 L24.5 15 L19 23.5 L13.5 15 Z"
            fill="#FFFFFF"
          />
        </g>

        {/* 2. WITHTECH Wordmark in Crisp Clean White (High Contrast Dark Mode) */}
        <text
          x="46"
          y="29.5"
          fontFamily="'Pretendard', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          fontWeight="900"
          fontSize="23"
          letterSpacing="-0.8"
          fill="#FFFFFF"
        >
          WITHTECH
        </text>
      </svg>
    </div>
  );
};
