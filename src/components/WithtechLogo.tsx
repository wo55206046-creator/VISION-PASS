import React from "react";

interface WithtechLogoProps {
  className?: string;
}

export const WithtechLogo: React.FC<WithtechLogoProps> = ({
  className = "h-6 sm:h-7 w-auto",
}) => {
  return (
    <div className="inline-flex items-center rounded-xl bg-white px-2.5 py-1 sm:px-3 sm:py-1 shadow-md border border-slate-200/40 hover:bg-slate-50 transition-all select-none">
      {/* Official WITHTECH Corporate Logo (Orange Diamond + Navy Blue Wordmark) */}
      <svg
        viewBox="0 0 190 44"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        <defs>
          <linearGradient
            id="wt-logo-orange"
            x1="2"
            y1="22"
            x2="42"
            y2="22"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FF3000" />
            <stop offset="50%" stopColor="#FF6A00" />
            <stop offset="100%" stopColor="#FFA200" />
          </linearGradient>
        </defs>

        {/* Orange Rounded Diamond Icon */}
        <g transform="translate(2, 2)">
          <rect
            x="0"
            y="0"
            width="26"
            height="26"
            rx="5.5"
            transform="rotate(45 18 8)"
            fill="url(#wt-logo-orange)"
          />
          {/* Top Inverted Triangle */}
          <polygon points="18,15.5 14,9.5 22,9.5" fill="#FFFFFF" />
          {/* Inner Stylized W Shape */}
          <path
            d="M9 14.5 L18 29 L27 14.5 L23.5 14.5 L18 23 L12.5 14.5 Z"
            fill="#FFFFFF"
          />
        </g>

        {/* Official WITHTECH Navy Blue Wordmark */}
        <text
          x="48"
          y="31"
          fontFamily="'Arial Black', 'Impact', 'Pretendard', 'Inter', -apple-system, sans-serif"
          fontWeight="900"
          fontSize="24"
          letterSpacing="-0.8"
          fill="#003876"
        >
          WITHTECH
        </text>
      </svg>
    </div>
  );
};
