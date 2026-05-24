/**
 * Chat Screen v2 — minimal hand-rolled replacement for the legacy 5000+ line
 * chat module. One messages array as the only source of truth (see
 * useSylangChat). Feature-flagged at /chat-v2/<sessionKey> alongside the
 * legacy /chat route; old chat code stays in place until v2 reaches feature
 * parity, then both routes flip to this implementation.
 */

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import {
  useSylangChat,
  type Attachment,
  type ChatMessage,
  type Part,
} from './runtime/use-sylang-chat'
import { useHistoryHydration } from './hooks/use-history-hydration'
import { SessionsSidebar } from './components/sessions-sidebar'
import { ToolSection } from './components/tool-section'
import { Markdown } from '@/components/prompt-kit/markdown'
import { cn } from '@/lib/utils'

type Props = {
  sessionKey: string
  friendlyId: string
  workspacePath?: string
  localAgentUrl?: string
  localWorkspaceRoot?: string
}

function makeAttachmentId() {
  return `att_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Could not read file as data URL'))
        return
      }
      const contentType = file.type || 'application/octet-stream'
      resolve({
        id: makeAttachmentId(),
        name: file.name || 'attachment',
        contentType,
        size: file.size,
        dataUrl: result,
        isImage: contentType.toLowerCase().startsWith('image/'),
      })
    }
    reader.onerror = () =>
      reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(file)
  })
}

export function ChatScreenV2(props: Props) {
  // Fetch /api/history BEFORE mounting the chat hook so its initial state
  // already has the previous turns. Avoids the double-render flash you'd
  // get if we seeded via a post-mount effect.
  const hydration = useHistoryHydration(props.sessionKey)

  if (hydration.status === 'loading') {
    return (
      <div className="flex h-full min-h-0">
        <SessionsSidebar currentSessionKey={props.sessionKey} />
        <div className="flex flex-1 items-center justify-center text-sm text-primary-400">
          Loading conversation…
        </div>
      </div>
    )
  }

  // Hard error fetching history — show it but still let the user start
  // a new conversation (they can recover by sending a message; the agent
  // session can be rebuilt from scratch).
  const initialMessages =
    hydration.status === 'ready' ? hydration.messages : []
  const hydrationError =
    hydration.status === 'error' ? hydration.error : null

  // key={sessionKey} forces a clean useSylangChat remount when the
  // session changes via the sessions sidebar — fresh state, fresh
  // history-hydrated initial messages, no leakage from the previous
  // thread.
  return (
    <div className="flex h-full min-h-0">
      <SessionsSidebar currentSessionKey={props.sessionKey} />
      <div className="min-w-0 flex-1">
        <ChatScreenV2Inner
          key={props.sessionKey}
          {...props}
          initialMessages={initialMessages}
          hydrationError={hydrationError}
        />
      </div>
    </div>
  )
}

type InnerProps = Props & {
  initialMessages: Array<ChatMessage>
  hydrationError: string | null
}

function ChatScreenV2Inner({
  sessionKey,
  friendlyId,
  workspacePath,
  localAgentUrl,
  localWorkspaceRoot,
  initialMessages,
  hydrationError,
}: InnerProps) {
  const { messages, status, error, send, stop } = useSylangChat({
    sessionKey,
    friendlyId,
    workspacePath,
    localAgentUrl,
    localWorkspaceRoot,
    initialMessages,
  })
  const [input, setInput] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState<
    Array<Attachment>
  >([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const isBusy = status === 'sending' || status === 'streaming'

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  const ingestFiles = useCallback(async (files: Array<File> | FileList) => {
    setAttachmentError(null)
    const list = Array.from(files)
    if (list.length === 0) return
    try {
      const next = await Promise.all(list.map(fileToAttachment))
      setPendingAttachments((prev) => [...prev, ...next])
    } catch (err) {
      setAttachmentError(
        err instanceof Error ? err.message : 'Could not attach file',
      )
    }
  }, [])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isBusy) return
    const value = input
    const attachments = pendingAttachments
    if (!value.trim() && attachments.length === 0) return
    setInput('')
    setPendingAttachments([])
    void send(value, attachments)
    inputRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      ;(event.currentTarget.form as HTMLFormElement | null)?.requestSubmit()
    }
  }

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) return
    void ingestFiles(event.target.files)
    // Allow re-selecting the same file later
    event.target.value = ''
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items
    if (!items) return
    const files: Array<File> = []
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      event.preventDefault()
      void ingestFiles(files)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDraggingOver(false)
    if (event.dataTransfer.files.length === 0) return
    void ingestFiles(event.dataTransfer.files)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault()
      setIsDraggingOver(true)
    }
  }

  const handleDragLeave = () => setIsDraggingOver(false)

  const removeAttachment = (id: string) =>
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id))

  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-primary-50/40"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-accent-500/10 ring-2 ring-inset ring-accent-500">
          <div className="rounded-lg bg-white px-4 py-2 text-sm text-accent-700 shadow-md">
            Drop files to attach
          </div>
        </div>
      )}
      {(error || attachmentError || hydrationError) && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {error ?? attachmentError ?? `Couldn't load history: ${hydrationError}`}
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
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingAttachments.map((att) => (
                <AttachmentChip
                  key={att.id}
                  attachment={att}
                  onRemove={() => removeAttachment(att.id)}
                />
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded-lg border border-primary-200 bg-white p-2 text-primary-600 hover:bg-primary-100"
              aria-label="Attach files"
              title="Attach files"
            >
              📎
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={handleFileInputChange}
            />
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={1}
              autoFocus
              placeholder="Message the agent… (paste / drop files to attach)"
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
                disabled={!input.trim() && pendingAttachments.length === 0}
                className="rounded-lg bg-accent-500 px-3 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
              >
                Send
              </button>
            )}
          </div>
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

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 py-1 pl-1 pr-2">
      {attachment.isImage ? (
        <img
          src={attachment.dataUrl}
          alt={attachment.name}
          className="h-10 w-10 rounded object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded bg-white text-base">
          📄
        </div>
      )}
      <div className="text-xs">
        <div className="max-w-[140px] truncate text-primary-800">
          {attachment.name}
        </div>
        <div className="text-primary-500">{formatBytes(attachment.size)}</div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 rounded p-1 text-primary-500 hover:bg-primary-200/60 hover:text-primary-800"
        aria-label="Remove attachment"
      >
        ×
      </button>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm',
          isUser
            ? 'bg-primary-200/80 text-primary-950'
            : 'bg-white text-primary-950 ring-1 ring-primary-100',
        )}
      >
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.attachments.map((att) => (
              <AttachmentPreview key={att.id} attachment={att} />
            ))}
          </div>
        )}
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

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  if (attachment.isImage) {
    return (
      <a
        href={attachment.dataUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
      >
        <img
          src={attachment.dataUrl}
          alt={attachment.name}
          className="max-h-48 rounded-lg object-cover"
        />
      </a>
    )
  }
  return (
    <div className="inline-flex items-center gap-2 rounded-lg bg-white/60 px-2 py-1 text-xs text-primary-800 ring-1 ring-primary-200">
      <span>📄</span>
      <span className="max-w-[160px] truncate">{attachment.name}</span>
      <span className="text-primary-500">{formatBytes(attachment.size)}</span>
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
    const preview = part.text.split('\n')[0].trim()
    const short = preview.length > 80 ? `${preview.slice(0, 77)}…` : preview
    return (
      <details className="mb-2 rounded border border-primary-200/60 bg-primary-50/40 text-xs">
        <summary className="flex cursor-pointer items-baseline gap-2 px-2 py-1.5 text-primary-700 hover:bg-primary-100/60">
          <span className="font-mono text-sm">💭</span>
          <span className="font-medium">Thinking</span>
          {short && (
            <span className="truncate text-primary-500">{short}</span>
          )}
        </summary>
        <div className="border-t border-primary-200/50 px-2 py-2">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-white/60 p-1.5 font-sans text-[11px] leading-snug text-primary-700 ring-1 ring-primary-200/40">
            {part.text}
          </pre>
        </div>
      </details>
    )
  }
  // tool part — delegate to the proper TUI-style card
  return <ToolSection tool={part} />
}
