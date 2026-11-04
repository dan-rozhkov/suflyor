import type { ReactNode, SVGProps } from 'react'

function Svg({ children, ...p }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      {children}
    </svg>
  )
}
export const SettingsIcon = () => (
  <Svg viewBox="0 0 24 24" strokeWidth="2">
    <path d="M11 10.27 7 3.34M11 13.73l-4 6.93M12 22v-2M12 2v2M14 12h8M17 20.66l-1-1.73M17 3.34l-1 1.73M2 12h2M20.66 17l-1.73-1M20.66 7l-1.73 1M3.34 17l1.73-1M3.34 7l1.73 1" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="12" cy="12" r="8" />
  </Svg>
)
export const CloseIcon = () => (<Svg><path d="M4 4l8 8M12 4l-8 8" /></Svg>)
export const CheckIcon = () => (<Svg><path d="M3.5 8.5l3 3 6-6.5" /></Svg>)
export const FileIcon = () => (<Svg><path d="M4 2.5h5l3 3v8H4z" /><path d="M9 2.5v3h3" /></Svg>)
export const ArrowDownIcon = () => (<Svg><path d="M8 3v10M4 9l4 4 4-4" /></Svg>)
export const SparkIcon = () => (<Svg><path d="M8 2.5l1.4 4.1 4.1 1.4-4.1 1.4L8 13.5l-1.4-4.1L2.5 8l4.1-1.4z" /></Svg>)
export const StopIcon = () => (<Svg><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" /></Svg>)
export const ChevronIcon = () => (<Svg><path d="M4.5 6.5L8 10l3.5-3.5" /></Svg>)
export const AlertIcon = () => (<Svg><path d="M8 4.5v4.2M8 11.2v.1" /></Svg>)
export const RefreshIcon = () => (<Svg><path d="M12.8 8a4.8 4.8 0 1 1-1.4-3.4M12.8 2.8v2.6h-2.6" /></Svg>)
