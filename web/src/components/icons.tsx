/**
 * icons.tsx — the few inline SVG icons the board uses (no icon dependency).
 * All are decorative (`aria-hidden`); the text next to them carries the meaning.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = (props: IconProps): IconProps => ({
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  ...props,
});

export const AlertIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 4.75v3.75M8 11h.01" />
  </svg>
);

export const CalendarIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2" />
    <path d="M2.25 6.5h11.5M5.5 1.75v2.5M10.5 1.75v2.5" />
  </svg>
);

export const RefreshIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71" />
    <path d="M13.25 2.75v3h-3" />
  </svg>
);

export const ChevronDownIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />
  </svg>
);

export const CloseIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="m4.5 4.5 7 7m0-7-7 7" />
  </svg>
);

export const BoardIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="1.75" y="2.25" width="3.5" height="11.5" rx="1" />
    <rect x="6.25" y="2.25" width="3.5" height="7.5" rx="1" />
    <rect x="10.75" y="2.25" width="3.5" height="9.5" rx="1" />
  </svg>
);
