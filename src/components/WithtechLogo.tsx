import React from "react";

interface WithtechLogoProps {
  className?: string;
}

export const WithtechLogo: React.FC<WithtechLogoProps> = ({
  className = "h-6 sm:h-7 w-auto",
}) => {
  return (
    <div className="flex items-center select-none cursor-pointer">
      <svg
        viewBox="0 0 175 42"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        <defs>
          {/* Official WITHTECH Orange Gradient */}
          <linearGradient
            id="withtech-orange-grad"
            x1="2"
            y1="21"
            x2="40"
            y2="21"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FF3000" />
            <stop offset="50%" stopColor="#FF6A00" />
            <stop offset="100%" stopColor="#FFA000" />
          </linearGradient>
        </defs>

        {/* 1. Rounded Orange Diamond Icon */}
        <g transform="translate(2, 2)">
          <rect
            x="0"
            y="0"
            width="26"
            height="26"
            rx="5.5"
            transform="rotate(45 18 7.5)"
            fill="url(#withtech-orange-grad)"
          />
          {/* Top Inverted Triangle */}
          <polygon points="18,15 14.5,9.5 21.5,9.5" fill="#FFFFFF" />
          {/* Inner Stylized W Shape */}
          <path
            d="M9 14 L18 28.5 L27 14 L23.5 14 L18 22 L12.5 14 Z"
            fill="#FFFFFF"
          />
        </g>

        {/* 2. Bold Crisp White WITHTECH Wordmark (Dark Theme Seamless Integration) */}
        <text
          x="46"
          y="29.5"
          fontFamily="'Arial Black', 'Impact', 'Pretendard', 'Inter', -apple-system, sans-serif"
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
