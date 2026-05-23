/**
 * Sylang chat thread UI using assistant-ui primitives. Composed by hand
 * (rather than using the high-level <Thread /> component) so the visual
 * styling matches the rest of the studio and we can swap in the existing
 * markdown / code-block renderers.
 */

import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useMessage,
  useThread,
} from '@assistant-ui/react'
import { SendIcon, StopCircleIcon } from 'lucide-react'
import { Markdown } from '@/components/prompt-kit/markdown'

function MessageText() {
  const text = useMessage((m) => {
    const parts = Array.isArray(m.content) ? m.content : []
    return parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('')
  })

  if (!text) return null
  return (
    <div className="text-sm leading-relaxed">
      <Markdown>{text}</Markdown>
    </div>
  )
}

function ToolCallList() {
  const toolCalls = useMessage((m) => {
    const parts = Array.isArray(m.content) ? m.content : []
    return parts.filter(
      (p): p is {
        type: 'tool-call'
        toolCallId: string
        toolName: string
        args: Record<string, unknown>
        result?: unknown
      } => p.type === 'tool-call',
    )
  })

  if (toolCalls.length === 0) return null
  return (
    <div className="mt-2 space-y-1">
      {toolCalls.map((tc) => (
        <details
          key={tc.toolCallId}
          className="rounded border border-primary-200 bg-primary-50/60 px-2 py-1 text-xs"
        >
          <summary className="cursor-pointer font-mono text-primary-700">
            {tc.toolName}
            {tc.result !== undefined ? ' ✓' : ' …'}
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-primary-600">
            {JSON.stringify(
              { args: tc.args, result: tc.result },
              null,
              2,
            )}
          </pre>
        </details>
      ))}
    </div>
  )
}

function ReasoningBlock() {
  const reasoning = useMessage((m) => {
    const parts = Array.isArray(m.content) ? m.content : []
    const r = parts.find(
      (p): p is { type: 'reasoning'; text: string } => p.type === 'reasoning',
    )
    return r?.text ?? ''
  })
  if (!reasoning) return null
  return (
    <details className="mb-2 rounded border border-primary-200/60 bg-primary-50/40 px-2 py-1 text-xs">
      <summary className="cursor-pointer text-primary-600">Thinking…</summary>
      <div className="mt-1 whitespace-pre-wrap text-[11px] text-primary-600">
        {reasoning}
      </div>
    </details>
  )
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end px-4 py-2">
      <div className="max-w-[80%] rounded-2xl bg-primary-200/70 px-4 py-2 text-sm text-primary-950">
        <MessageText />
      </div>
    </MessagePrimitive.Root>
  )
}

function AssistantMessage() {
  const isThreadRunning = useThread((t) => t.isRunning)
  // The streaming dot shows whenever the agent is mid-run AND this is the
  // last assistant message. assistant-ui rerenders this on every message
  // change so we don't need to gate further.
  return (
    <MessagePrimitive.Root className="flex justify-start px-4 py-2">
      <div className="max-w-[80%] rounded-2xl bg-white px-4 py-3 shadow-sm">
        <ReasoningBlock />
        <MessageText />
        <ToolCallList />
        {isThreadRunning && (
          <div className="mt-2 inline-flex h-2 w-2 animate-pulse rounded-full bg-primary-400" />
        )}
      </div>
    </MessagePrimitive.Root>
  )
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="flex items-end gap-2 border-t border-primary-200 bg-white p-3">
      <ComposerPrimitive.Input
        autoFocus
        rows={1}
        placeholder="Message the agent…"
        className="flex-1 resize-none rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-950 placeholder:text-primary-400 focus:border-primary-400 focus:outline-none"
      />
      <ComposerSendOrStop />
    </ComposerPrimitive.Root>
  )
}

function ComposerSendOrStop() {
  const isRunning = useThread((t) => t.isRunning)
  if (isRunning) {
    return (
      <ComposerPrimitive.Cancel
        className="rounded-lg border border-primary-200 p-2 text-primary-600 hover:bg-primary-100"
        aria-label="Stop"
      >
        <StopCircleIcon className="size-4" />
      </ComposerPrimitive.Cancel>
    )
  }
  return (
    <ComposerPrimitive.Send
      className="rounded-lg bg-accent-500 p-2 text-white hover:bg-accent-600 disabled:opacity-50"
      aria-label="Send"
    >
      <SendIcon className="size-4" />
    </ComposerPrimitive.Send>
  )
}

export function ChatV2Thread() {
  return (
    <ThreadPrimitive.Root className="flex h-full flex-col bg-primary-50/50">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto">
        <ThreadPrimitive.Empty>
          <div className="flex h-full items-center justify-center p-8 text-center text-primary-500">
            <div>
              <div className="mb-2 text-2xl">💬</div>
              <div className="text-sm">Send a message to start.</div>
            </div>
          </div>
        </ThreadPrimitive.Empty>
        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage,
          }}
        />
      </ThreadPrimitive.Viewport>
      <Composer />
    </ThreadPrimitive.Root>
  )
}
