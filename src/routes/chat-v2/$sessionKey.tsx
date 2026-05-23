/**
 * Route /chat-v2/$sessionKey — TEMP DIAGNOSTIC.
 *
 * The hand-rolled chat is rendering blank in the user's browser even though
 * the route is registered and Vite serves the file. Replace the lazy import
 * with a synchronous, single-component render of a static "hello" page so we
 * can confirm the route itself is reachable. If THIS renders, the issue is
 * in the chat-screen-v2 module. If even THIS is blank, the issue is upstream
 * (workspace shell, auth gate, hydration, etc).
 *
 * Once we know which, the real ChatScreenV2 component comes back.
 */

import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/chat-v2/$sessionKey')({
  component: ChatV2DiagnosticRoute,
})

function ChatV2DiagnosticRoute() {
  const params = Route.useParams()
  const sessionKey =
    typeof params.sessionKey === 'string' ? params.sessionKey : 'unknown'

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fafafa',
        color: '#111',
        padding: '2rem',
      }}
    >
      <div style={{ maxWidth: 480, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
          chat-v2 route is reachable
        </h1>
        <p style={{ fontSize: 13, color: '#555' }}>
          session: <code>{sessionKey}</code>
        </p>
        <p style={{ fontSize: 12, color: '#888', marginTop: 16 }}>
          If you see this card but the real chat was blank before, the bug is
          in <code>chat-screen-v2.tsx</code>, not the route or the shell.
        </p>
      </div>
    </div>
  )
}
