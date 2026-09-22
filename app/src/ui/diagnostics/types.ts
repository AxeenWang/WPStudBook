import type { IndexedDbProbe } from './browser-checks'
import type { Cp932Inspection } from './checks'

export type CheckStatus = 'ok' | 'ng' | 'info'

export interface CheckRow {
  id: string
  title: string
  status: CheckStatus
  detail: string
}

export interface CheckOutcome {
  status: CheckStatus
  detail: string
}

export interface DiagnosticsState {
  done: boolean
  results: CheckRow[]
  cp932: Cp932Inspection[]
  indexedDb: IndexedDbProbe | null
}

declare global {
  interface Window {
    __wpsbDiagnostics?: DiagnosticsState
  }
}
