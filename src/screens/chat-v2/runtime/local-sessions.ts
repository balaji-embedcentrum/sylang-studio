/**
 * Browser-local sessions index for chat-v2.
 *
 * Why this exists instead of /api/sessions:
 *   The hermes-adapter agent containers hold the canonical session list in
 *   their per-user SQLite. When the fleet wipes / rebuilds a container, that
 *   list disappears with it and the sidebar goes empty even though message
 *   history may still be reachable. Storing session metadata in the browser
 *   (localStorage) keeps the user's view of "my conversations" stable across
 *   agent restarts.
 *
 *   We only store the INDEX (sessionKey, label, last snippet, timestamps) —
 *   not the actual messages. Messages still live in the agent and are fetched
 *   on demand by /api/history. If a session can't be re-hydrated, that's a
 *   visible-but-recoverable state (user can delete the entry).
 *
 * Storage shape:
 *   localStorage[KEY] = JSON { version: 1, sessions: LocalSession[] }
 *
 * Cross-tab updates are broadcast via the native `storage` event; consumers
 * use subscribe() to re-read after another tab writes.
 */

const STORAGE_KEY = 'chatv2.sessions.v1'

export type LocalSession = {
  /** Same value used as the URL friendlyId / sessionKey */
  key: string
  /** Display label — first user message snippet, falls back to the key */
  label: string
  /** Short preview of the most recent user OR assistant message */
  lastSnippet: string | null
  createdAt: number
  updatedAt: number
}

type Stored = {
  version: 1
  sessions: Array<LocalSession>
}

const listeners = new Set<() => void>()

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

function readStore(): Stored {
  if (!isBrowser()) return { version: 1, sessions: [] }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { version: 1, sessions: [] }
    const parsed: unknown = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as { version?: unknown }).version !== 1 ||
      !Array.isArray((parsed as { sessions?: unknown }).sessions)
    ) {
      return { version: 1, sessions: [] }
    }
    return parsed as Stored
  } catch {
    return { version: 1, sessions: [] }
  }
}

function writeStore(next: Stored): void {
  if (!isBrowser()) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // quota / private mode — swallow; sidebar just won't persist this turn
  }
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      // listener bug shouldn't break the writer
    }
  }
}

if (isBrowser()) {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return
    for (const fn of listeners) {
      try {
        fn()
      } catch {
        // ignore
      }
    }
  })
}

export function listLocalSessions(): Array<LocalSession> {
  const { sessions } = readStore()
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getLocalSession(key: string): LocalSession | null {
  const { sessions } = readStore()
  return sessions.find((s) => s.key === key) ?? null
}

/**
 * Insert or update a session. `label` is only applied when creating the entry
 * (or when the existing label is empty / equal to the key). `lastSnippet` is
 * always updated to the latest value passed in. updatedAt is bumped.
 */
export function upsertLocalSession(input: {
  key: string
  label?: string
  lastSnippet?: string | null
}): LocalSession {
  const now = Date.now()
  const store = readStore()
  const idx = store.sessions.findIndex((s) => s.key === input.key)
  const cleanedLabel = (input.label ?? '').trim()
  const cleanedSnippet = (input.lastSnippet ?? '').trim()

  let entry: LocalSession
  if (idx >= 0) {
    const existing = store.sessions[idx]
    const labelIsFallback =
      !existing.label || existing.label === existing.key
    entry = {
      ...existing,
      label:
        cleanedLabel && labelIsFallback ? cleanedLabel : existing.label,
      lastSnippet: cleanedSnippet || existing.lastSnippet,
      updatedAt: now,
    }
    store.sessions[idx] = entry
  } else {
    entry = {
      key: input.key,
      label: cleanedLabel || input.key,
      lastSnippet: cleanedSnippet || null,
      createdAt: now,
      updatedAt: now,
    }
    store.sessions.push(entry)
  }

  writeStore(store)
  return entry
}

export function deleteLocalSession(key: string): void {
  const store = readStore()
  const next = store.sessions.filter((s) => s.key !== key)
  if (next.length === store.sessions.length) return
  writeStore({ ...store, sessions: next })
}

export function clearLocalSessions(): void {
  writeStore({ version: 1, sessions: [] })
}

/**
 * Subscribe to changes (this tab AND cross-tab). Returns an unsubscribe fn.
 * Useful for React useSyncExternalStore.
 */
export function subscribeLocalSessions(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Truncate a string for the sidebar preview line. */
export function snippetFromText(text: string, max = 80): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}
