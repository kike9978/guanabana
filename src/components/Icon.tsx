import type { ReactNode } from 'react'

const PATHS = {
  inicio: (
    <>
      <path d="M3 11 12 4l9 7" />
      <path d="M6 10v10h12V10" />
    </>
  ),
  tiempo: (
    <>
      <rect x="3.5" y="5" width="17" height="15" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  movimientos: <path d="M4 6h16M4 12h16M4 18h10" />,
  ahorro: (
    <>
      <rect x="4" y="8" width="16" height="12" />
      <path d="M8 8V5h8v3M12 12v4" />
    </>
  ),
  proyeccion: <path d="M3 19h18M5 16l5-5 3 3 6-7M15 7h4v4" />,
  add: <path d="M12 5v14M5 12h14" />,
  sparkle: <path d="M12 3v5M12 16v5M3 12h5M16 12h5M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2" />,
  share: (
    <>
      <path d="M12 15V4M8 8l4-4 4 4" />
      <path d="M5 12v8h14v-8" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
