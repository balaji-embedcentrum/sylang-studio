/**
 * Sylang chat — hand-rolled minimal alternative to the legacy chat module's
 * 4-state-source / 6-anti-flicker-hack mesh. ONE messages array is the only
 * source of truth. As SSE events arrive, we update the LAST assistant message
 * in that array in place. No mirror caches, no streaming-state map, no
 * completed-text refs, no sticky-text refs, no per-runId dedup layers.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  streamAgentEvents,
  type AgentEvent,
  type ChatAttachmentPayload,
} from './sse-client'

export type Attachment = {
  id: string
  name: string
  contentType: string
  size: number
  /** data:<mime>;base64,<...> — what the server expects in the dataUrl field */
  dataUrl: string
  /** Is this an image we should preview inline in the user bubble? */
  isImage: boolean
}

export type ChatRole = 'user' | 'assistant'

export type ToolPart = {
  type: 'tool'
  id: string
  name: string
  phase: 'start' | 'running' | 'complete' | 'error'
  args?: unknown
  preview?: string
  result?: unknown
}

export type TextPart = { type: 'text'; text: string }
export type ReasoningPart = { type: 'reasoning'; text: string }
export type Part = TextPart | ReasoningPart | ToolPart

export type ChatMessage = {
  id: string
  role: ChatRole
  parts: Array<Part>
  attachments?: Array<Attachment>
  /** true while the assistant message is still streaming */
  streaming?: boolean
  /** wall-clock when the message was first added to the list */
  createdAt: number
}

export type ChatStatus = 'idle' | 'sending' | 'streaming' | 'error'

function makeId() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

type Options = {
  sessionKey: string
  friendlyId: string
  initialMessages?: Array<ChatMessage>
  workspacePath?: string
  localAgentUrl?: string
  localWorkspaceRoot?: string
}

export function useSylangChat(options: Options) {
  const [messages, setMessages] = useState<Array<ChatMessage>>(
    options.initialMessages ?? [],
  )
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const updateAssistant = useCallback(
    (assistantId: string, updater: (msg: ChatMessage) => ChatMessage) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? updater(m) : m)),
      )
    },
    [],
  )

  const applyEvent = useCallback(
    (assistantId: string, event: AgentEvent) => {
      switch (event.type) {
        case 'chunk': {
          const incoming = String(event.data.text ?? '')
          const fullReplace = event.data.fullReplace !== false
          updateAssistant(assistantId, (m) => {
            const parts = [...m.parts]
            const lastIdx = parts.length - 1
            const last = parts[lastIdx]
            if (last?.type === 'text') {
              parts[lastIdx] = {
                type: 'text',
                text: fullReplace ? incoming : last.text + incoming,
              }
            } else {
              parts.push({ type: 'text', text: incoming })
            }
            return { ...m, parts }
          })
          break
        }
        case 'thinking': {
          const incoming = String(event.data.text ?? '')
          updateAssistant(assistantId, (m) => {
            const parts = [...m.parts]
            const existingIdx = parts.findIndex((p) => p.type === 'reasoning')
            if (existingIdx >= 0) {
              parts[existingIdx] = { type: 'reasoning', text: incoming }
            } else {
              parts.unshift({ type: 'reasoning', text: incoming })
            }
            return { ...m, parts }
          })
          break
        }
        case 'tool': {
          const id = String(event.data.toolCallId ?? `tool_${makeId()}`)
          const name = String(event.data.name ?? 'tool')
          const phaseRaw = String(event.data.phase ?? 'running')
          const phase = (
            phaseRaw === 'complete' || phaseRaw === 'completed'
              ? 'complete'
              : phaseRaw === 'error'
                ? 'error'
                : phaseRaw === 'start'
                  ? 'start'
                  : 'running'
          ) as ToolPart['phase']
          updateAssistant(assistantId, (m) => {
            const parts = [...m.parts]
            const existingIdx = parts.findIndex(
              (p) => p.type === 'tool' && p.id === id,
            )
            const next: ToolPart = {
              type: 'tool',
              id,
              name,
              phase,
              args: event.data.args,
              preview:
                typeof event.data.preview === 'string'
                  ? event.data.preview
                  : undefined,
              result: event.data.result,
            }
            if (existingIdx >= 0) {
              parts[existingIdx] = { ...parts[existingIdx], ...next }
            } else {
              parts.push(next)
            }
            return { ...m, parts }
          })
          break
        }
        case 'error': {
          setError(String(event.data.message ?? 'Agent error'))
          break
        }
        default:
          break
      }
    },
    [updateAssistant],
  )

  const send = useCallback(
    async (text: string, attachments?: Array<Attachment>) => {
      const trimmed = text.trim()
      const hasAttachments = Array.isArray(attachments) && attachments.length > 0
      if (!trimmed && !hasAttachments) return
      if (status === 'sending' || status === 'streaming') return

      setError(null)
      const userMessage: ChatMessage = {
        id: makeId(),
        role: 'user',
        parts: trimmed ? [{ type: 'text', text: trimmed }] : [],
        attachments: hasAttachments ? attachments : undefined,
        createdAt: Date.now(),
      }
      const assistantId = makeId()
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        parts: [{ type: 'text', text: '' }],
        streaming: true,
        createdAt: Date.now() + 1,
      }
      setMessages((prev) => [...prev, userMessage, assistantMessage])
      setStatus('sending')

      const abort = new AbortController()
      abortRef.current?.abort()
      abortRef.current = abort

      try {
        const ssePayload: Array<ChatAttachmentPayload> | undefined =
          hasAttachments
            ? attachments.map((a) => ({
                id: a.id,
                name: a.name,
                contentType: a.contentType,
                size: a.size,
                dataUrl: a.dataUrl,
              }))
            : undefined
        const stream = streamAgentEvents({
          sessionKey: optionsRef.current.sessionKey,
          friendlyId: optionsRef.current.friendlyId,
          message: trimmed,
          idempotencyKey: userMessage.id,
          workspacePath: optionsRef.current.workspacePath,
          localAgentUrl: optionsRef.current.localAgentUrl,
          localWorkspaceRoot: optionsRef.current.localWorkspaceRoot,
          attachments: ssePayload,
          signal: abort.signal,
        })
        let sawAnyData = false
        for await (const event of stream) {
          if (!sawAnyData) {
            sawAnyData = true
            setStatus('streaming')
          }
          applyEvent(assistantId, event)
          if (event.type === 'done') break
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'send failed')
      } finally {
        updateAssistant(assistantId, (m) => ({ ...m, streaming: false }))
        if (abortRef.current === abort) abortRef.current = null
        setStatus('idle')
      }
    },
    [status, applyEvent, updateAssistant],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStatus('idle')
  }, [])

  const clear = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return { messages, status, error, send, stop, clear }
}
