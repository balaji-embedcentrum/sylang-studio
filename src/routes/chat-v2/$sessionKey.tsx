/**
 * Route /chat-v2/$sessionKey — feature-flagged side-by-side route for the
 * assistant-ui-based chat rewrite. Once chat-v2 reaches feature parity with
 * the legacy /chat/$sessionKey route, this becomes the default and the old
 * route + screens/chat directory are deleted.
 */

import { createFileRoute } from '@tanstack/react-router'
import { Suspense, lazy, useEffect, useState } from 'react'
import { ErrorBoundary } from '@/components/error-boundary'

const ChatScreenV2 = lazy(async () => {
  const mod = await import('../../screens/chat-v2/chat-screen-v2')
  return { default: mod.ChatScreenV2 }
})

export const Route = createFileRoute('/chat-v2/$sessionKey')({
  component: ChatV2Route,
  ssr: false,
})

function ChatV2Route() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const params = Route.useParams()
  const activeFriendlyId =
    typeof params.sessionKey === 'string' ? params.sessionKey : 'main'

  if (!mounted) {
    return (
      <div className="flex h-full items-center justify-center text-primary-400">
        Loading chat-v2…
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-primary-400">
            Loading chat-v2…
          </div>
        }
      >
        <div className="h-full min-h-0">
          <ChatScreenV2
            sessionKey={activeFriendlyId}
            friendlyId={activeFriendlyId}
          />
        </div>
      </Suspense>
    </ErrorBoundary>
  )
}
