import type { ReactNode, SVGProps } from 'react'

/** Glyphs from the pen-editor icon set: 16 grid, closed shapes, round ends, constant 1.25px stroke. */
function Svg({ name, children, ...p }: SVGProps<SVGSVGElement> & { name: string; children: ReactNode }) {
  return (
    <svg data-pen-icon={name} width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      {children}
    </svg>
  )
}
export const SettingsIcon = () => (
  <Svg name="Gear">
    <path d="M6.55 3.53L6.67 1.74L9.33 1.74L9.45 3.53A4.7 4.7 0 0 1 11.14 4.51L12.76 3.72L14.09 6.02L12.6 7.02A4.7 4.7 0 0 1 12.6 8.98L14.09 9.98L12.76 12.28L11.14 11.49A4.7 4.7 0 0 1 9.45 12.47L9.33 14.26L6.67 14.26L6.55 12.47A4.7 4.7 0 0 1 4.86 11.49L3.24 12.28L1.91 9.98L3.4 8.98A4.7 4.7 0 0 1 3.4 7.02L1.91 6.02L3.24 3.72L4.86 4.51A4.7 4.7 0 0 1 6.55 3.53z" />
    <circle cx="8" cy="8" r="2" />
  </Svg>
)
export const CloseIcon = () => (<Svg name="X"><path d="M3.75 3.75l8.5 8.5M12.25 3.75l-8.5 8.5" /></Svg>)
export const CheckIcon = () => (<Svg name="Check"><path d="M2.75 8.5l3.25 3.25 7.25-7.5" /></Svg>)
export const FileIcon = () => (<Svg name="File"><path d="M9.25 2.25H5a1.5 1.5 0 0 0-1.5 1.5v8.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5V5.5Z M9.25 2.25V5.5h3.25" /></Svg>)
export const ArrowDownIcon = () => (<Svg name="ArrowDown"><path d="M8 2.75v10.5M3.5 8.75 8 13.25l4.5-4.5" /></Svg>)
export const SparkIcon = () => (<Svg name="Sparkle"><path transform="translate(8 8) scale(1.07) translate(-8 -8)" d="M8 2.25Q9 7 13.75 8Q9 9 8 13.75Q7 9 2.25 8Q7 7 8 2.25Z" /></Svg>)
export const StopIcon = () => (<Svg name="Stop"><rect x="2.75" y="2.75" width="10.5" height="10.5" rx="1.75" /></Svg>)
export const ChevronIcon = () => (<Svg name="CaretDown"><path d="M4 6l4 4 4-4" /></Svg>)
export const AlertIcon = () => (<Svg name="WarningCircle"><circle cx="8" cy="8" r="6" /><path d="M8 4.75v3.5M8 11v.01" /></Svg>)
export const RefreshIcon = () => (<Svg name="ArrowClockwise"><path d="M13.25 8A5.25 5.25 0 1 1 11.7 4.3M11.7 1.8v2.5H9.2" /></Svg>)
const MicBody = () => (
  <>
    <rect x="5.75" y="1.75" width="4.5" height="8" rx="2.25" />
    <path d="M3.25 7.75a4.75 4.75 0 0 0 9.5 0M8 12.5v1.75M5.5 14.25h5" />
  </>
)
export const MicIcon = () => (<Svg name="Microphone"><MicBody /></Svg>)
/** Only shown on the light muted button, so the gap under the slash is that button's colour. */
export const MicOffIcon = () => (
  <Svg name="MicrophoneSlash">
    <MicBody />
    <path d="M2.75 2.75l10.5 10.5" stroke="var(--on-base)" strokeWidth="4" />
    <path d="M2.75 2.75l10.5 10.5" />
  </Svg>
)
