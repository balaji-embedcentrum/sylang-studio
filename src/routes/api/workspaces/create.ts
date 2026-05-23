/**
 * POST /api/workspaces/create
 * Body: { name }
 *
 * Creates a new empty project on the agent and registers it in Supabase.
 * Only registers the workspace if the agent actually created the directory
 * AND the agent can find it back through its /tree endpoint. Prior versions
 * fired-and-forgot, which left phantom Supabase rows for projects the agent
 * silently failed to create — see PR #26.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { requireAuth } from '../../../server/supabase-auth'
import { getSupabaseServer } from '../../../lib/supabase'
import { getAgentConfig } from '../../../server/gateway-capabilities'

export const Route = createFileRoute('/api/workspaces/create')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireAuth(request).catch(() => null)
        if (!auth) return json({ error: 'Unauthorized' }, { status: 401 })

        const { name } = await request.json() as { name: string }
        if (!name?.trim()) return json({ error: 'Project name required' }, { status: 400 })

        const projectName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_')

        try {
          const agentConfig = await getAgentConfig(auth.userId).catch(() => null)
          const agentUrl = agentConfig?.url
          if (!agentUrl) {
            return json(
              { error: 'No agent selected. Go to Agents page first.' },
              { status: 400 },
            )
          }

          const agentHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
          }
          if (agentConfig?.apiKey) {
            agentHeaders['Authorization'] = `Bearer ${agentConfig.apiKey}`
          }

          // 1) Ask the agent to create the empty project directory.
          const initRes = await fetch(
            `${agentUrl}/ws/${encodeURIComponent(projectName)}/init`,
            {
              method: 'POST',
              headers: agentHeaders,
              body: JSON.stringify({ empty: true }),
            },
          ).catch((e) => {
            console.error('[workspaces/create] init fetch failed', e)
            return null
          })

          if (!initRes) {
            return json(
              { error: 'Agent unreachable. Check your agent URL and try again.' },
              { status: 502 },
            )
          }

          const initBody = await initRes.json().catch(() => ({})) as {
            status?: string
            action?: string
            path?: string
            message?: string
          }

          if (!initRes.ok || initBody.status !== 'ok') {
            // Fallback: try a direct file write to nudge the agent into
            // materialising the directory. Keeps legacy agents working.
            const fileRes = await fetch(
              `${agentUrl}/ws/${encodeURIComponent(projectName)}/file`,
              {
                method: 'POST',
                headers: agentHeaders,
                body: JSON.stringify({ path: '.gitkeep', content: '' }),
              },
            ).catch(() => null)

            if (!fileRes || !fileRes.ok) {
              return json(
                {
                  error: `Agent could not create project: ${initBody.message ?? `init returned ${initRes.status}`}`,
                },
                { status: 502 },
              )
            }
          }

          // 2) Verify: the agent's tree endpoint must be able to locate the
          //    project by slug. If it can't, the project was created at a
          //    path the agent's find_repo() can't see, and the UI's file
          //    explorer would render an empty workspace forever.
          const treeRes = await fetch(
            `${agentUrl}/ws/${encodeURIComponent(projectName)}/tree`,
            { headers: agentHeaders },
          ).catch(() => null)

          if (!treeRes || !treeRes.ok) {
            return json(
              {
                error:
                  'Agent created the project but cannot find it back via /tree. ' +
                  'This is the known cross-prefix layout bug — re-run after the ' +
                  'agent is patched, or clone an empty GitHub repo instead.',
                agent_reported_path: initBody.path ?? null,
              },
              { status: 502 },
            )
          }

          // 3) Only now register in Supabase. fs_path stores the agent's
          //    actual reported absolute path when available, so cleanup
          //    tooling has a real reference instead of a synthesized one.
          const admin = getSupabaseServer()
          const repoFull = `${auth.profile.github_login}/${projectName}`
          const fsPath = initBody.path ?? `/workspaces/${auth.userId}/${repoFull}`

          await admin.from('workspaces').upsert([
            {
              user_id: auth.userId,
              repo_full: repoFull,
              repo_url: '',
              fs_path: fsPath,
              size_mb: 0,
            },
          ], { onConflict: 'user_id,repo_full' })

          const workspacePath = `${auth.userId}/${repoFull}`

          return json({
            ok: true,
            path: workspacePath,
            agent_reported_path: initBody.path ?? null,
          })
        } catch (e) {
          console.error('[workspaces/create]', e)
          return json({ error: `Failed to create project: ${e}` }, { status: 500 })
        }
      },
    },
  },
})
