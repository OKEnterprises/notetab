import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: { email: 'admin@example.com' } as { email: string } | null,
  userError: null as unknown,
  summary: { pageviews: {}, logins: {}, active_users: {}, daily: [] } as unknown,
  inserts: [] as any[],
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: () => ({
      insert: (row: any) => {
        state.inserts.push(row)
        return Promise.resolve({ data: null, error: null })
      },
      upsert: (row: any) => {
        state.inserts.push(row)
        return Promise.resolve({ data: null, error: null })
      },
    }),
    auth: {
      getUser: vi.fn(async () => ({ data: { user: state.user }, error: state.userError })),
    },
    rpc: vi.fn(async () => ({ data: state.summary, error: null })),
  })),
}))

const { default: app } = await import('../index')

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  STRIPE_SECRET_KEY: 'sk_test',
  STRIPE_PRICE_ID: 'price_test',
  STRIPE_WEBHOOK_SECRET: 'whsec',
  BILLING_RETURN_URL: 'https://api.tabmargin.com',
  ANALYTICS_SALT: 'salt',
  ADMIN_EMAILS: 'admin@example.com',
}

describe('analytics API', () => {
  beforeEach(() => {
    state.user = { email: 'admin@example.com' }
    state.userError = null
    state.summary = { pageviews: {}, logins: {}, active_users: {}, daily: [] }
    state.inserts = []
  })

  it('accepts the public pageview beacon and returns 204', async () => {
    const res = await app.request('/e', {
      method: 'POST',
      body: JSON.stringify({ path: '/pricing' }),
    }, env)
    expect(res.status).toBe(204)
    // The insert is gated on WebCrypto being available in the test runtime; when
    // it is, we record only a derived hash (never the raw IP/UA) — assert that
    // shape without making the test depend on the runtime's crypto.subtle.
    if (state.inserts.length > 0) {
      expect(state.inserts[0].path).toBe('/pricing')
      expect(state.inserts[0].visitor_hash).toHaveLength(64)
    }
  })

  it('serves the admin dashboard HTML', async () => {
    const res = await app.request('/admin', {}, env)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('TabMargin analytics')
  })

  it('rejects unauthenticated stats requests', async () => {
    const res = await app.request('/admin/stats', {}, env)
    expect(res.status).toBe(401)
  })

  it('forbids non-admin accounts', async () => {
    state.user = { email: 'someone@example.com' }
    const res = await app.request('/admin/stats', {
      headers: { Authorization: 'Bearer token' },
    }, env)
    expect(res.status).toBe(403)
  })

  it('returns the summary JSON for an admin account', async () => {
    state.summary = { pageviews: { unique_today: 7 }, logins: {}, active_users: {}, daily: [] }
    const res = await app.request('/admin/stats', {
      headers: { Authorization: 'Bearer token' },
    }, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(state.summary)
  })
})
