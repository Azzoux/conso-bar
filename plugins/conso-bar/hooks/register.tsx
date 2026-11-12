import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Kind, Window, Work } from '../types'

type Api = Parameters<Parameters<Parameters<Register>[0]>[1]>[0]

const windows = atom({ plugin: 'conso-bar', key: 'windows' } as const, [] as Window[])
const work = atom({ plugin: 'conso-bar', key: 'work' } as const, null as Work)
const tick = atom({ plugin: 'conso-bar', key: 'tick' } as const, 0)

const W = 28
const MINT = '#3DDC97'

// Dégradé violet → indigo (comme la barre d'origine)
const GRAD = ['#B57BFF', '#A06BFF', '#8B5CF6', '#7C5CFF', '#6D5BFF', '#6366F1', '#5B5BEA']
// Teinte selon le type d'action
const TINT: Record<Kind, string[]> = {
  think: GRAD,
  cmd: ['#C084FC', '#A78BFA', '#8B5CF6', '#7C3AED'],
  edit: ['#E879F9', '#D946EF', '#C026D3', '#A21CAF'],
  read: ['#A5B4FC', '#818CF8', '#6366F1', '#4F46E5'],
  other: GRAD,
}

const kindOf = (tool: string): Kind =>
  tool === 'Bash' ? 'cmd' : tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit' ? 'edit'
    : tool === 'Read' || tool === 'Grep' || tool === 'Glob' || tool === 'WebFetch' || tool === 'WebSearch' ? 'read' : 'other'
const LABEL: Record<Kind, string> = { think: 'Réflexion', cmd: 'Commande', edit: 'Édition', read: 'Lecture', other: 'Action' }

const name = (k: string) => (k === 'five_hour' ? '5 h' : k === 'seven_day' ? '7 j' : k)

// Rythme : % consommé comparé au % de temps écoulé dans la fenêtre
const LEN: Record<string, number> = { five_hour: 5 * 3600e3, seven_day: 7 * 86400e3 }
function pace(w: Window, now: number): string {
  const len = LEN[w.kind]
  if (!len || !w.resetsAt) return w.percentUsed >= 85 ? 'red' : w.percentUsed >= 60 ? 'orange' : 'green'
  const elapsed = Math.max(0.02, Math.min(1, 1 - (Date.parse(w.resetsAt) - now) / len))
  const ratio = w.percentUsed / 100 / elapsed
  return ratio > 1.25 ? '#FF5A5F' : ratio > 1 ? '#FFB020' : MINT
}

function progress(w: NonNullable<Work>): number {
  if (w.finished) return 100
  if (w.total > 0) return Math.round((w.done / w.total) * 100)
  return Math.min(90, Math.round(100 * (1 - Math.exp(-w.tools / 8)))) // sans liste : avance en douceur
}

async function refresh($: Api) {
  const u = await $.session.usage()
  const ws: Window[] = u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt }))
  await update($, windows, () => ws)
  $.ui.status(ws.length ? ws.map(w => `${name(w.kind)} ${Math.round(w.percentUsed)} %`).join(' · ') : undefined)
}

let gen = 0
async function animate($: Api) {
  const me = ++gen
  while (me === gen) {
    await $.clock.sleep(120)
    if (me !== gen) return
    await update($, tick, t => (t + 1) % 10000)
    // glissement fluide du % affiché vers le % réel
    await update($, work, w => {
      if (!w) return w
      const target = progress(w)
      const shown = w.shown + Math.sign(target - w.shown) * Math.max(1, Math.ceil(Math.abs(target - w.shown) / 4))
      return Math.abs(target - w.shown) <= 1 ? { ...w, shown: target } : { ...w, shown }
    })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  })

  on('session.measure', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, work, () => ({ label: LABEL.think, kind: 'think' as Kind, tools: 0, total: 0, done: 0, shown: 0, finished: false }))
    void animate($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const args = e as unknown as { tool: string; status?: string }
    const k = kindOf(args.tool)
    await update($, work, w => {
      if (!w) return w
      const total = w.total + (args.tool === 'TaskCreate' ? 1 : 0)
      const done = w.done + (args.tool === 'TaskUpdate' && args.status === 'completed' ? 1 : 0)
      return { ...w, label: LABEL[k], kind: k, tools: w.tools + 1, total, done: Math.min(done, total || done) }
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await update($, work, w => (w ? { ...w, finished: true, label: 'Terminé', kind: 'other' as Kind } : w))
    await refresh($)
    const me = gen
    void $.clock.sleep(1800).then(async () => {
      if (me !== gen) return
      gen++
      await update($, work, () => null)
    })
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ws = await read($, windows)
    const w = await read($, work)
    const t = await read($, tick)
    const now = Date.now()
    const { Box, Text } = $.ui.resolve(e)

    let workRow = null
    if (w) {
      const pct = w.finished ? 100 : w.shown
      const filled = Math.round((pct / 100) * W)
      const cols = TINT[w.kind]
      const shine = t % (W + 8) // reflet blanc qui balaie la barre
      const pulse = t % 10 < 5 // pulse progressif
      const cells = Array.from({ length: W }, (_, i) => {
        if (i >= filled) return <Text key={i} color="#3A3550">━</Text>
        if (w.finished) return <Text key={i} color={MINT}>━</Text>
        if (Math.abs(i - shine) <= 1) return <Text key={i} color="#FFFFFF">━</Text>
        const c = cols[Math.floor((i / Math.max(1, filled)) * cols.length) % cols.length]
        return <Text key={i} color={c} bold={pulse && i === filled - 1}>━</Text>
      })
      workRow = (
        <Box>
          {cells}
          <Text color={w.finished ? MINT : cols[0]}>{w.finished ? '  ✓ ' : `  ${pct} % `}</Text>
          <Text dimColor>{w.finished ? 'Terminé' : w.label}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {workRow}
        <Box>
          {ws.length === 0 ? (
            <Text dimColor>Conso : en attente de la première réponse…</Text>
          ) : (
            ws.map(x => (
              <Box key={x.kind} marginRight={3}>
                <Text color={pace(x, now)}>● </Text>
                <Text dimColor>{name(x.kind)} </Text>
                <Text>{Math.round(x.percentUsed)} %</Text>
              </Box>
            ))
          )}
        </Box>
      </Box>
    )
  })
}
