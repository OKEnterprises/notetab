import { Hono } from 'hono'
import { apiCors } from './security'
import { accountRoutes } from './routes/account'
import { billingRoutes } from './routes/billing'
import { meRoutes } from './routes/me'
import { notesRoutes } from './routes/notes'
import { analyticsRoutes, stampActivity } from './routes/analytics'
import type { Bindings } from './types'

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', apiCors)

// The *Routes() factories return a fresh Hono sub-app per call. There's no DI to
// inject (env arrives per-request via c.env), so the factory exists mainly to keep
// each module self-contained and independently mountable/testable.
//
// URL surface (route modules declare their own full paths, so meRoutes /
// billingRoutes / accountRoutes all mount at '/'):
//   GET    /health                          — liveness probe
//   GET    /me                              — meRoutes
//   GET    /notes, PUT/DELETE /notes/:id    — notesRoutes (gated by requirePro)
//   POST   /billing/checkout, /billing/portal, /webhooks/stripe
//   GET    /billing/success, /billing/cancel  — 302 shims -> static pages on the web app
//   GET    /reset-password                  — 302 shim -> static page on the web app (accountRoutes)
//   POST   /e                               — public cookieless pageview beacon (analyticsRoutes)
//   GET    /admin, /admin/stats             — analytics dashboard + admin-gated metrics JSON
app.get('/health', (c) => c.json({ ok: true }))
// Mounted before meRoutes so it stamps the active-user heartbeat on every /me hit.
app.use('/me', stampActivity)
app.route('/', meRoutes())
app.route('/notes', notesRoutes())
app.route('/', billingRoutes())
app.route('/', accountRoutes())
app.route('/', analyticsRoutes())

export default app
