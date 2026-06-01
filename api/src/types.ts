export type Bindings = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  STRIPE_SECRET_KEY: string
  STRIPE_PRICE_ID: string
  STRIPE_WEBHOOK_SECRET: string
  BILLING_RETURN_URL: string
  ALLOWED_ORIGINS?: string
  // Random secret used to derive the daily, cookieless landing-page visitor hash.
  ANALYTICS_SALT?: string
  // Comma-separated emails allowed to read GET /admin analytics.
  ADMIN_EMAILS?: string
}

export type SubRow = {
  status: string
  current_period_end: string | null
  cancel_at_period_end?: boolean
}

// Shape of a row in the `notes` table as selected by the notes routes.
// On tombstone reads (deleted_at set) the API strips title/content, hence optional.
export type NoteRow = {
  id: string
  title?: string
  content?: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}
