// app/src/graph/session.ts
import type { Session } from './state'

const WIB_OFFSET = 7 * 60  // minutes

function toWibMinutes(date: Date): number {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes()
  return (utcMinutes + WIB_OFFSET) % (24 * 60)
}

function toWibDay(date: Date): number {
  // Compute day of week in WIB
  // We need to account for day rollover when adding WIB offset
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes()
  const wibMinutesRaw = utcMinutes + WIB_OFFSET
  const utcDay = date.getUTCDay()
  if (wibMinutesRaw >= 24 * 60) {
    return (utcDay + 1) % 7
  }
  return utcDay
}

export function detectSession(now: Date = new Date()): Session {
  const day = toWibDay(now)
  if (day === 0 || day === 6) return 'CLOSED'  // weekend

  const minutes = toWibMinutes(now)
  const hhmm = (h: number, m = 0) => h * 60 + m

  if (minutes < hhmm(8, 45))  return 'CLOSED'
  if (minutes < hhmm(9, 0))   return 'PRE_MARKET'
  if (minutes < hhmm(11, 30)) return 'SESSION_1'
  if (minutes < hhmm(13, 30)) return 'LUNCH'
  if (minutes < hhmm(15, 0))  return 'SESSION_2'
  if (minutes < hhmm(15, 30)) return 'AFTER_HOURS'
  return 'CLOSED'
}

export function isMarketActive(session: Session): boolean {
  return session === 'SESSION_1' || session === 'SESSION_2'
}
