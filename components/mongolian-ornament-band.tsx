'use client';

import { useId } from 'react';

export function MongolianOrnamentBand({ className = '' }: { className?: string }) {
  const patternId = useId().replace(/:/g, '');
  return (
    <svg
      className={`mongol-ornament-band ${className}`.trim()}
      aria-hidden="true"
      width="100%"
      height="18"
      preserveAspectRatio="none"
    >
      <defs>
        <pattern
          id={`alkhan-${patternId}`}
          width="32"
          height="18"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M2 16V2h26v11H10V7h10"
            fill="none"
            stroke="var(--gold, #B88A2E)"
            strokeWidth="1.8"
          />
        </pattern>
      </defs>
      <rect width="100%" height="18" fill={`url(#alkhan-${patternId})`} />
    </svg>
  );
}

export function UlziiKnot({
  x = 0,
  y = 0,
  scale = 1,
}: {
  x?: number;
  y?: number;
  scale?: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden="true">
      <rect
        x="-12"
        y="-12"
        width="24"
        height="24"
        transform="rotate(45)"
        fill="var(--card, #FFFBF2)"
        stroke="var(--gold, #B88A2E)"
        strokeWidth="2"
      />
      <rect
        x="-5"
        y="-5"
        width="10"
        height="10"
        transform="rotate(45)"
        fill="none"
        stroke="var(--gold, #B88A2E)"
        strokeWidth="1.5"
      />
      <circle r="2.3" fill="var(--gold, #B88A2E)" />
    </g>
  );
}
