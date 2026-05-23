/**
 * Chat Screen v2 — assistant-ui-based replacement for the legacy
 * chat-screen.tsx mesh. Single source of truth for messages, no anti-flicker
 * hacks, no overlapping dedup layers. Behind feature route /chat-v2/$sessionKey
 * during dev; the old /chat/$sessionKey route still runs the legacy code.
 */

import { useState } from 'react'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { useSylangRuntime } from './runtime/use-sylang-runtime'
import { ChatV2Thread } from './components/chat-v2-thread'

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
  const [error, setError] = useState<string | null>(null)
  const { runtime } = useSylangRuntime({
    sessionKey,
    friendlyId,
    workspacePath,
    localAgentUrl,
    localWorkspaceRoot,
    onError: setError,
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full flex-col">
        {error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {error}
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-2 underline"
            >
              dismiss
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          <ChatV2Thread />
        </div>
      </div>
    </AssistantRuntimeProvider>
  )
}
