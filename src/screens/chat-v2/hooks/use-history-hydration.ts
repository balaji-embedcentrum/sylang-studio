/**
 * Fetch /api/history for a session and convert the legacy ChatMessage shape
 * to chat-v2's Part-based ChatMessage. Returns one of three states:
 *   - { status: 'loading' }
 *   - { status: 'error', error }
 *   - { status: 'ready', messages }
 *
 * The wrapper component above renders nothing of substance until status
 * leaves 'loading' so useSylangChat's initial state has the loaded
 * messages from the start (no double-render flash, no need to thread a
 * post-mount hydrate callback through the chat hook).
 */

import { useEffect, useState } from 'react'
import type { ChatMessage, Part, ToolPart } from '../runtime/use-sylang-chat'

type HydrationState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; messages: Array<ChatMessage> }

type ApiContentPart = {
  type?: string
  text?: string
  name?: string
  id?: string
  arguments?: Record<string, unknown>
  toolCallId?: string
  toolName?: string
  [k: string]: unknown
}

type ApiMessage = {
  id?: string
  role?: string
  content?: Array<ApiContentPart> | string
  text?: string
  timestamp?: number
  createdAt?: string | number
}

function convertContentParts(rawContent: ApiMessage['content']): Array<Part> {
  if (typeof rawContent === 'string') {
    return rawContent ? [{ type: 'text', text: rawContent }] : []
  }
  if (!Array.isArray(rawContent)) return []

  const parts: Array<Part> = []
  for (const p of rawContent) {
    const t = p?.type
    if (t === 'text' && typeof p.text === 'string' && p.text.length > 0) {
      parts.push({ type: 'text', text: p.text })
    } else if (t === 'toolCall' || t === 'tool_call' || t === 'tool-call') {
      const id =
        typeof p.id === 'string'
          ? p.id
          : typeof p.toolCallId === 'string'
            ? p.toolCallId
            : `tool_${Math.random().toString(36).slice(2, 10)}`
      const name =
        typeof p.name === 'string'
          ? p.name
          : typeof p.toolName === 'string'
            ? p.toolName
            : 'tool'
      const args =
        p.arguments && typeof p.arguments === 'object'
          ? (p.arguments as Record<string, unknown>)
          : undefined
      const tool: ToolPart = {
        type: 'tool',
        id,
        name,
        phase: 'complete',
        args,
      }
      parts.push(tool)
    } else if (t === 'tool_result' || t === 'toolResult') {
      // Merge into the matching tool part if we have one, else drop.
      const matchId =
        typeof p.toolCallId === 'string'
          ? p.toolCallId
          : typeof p.id === 'string'
            ? p.id
            : ''
      const existing = parts.find(
        (q): q is ToolPart => q.type === 'tool' && q.id === matchId,
      )
      if (existing) {
        existing.result = p.text ?? p
      }
    }
  }
  return parts
}

function convertMessage(raw: ApiMessage): ChatMessage | null {
  const role = raw.role === 'user' ? 'user' : raw.role === 'assistant' ? 'assistant' : null
  if (!role) return null
  const id = typeof raw.id === 'string' ? raw.id : `m_${Math.random().toString(36).slice(2, 10)}`
  const parts = convertContentParts(raw.content)
  // If after conversion there's no usable content (e.g. tool-only assistant
  // turn whose tool parts we couldn't reconstruct), still surface the raw
  // .text if present so the message isn't blank.
  if (parts.length === 0 && typeof raw.text === 'string' && raw.text.trim().length > 0) {
    parts.push({ type: 'text', text: raw.text })
  }
  if (parts.length === 0) return null
  const createdAt =
    typeof raw.timestamp === 'number'
      ? raw.timestamp
      : typeof raw.createdAt === 'string'
        ? Date.parse(raw.createdAt) || Date.now()
        : Date.now()
  return { id, role, parts, createdAt }
}

export function useHistoryHydration(sessionKey: string): HydrationState {
  const [state, setState] = useState<HydrationState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    const url = `/api/history?friendlyId=${encodeURIComponent(sessionKey)}&limit=200`
    fetch(url, { cache: 'no-store', credentials: 'same-origin' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`history fetch returned ${r.status}`)
        return r.json() as Promise<{ messages?: Array<ApiMessage> }>
      })
      .then((data) => {
        if (cancelled) return
        const rawMessages = Array.isArray(data.messages) ? data.messages : []
        const converted = rawMessages
          .map(convertMessage)
          .filter((m): m is ChatMessage => m !== null)
        setState({ status: 'ready', messages: converted })
      })
      .catch((err) => {
        if (cancelled) return
        setState({
          status: 'error',
          error: err instanceof Error ? err.message : 'failed to load history',
        })
      })
    return () => {
      cancelled = true
    }
  }, [sessionKey])

  return state
}
