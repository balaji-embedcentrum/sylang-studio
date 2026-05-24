/**
 * Minimal sessions sidebar for chat-v2. Lists the user's chat sessions
 * from /api/sessions, lets them switch (URL navigation) or start a new
 * one. Reuses the existing fetchSessions helper from the legacy chat
 * module — same backend, just a different presentation.
 *
 * Deliberately small: no rename, no delete, no search yet. Those are
 * easy follow-ups but the goal here is feature parity at the 'I can
 * see and switch between my chats' level.
 */

import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { fetchSessions, chatQueryKeys } from '@/screens/chat/chat-queries'
import type { SessionMeta } from '@/screens/chat/types'
import { cn } from '@/lib/utils'

type Props = {
  currentSessionKey: string
  /** Optional callback fired after navigation, useful for closing the
   *  sidebar on mobile. */
  onPick?: () => void
}

function pickLabel(session: SessionMeta): string {
  return (
    session.title ||
    session.derivedTitle ||
    session.label ||
    session.friendlyId ||
    session.key
  )
}

function pickSubLabel(session: SessionMeta): string | null {
  const last = session.lastMessage
  if (!last) return null
  const text = extractFirstLineOfText(last) ?? ''
  if (!text) return null
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

function extractFirstLineOfText(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null
  const m = message as Record<string, unknown>
  if (typeof m.text === 'string' && m.text.trim()) {
    return m.text.split('\n')[0].trim()
  }
  if (Array.isArray(m.content)) {
    for (const p of m.content) {
      if (
        p &&
        typeof p === 'object' &&
        (p as Record<string, unknown>).type === 'text'
      ) {
        const t = (p as Record<string, unknown>).text
        if (typeof t === 'string' && t.trim()) return t.split('\n')[0].trim()
      }
    }
  }
  return null
}

function formatRelativeTime(ms?: number): string | null {
  if (!ms || !Number.isFinite(ms)) return null
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`
  return new Date(ms).toLocaleDateString()
}

export function SessionsSidebar({ currentSessionKey, onPick }: Props) {
  const navigate = useNavigate()
  const query = useQuery({
    queryKey: chatQueryKeys.sessions,
    queryFn: fetchSessions,
    refetchInterval: 15_000,
    staleTime: 10_000,
  })

  const goTo = (sessionKey: string) => {
    void navigate({
      to: '/chat/$sessionKey',
      params: { sessionKey },
    })
    onPick?.()
  }

  const sessions = query.data ?? []
  const sorted = [...sessions].sort(
    (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
  )

  return (
    <aside className="flex h-full w-64 flex-none flex-col border-r border-primary-200 bg-primary-50/60">
      <div className="border-b border-primary-200 p-2">
        <button
          type="button"
          onClick={() => goTo('new')}
          className="w-full rounded-lg bg-accent-500 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-600"
        >
          + New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        {query.isLoading && sessions.length === 0 ? (
          <div className="p-3 text-xs text-primary-500">Loading sessions…</div>
        ) : query.error ? (
          <div className="p-3 text-xs text-red-600">
            Couldn’t load sessions.
            <button
              type="button"
              onClick={() => query.refetch()}
              className="ml-1 underline"
            >
              Retry
            </button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="p-3 text-xs text-primary-500">
            No chats yet — send a message to start one.
          </div>
        ) : (
          <ul className="space-y-0.5">
            {sorted.map((session) => {
              const active = session.friendlyId === currentSessionKey
              const label = pickLabel(session)
              const sub = pickSubLabel(session)
              const rel = formatRelativeTime(session.updatedAt)
              return (
                <li key={session.key}>
                  <button
                    type="button"
                    onClick={() => goTo(session.friendlyId)}
                    className={cn(
                      'group flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left text-sm transition-colors',
                      active
                        ? 'bg-primary-200 text-primary-950'
                        : 'text-primary-800 hover:bg-primary-100',
                    )}
                  >
                    <div className="flex w-full items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{label}</span>
                      {rel && (
                        <span className="flex-none text-[10px] text-primary-500">
                          {rel}
                        </span>
                      )}
                    </div>
                    {sub && (
                      <span className="line-clamp-1 w-full text-xs text-primary-500">
                        {sub}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
