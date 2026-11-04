import type { SuflyorApi } from '../shared/api'

declare global {
  interface Window {
    suflyor: SuflyorApi
  }
}

export {}
