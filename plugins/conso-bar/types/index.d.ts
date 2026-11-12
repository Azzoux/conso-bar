export type Window = { kind: string; percentUsed: number; resetsAt?: string }
export type Kind = 'think' | 'cmd' | 'edit' | 'read' | 'other'
export type Work = { label: string; kind: Kind; tools: number; total: number; done: number; shown: number; finished: boolean } | null

declare module 'claude-code' {
  interface PluginState {
    'conso-bar': { windows: Window[]; work: Work; tick: number }
  }
}
