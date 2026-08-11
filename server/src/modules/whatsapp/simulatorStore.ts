/**
 * In-memory transcript store for the local WhatsApp simulator (SPEC §4).
 *
 * One transcript per mobile number. Inbound entries carry `text` (what the
 * "user" typed or tapped); outbound entries carry the full BotReply so the
 * web simulator can render interactive lists/buttons as tappable chips.
 * FR-19 recipient notifications are appended with kind 'notification' so the
 * UI can render them distinctly from in-conversation replies.
 *
 * Volatile by design — this only backs the dev simulator, never production.
 */
import { BotReply } from '../../types'

export interface SimulatorEntry {
  dir: 'in' | 'out'
  at: string // ISO UTC
  text?: string
  reply?: BotReply
  kind?: 'message' | 'notification'
}

/** Keep transcripts bounded — drop the oldest entries beyond this. */
const MAX_ENTRIES_PER_MOBILE = 200

const transcripts = new Map<string, SimulatorEntry[]>()

export function appendSimulatorEntry(mobile: string, entry: SimulatorEntry): void {
  const list = transcripts.get(mobile) ?? []
  list.push(entry)
  if (list.length > MAX_ENTRIES_PER_MOBILE) list.splice(0, list.length - MAX_ENTRIES_PER_MOBILE)
  transcripts.set(mobile, list)
}

/** Full transcript for a mobile, oldest first (defensive copy). */
export function getSimulatorHistory(mobile: string): SimulatorEntry[] {
  return [...(transcripts.get(mobile) ?? [])]
}

export function clearSimulatorHistory(mobile: string): void {
  transcripts.delete(mobile)
}
