/**
 * Chat Screen v2 — minimal hand-rolled replacement for the legacy 5000+ line
 * chat module. One messages array as the only source of truth (see
 * useSylangChat). Feature-flagged at /chat-v2/<sessionKey> alongside the
 * legacy /chat route; old chat code stays in place until v2 reaches feature
 * parity, then both routes flip to this implementation.
 */

import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { useSylangChat, type ChatMessage, type Part } from './runtime/use-sylang-chat'
import { Markdown } from '@/components/prompt-kit/markdown'
import { cn } from '@/lib/utils'

type Props = {
  sessionKey: string
  friendlyId: string
  workspacePath?: string
  localAgentUrl?: string
  localWorkspaceRoot?: string
}

export function ChatScreenV2({
  sessionKey,
  friendlyId,
  workspacePath,
  localAgentUrl,
  localWorkspaceRoot,
}: Props) {
  const { messages, status, error, send, stop } = useSylangChat({
    sessionKey,
    friendlyId,
    workspacePath,
    localAgentUrl,
    localWorkspaceRoot,
  })
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const isBusy = status === 'sending' || status === 'streaming'

  // Stick the viewport to the bottom whenever messages change. We keep this
  // dumb on purpose — no "smart" anchor-detection. If a feature wants finer
  // control we add it later.
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = input
    setInput('')
    void send(value)
    inputRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      ;(event.currentTarget.form as HTMLFormElement | null)?.requestSubmit()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary-50/40">
      {error && (
        <div className="flex items-center justify-between border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          <span>{error}</span>
        </div>
      )}
      <div ref={viewportRef} className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </div>
        )}
      </div>
      <form
        onSubmit={handleSubmit}
        className="border-t border-primary-200 bg-white px-3 py-3"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            autoFocus
            placeholder="Message the agent…"
            className="flex-1 resize-none rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-950 placeholder:text-primary-400 focus:border-primary-400 focus:outline-none"
          />
          {isBusy ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-lg border border-primary-200 bg-white px-3 py-2 text-sm text-primary-700 hover:bg-primary-100"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="rounded-lg bg-accent-500 px-3 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center text-center text-primary-500">
      <div>
        <div className="mb-2 text-3xl">💬</div>
        <div className="text-sm">Send a message to start the chat.</div>
        <div className="mt-1 text-[11px] text-primary-400">
          This is chat-v2 (rewritten with single source of truth).
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div
      className={cn(
        'flex',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm',
          isUser
            ? 'bg-primary-200/80 text-primary-950'
            : 'bg-white text-primary-950 ring-1 ring-primary-100',
        )}
      >
        {message.parts.map((part, idx) => (
          <PartRenderer key={idx} part={part} />
        ))}
        {message.streaming && message.role === 'assistant' && (
          <div className="mt-1 inline-flex h-2 w-2 animate-pulse rounded-full bg-primary-400" />
        )}
      </div>
    </div>
  )
}

function PartRenderer({ part }: { part: Part }) {
  if (part.type === 'text') {
    if (!part.text) return null
    return (
      <div className="leading-relaxed">
        <Markdown>{part.text}</Markdown>
      </div>
    )
  }
  if (part.type === 'reasoning') {
    if (!part.text) return null
    return (
      <details className="mb-2 rounded border border-primary-200/60 bg-primary-50/50 px-2 py-1 text-xs">
        <summary className="cursor-pointer text-primary-600">Thinking…</summary>
        <div className="mt-1 whitespace-pre-wrap text-[11px] text-primary-600">
          {part.text}
        </div>
      </details>
    )
  }
  // tool part
  return (
    <details className="my-1 rounded border border-primary-200 bg-primary-50/60 px-2 py-1 text-xs">
      <summary className="cursor-pointer font-mono text-primary-700">
        {part.name}{' '}
        <span className="text-primary-400">
          {part.phase === 'complete'
            ? '✓'
            : part.phase === 'error'
              ? '✗'
              : '…'}
        </span>
      </summary>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-primary-600">
        {JSON.stringify(
          { args: part.args, preview: part.preview, result: part.result },
          null,
          2,
        )}
      </pre>
    </details>
  )
}

