import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { serviceClient } from '../db'
import { nonce, withHtmlSecurity } from '../security'
import { adminDashboardPage } from '../views/admin'
import type { Bindings } from '../types'

// UTC calendar day, YYYY-MM-DD — matches the date math in analytics_summary().
function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

// Decode (without verifying) the `sub` claim of a Supabase JWT. We don't need to
// trust it for the activity heartbeat: the row FKs to auth.users(id), so a
// forged/garbage sub just fails the insert and is swallowed. Privileged reads
// (/admin/stats) verify the token properly via auth.getUser().
function jwtSub(token: string): string | null {
  try {
    const payload = token.split('.')[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const sub = JSON.parse(json).sub
    return typeof sub === 'string' ? sub : null
  } catch {
    return null
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Active-user heartbeat. Mounted on /me (which the web app hits on load and on
// focus for every signed-in user), it records one row per user per UTC day.
// Fire-and-forget via waitUntil so it never adds latency to /me, and every error
// is swallowed — analytics must never break the request.
export const stampActivity: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  const auth = c.req.header('Authorization')
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  const sub = token ? jwtSub(token) : null
  if (sub) {
    const job = (async () => {
      try {
        await serviceClient(c.env)
          .from('analytics_user_activity')
          .upsert(
            { user_id: sub, day: utcDay(), last_seen_at: new Date().toISOString() },
            { onConflict: 'user_id,day' },
          )
      } catch {
        /* swallow — never affect the request */
      }
    })()
    try {
      c.executionCtx.waitUntil(job)
    } catch {
      /* no ExecutionContext (e.g. tests) — let the job run detached */
    }
  }
  await next()
}

export function analyticsRoutes() {
  const app = new Hono<{ Bindings: Bindings }>()

  // Public, unauthenticated pageview beacon for the marketing site. Called via
  // navigator.sendBeacon() with a text/plain body (a CORS-safelisted request, so
  // no preflight and no CORS allow-list needed) — the response is ignored. All
  // dedup is server-side and cookieless: we hash IP+UA with a daily-rotating
  // salt and store nothing that identifies the visitor.
  app.post('/e', async (c) => {
    let body: { path?: string; referrer?: string } = {}
    try {
      const raw = await c.req.text()
      if (raw) body = JSON.parse(raw)
    } catch {
      /* malformed beacon body — still record a bare pageview */
    }

    const ip = c.req.header('CF-Connecting-IP') ?? ''
    const ua = c.req.header('User-Agent') ?? ''
    const country = c.req.header('CF-IPCountry') ?? null

    try {
      const visitorHash = await sha256Hex(`${c.env.ANALYTICS_SALT ?? ''}|${utcDay()}|${ip}|${ua}`)
      await serviceClient(c.env).from('analytics_pageviews').insert({
        path: (body.path ?? '/').slice(0, 512),
        referrer: body.referrer ? body.referrer.slice(0, 512) : null,
        country,
        visitor_hash: visitorHash,
      })
    } catch {
      /* swallow — a dropped analytics hit must never surface as an error */
    }
    return c.body(null, 204)
  })

  // Server-rendered analytics dashboard. The page itself is public HTML; it signs
  // in against Supabase client-side to obtain a token, then calls /admin/stats —
  // which is the actual access-gated endpoint. connect-src is widened to
  // SUPABASE_URL so the inline script can hit /auth/v1/token.
  app.get('/admin', (c) => {
    const n = nonce()
    withHtmlSecurity(c, n, `'self' ${c.env.SUPABASE_URL}`)
    return c.html(adminDashboardPage(n, c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY))
  })

  // Access-gated metrics JSON. Verifies the JWT and checks the email against the
  // ADMIN_EMAILS allow-list before returning anything.
  app.get('/admin/stats', async (c) => {
    const auth = c.req.header('Authorization')
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
    if (!token) return c.json({ error: 'unauthorized' }, 401)

    const sb = serviceClient(c.env)
    const { data: userData, error: userErr } = await sb.auth.getUser(token)
    const email = userData?.user?.email
    if (userErr || !email) return c.json({ error: 'unauthorized' }, 401)

    const admins = (c.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    if (!admins.includes(email.toLowerCase())) {
      return c.json({ error: 'forbidden' }, 403)
    }

    const { data, error } = await sb.rpc('analytics_summary')
    if (error) {
      console.error('analytics_summary error:', error)
      return c.json({ error: 'internal error' }, 500)
    }
    return c.json(data)
  })

  return app
}
