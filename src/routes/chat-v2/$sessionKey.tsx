/**
 * Route /chat-v2/$sessionKey — feature-flagged side-by-side route for the
 * hand-rolled chat rewrite. Once chat-v2 reaches feature parity with the
 * legacy /chat/$sessionKey route, this becomes the default and the old
 * route + src/screens/chat/ are deleted.
 *
 * Synchronous import on purpose: the prior lazy/Suspense version was
 * rendering blank silently because the lazy chunk's error wasn't surfacing
 * through Suspense in this TanStack Start setup. Going sync forces any
 * import/eval failure to bubble up to the ErrorBoundary, where the user can
 * see what went wrong instead of staring at a blank page.
 */

import { createFileRoute } from '@tanstack/react-router'
import { ErrorBoundary } from '@/components/error-boundary'
import { ChatScreenV2 } from '../../screens/chat-v2/chat-screen-v2'

export const Route = createFileRoute('/chat-v2/$sessionKey')({
  component: ChatV2Route,
})

function ChatV2Route() {
  const params = Route.useParams()
  const activeFriendlyId =
    typeof params.sessionKey === 'string' ? params.sessionKey : 'main'

  return (
    <ErrorBoundary>
      <div className="h-full min-h-0">
        <ChatScreenV2
          sessionKey={activeFriendlyId}
          friendlyId={activeFriendlyId}
        />
      </div>
    </ErrorBoundary>
  )
}
