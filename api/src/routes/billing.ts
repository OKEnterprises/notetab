import { Hono } from 'hono'
import Stripe from 'stripe'
import { requireAuth } from '../auth'
import { serviceClient, userClient } from '../db'
import type { Bindings } from '../types'

// Stripe's post-checkout/portal landing pages are now static on the web app.
// These GET routes remain as redirect shims so any Stripe Session created with
// the old `${BILLING_RETURN_URL}/billing/*` URLs (before BILLING_RETURN_URL is
// repointed at the web origin) still lands somewhere sensible. Hardcoded — and
// intentionally NOT BILLING_RETURN_URL, which may still be this Worker mid-
// transition and would redirect-loop.
const WEB_URL = 'https://app.tabmargin.com'

// Pin the API version the SDK (and this code) was written against so object
// shapes can't shift silently under us when Stripe rolls the account default.
// `current_period_end` lives on the Subscription at this version; the
// SubscriptionItem fallback in the webhook stays as defence for later versions.
const STRIPE_API_VERSION = '2025-02-24.acacia'

function getStripe(env: Bindings): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  })
}

export function billingRoutes() {
  const app = new Hono<{ Bindings: Bindings }>()

  app.post('/billing/checkout', requireAuth, async (c) => {
    const sb = userClient(c.env, c.req.header('Authorization')!)
    const { data: userData, error: userErr } = await sb.auth.getUser()
    if (userErr || !userData.user) return c.json({ error: 'unauthorized' }, 401)

    const stripe = getStripe(c.env)
    const { data: existingSub } = await sb
      .from('subscriptions')
      .select('stripe_customer_id')
      .maybeSingle()

    let customerId = existingSub?.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userData.user.email,
        metadata: { supabase_user_id: userData.user.id },
      })
      customerId = customer.id
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: c.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${c.env.BILLING_RETURN_URL}/billing/success`,
      cancel_url: `${c.env.BILLING_RETURN_URL}/billing/cancel`,
      client_reference_id: userData.user.id,
      metadata: { supabase_user_id: userData.user.id },
      allow_promotion_codes: true,
    })

    return c.json({ url: session.url })
  })

  app.post('/billing/portal', requireAuth, async (c) => {
    const sb = userClient(c.env, c.req.header('Authorization')!)
    const { data: sub } = await sb
      .from('subscriptions')
      .select('stripe_customer_id')
      .maybeSingle()

    if (!sub?.stripe_customer_id) return c.json({ error: 'no subscription' }, 404)

    const stripe = getStripe(c.env)
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${c.env.BILLING_RETURN_URL}/billing/success`,
    })

    return c.json({ url: session.url })
  })

  app.get('/billing/success', (c) => c.redirect(`${WEB_URL}/billing/success`, 302))
  app.get('/billing/cancel', (c) => c.redirect(`${WEB_URL}/billing/cancel`, 302))

  // Idempotency note: we don't dedup on event.id. Instead every subscription
  // event triggers stripe.subscriptions.retrieve(), so we always upsert Stripe's
  // *current* state regardless of which (or how many duplicate/replayed) events
  // arrive — replays and most out-of-order deliveries converge to the same row.
  // A processed-events table would be needed to fully close concurrent races;
  // that's deferred as it requires schema and is not warranted at this volume.
  app.post('/webhooks/stripe', async (c) => {
    const signature = c.req.header('stripe-signature')
    if (!signature) return c.json({ error: 'no signature' }, 400)

    const body = await c.req.text()
    const stripe = getStripe(c.env)

    let event: Stripe.Event
    try {
      event = await stripe.webhooks.constructEventAsync(
        body,
        signature,
        c.env.STRIPE_WEBHOOK_SECRET
      )
    } catch (err) {
      console.error('webhook signature verification failed:', err)
      return c.json({ error: 'invalid signature' }, 400)
    }

    const sbAdmin = serviceClient(c.env)

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const eventSub = event.data.object as Stripe.Subscription
        let sub: Stripe.Subscription
        try {
          sub = await stripe.subscriptions.retrieve(eventSub.id)
        } catch (err) {
          console.error('failed to retrieve subscription', eventSub.id, err)
          break
        }

        const customer = await stripe.customers.retrieve(sub.customer as string)
        if (customer.deleted) break

        const userId = (customer as Stripe.Customer).metadata.supabase_user_id
        console.log('webhook', event.type, { customerId: customer.id, userId, subId: sub.id, status: sub.status })
        if (!userId) {
          console.error('no supabase_user_id on customer', customer.id, 'metadata:', (customer as Stripe.Customer).metadata)
          break
        }

        const periodEndUnix =
          (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end ??
          (sub.items.data[0] as Stripe.SubscriptionItem & { current_period_end?: number })?.current_period_end

        const { error } = await sbAdmin.from('subscriptions').upsert(
          {
            user_id: userId,
            stripe_customer_id: customer.id,
            stripe_subscription_id: sub.id,
            status: sub.status,
            price_id: sub.items.data[0]?.price.id,
            current_period_end: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
            cancel_at_period_end: sub.cancel_at_period_end,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )

        if (error) console.error('subscription upsert error:', error)
        break
      }
      default:
        break
    }

    return c.json({ received: true })
  })

  return app
}
