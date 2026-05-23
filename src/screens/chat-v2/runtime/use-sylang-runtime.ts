/**
 * Sylang chat runtime backed by assistant-ui's ExternalStoreRuntime.
 *
 * Single source of truth: one `messages` array, updated in place as the
 * agent's SSE events arrive. No mirror caches, no completed-text refs, no
 * sticky-text hacks. The streaming bubble IS the assistant message — its
 * last text part grows as chunks come in.
 *
 * This replaces the old chat-screen.tsx ↔ chat-store.ts ↔
 * use-realtime-chat-history.ts ↔ use-streaming-message.ts mesh.
 */

import { useCallback, useRef, useState } from 'react'
import {
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { streamAgentEvents, type AgentEvent } from './sse-client'

function makeId() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function extractText(content: AppendMessage['content']): string {
  return content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim()
}

type RuntimeOptions = {
  sessionKey: string
  friendlyId: string
  initialMessages?: Array<ThreadMessageLike>
  workspacePath?: string
  localAgentUrl?: string
  localWorkspaceRoot?: string
  onError?: (message: string) => void
}

export function useSylangRuntime(options: RuntimeOptions) {
  const [messages, setMessages] = useState<Array<ThreadMessageLike>>(
    options.initialMessages ?? [],
  )
  const [isRunning, setIsRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const appendChunkToAssistant = useCallback(
    (assistantId: string, deltaText: string, fullReplace: boolean) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantId) return msg
          const existingContent = Array.isArray(msg.content) ? msg.content : []
          const lastIdx = existingContent.length - 1
          const last = existingContent[lastIdx]
          if (last?.type === 'text') {
            const nextText = fullReplace
              ? deltaText
              : (last.text ?? '') + deltaText
            const nextContent = [...existingContent]
            nextContent[lastIdx] = { ...last, text: nextText }
            return { ...msg, content: nextContent }
          }
          return {
            ...msg,
            content: [...existingContent, { type: 'text', text: deltaText }],
          }
        }),
      )
    },
    [],
  )

  const handleAgentEvent = useCallback(
    (assistantId: string, event: AgentEvent) => {
      switch (event.type) {
        case 'chunk': {
          const text = String(event.data.text ?? '')
          const fullReplace = event.data.fullReplace !== false
          appendChunkToAssistant(assistantId, text, fullReplace)
          break
        }
        case 'thinking': {
          // Surface thinking as a reasoning part. assistant-ui renders it as
          // collapsed reasoning by default. We attach a single growing part.
          const text = String(event.data.text ?? '')
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== assistantId) return msg
              const content = Array.isArray(msg.content) ? msg.content : []
              const existingIdx = content.findIndex(
                (p) => p.type === 'reasoning',
              )
              if (existingIdx >= 0) {
                const nextContent = [...content]
                nextContent[existingIdx] = { type: 'reasoning', text }
                return { ...msg, content: nextContent }
              }
              return {
                ...msg,
                content: [{ type: 'reasoning', text }, ...content],
              }
            }),
          )
          break
        }
        case 'tool': {
          // Tool calls render as raw JSON in stage 1; stage 2 will add the
          // proper TuiActivityCard port. We do persist them so the timeline
          // is complete.
          const toolCallId = String(
            event.data.toolCallId ?? `tool_${makeId()}`,
          )
          const name = String(event.data.name ?? 'tool')
          const args = (event.data.args ?? {}) as Record<string, unknown>
          const result = event.data.result
          const phase = String(event.data.phase ?? 'running')
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== assistantId) return msg
              const content = Array.isArray(msg.content) ? msg.content : []
              const existingIdx = content.findIndex(
                (p) =>
                  p.type === 'tool-call' && p.toolCallId === toolCallId,
              )
              if (existingIdx >= 0) {
                const nextContent = [...content]
                nextContent[existingIdx] = {
                  type: 'tool-call',
                  toolCallId,
                  toolName: name,
                  args,
                  ...(result !== undefined ? { result } : {}),
                  ...(phase ? { argsText: JSON.stringify(args) } : {}),
                } as ThreadMessageLike['content'][number]
                return { ...msg, content: nextContent }
              }
              return {
                ...msg,
                content: [
                  ...content,
                  {
                    type: 'tool-call',
                    toolCallId,
                    toolName: name,
                    args,
                    ...(result !== undefined ? { result } : {}),
                  } as ThreadMessageLike['content'][number],
                ],
              }
            }),
          )
          break
        }
        case 'error': {
          const message = String(event.data.message ?? 'Agent error')
          options.onError?.(message)
          break
        }
        // 'started' / 'message' / 'done' are handled at the run boundary
        default:
          break
      }
    },
    [appendChunkToAssistant, options],
  )

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const userText = extractText(message.content)
      if (!userText) return

      // 1) Optimistic user message
      const userId = makeId()
      const userMessage: ThreadMessageLike = {
        id: userId,
        role: 'user',
        content: [{ type: 'text', text: userText }],
      }
      // 2) Empty assistant placeholder we'll grow as chunks arrive
      const assistantId = makeId()
      const assistantMessage: ThreadMessageLike = {
        id: assistantId,
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
      }

      setMessages((prev) => [...prev, userMessage, assistantMessage])
      setIsRunning(true)

      const abort = new AbortController()
      abortRef.current?.abort()
      abortRef.current = abort

      try {
        const stream = streamAgentEvents({
          sessionKey: options.sessionKey,
          friendlyId: options.friendlyId,
          message: userText,
          idempotencyKey: userId,
          workspacePath: options.workspacePath,
          localAgentUrl: options.localAgentUrl,
          localWorkspaceRoot: options.localWorkspaceRoot,
          signal: abort.signal,
        })
        for await (const event of stream) {
          handleAgentEvent(assistantId, event)
          if (event.type === 'done') break
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'send failed'
        options.onError?.(msg)
      } finally {
        if (abortRef.current === abort) abortRef.current = null
        setIsRunning(false)
      }
    },
    [handleAgentEvent, options],
  )

  const onCancel = useCallback(async () => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsRunning(false)
  }, [])

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning,
    onNew,
    onCancel,
    setMessages: (next) => setMessages(Array.from(next)),
    convertMessage: (msg) => msg,
  })

  return { runtime, messages, isRunning }
}
