import { Hono } from 'hono'
import type { Bindings } from '../types'

// The password-reset page now lives as a static page on app.tabmargin.com
// (Cloudflare Pages), alongside the rest of the web surface. We keep this path
// as a redirect so links that target the API origin still work:
//   - recovery emails sent before the cutover, and
//   - older extension installs whose bundled api.js still builds the
//     redirect_to as `${API_URL}/reset-password`.
// Supabase appends the recovery token as a URL *fragment*
// (#access_token=…&type=recovery). A redirect whose Location has no fragment
// preserves the original one (the browser re-attaches it), so the token rides
// along to the static page untouched.
//
// Hardcoded like the other prod URLs in this codebase (no build step / env
// indirection); intentionally NOT BILLING_RETURN_URL, which may still point at
// this Worker during the transition and would cause a redirect loop.
const WEB_URL = 'https://app.tabmargin.com'

export function accountRoutes() {
  const app = new Hono<{ Bindings: Bindings }>()

  app.get('/reset-password', (c) => c.redirect(`${WEB_URL}/reset-password`, 302))

  return app
}
