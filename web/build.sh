#!/usr/bin/env sh
# Build the static bundle for Cloudflare Pages (app.tabmargin.com).
#
# No bundler. The shared core (sync.js / api.js / script.js / popup.js) and the
# shared styles are copied verbatim from the canonical extension/ directory; the
# web-specific overlays (storage.js / app.js / web.css / index.html / _headers)
# are layered on top. The web storage.js shadows the extension's — it's the one
# file that differs between the two surfaces (localStorage vs browser.storage).
set -e
cd "$(dirname "$0")"

DIST=dist
rm -rf "$DIST"
mkdir -p "$DIST"

# Shared logic — canonical copies live in ../extension (also where api/src/sync.test.ts imports from)
cp ../extension/sync.js ../extension/api.js ../extension/script.js ../extension/popup.js "$DIST"/

# Shared styles
cp ../extension/tokens.css ../extension/styles.css ../extension/popup.css "$DIST"/

# Web-specific overlays (these win over any same-named file copied above)
cp storage.js app.js web.css index.html _headers "$DIST"/

# Standalone auxiliary pages (reset-password + billing landings). These are
# plain static files — no shared core — and link tokens.css (copied above) so
# they match the app. The Worker keeps redirect shims at the old API paths so
# in-flight recovery emails / older extension installs still land here.
cp reset-password.html reset-password.js pages.css "$DIST"/
mkdir -p "$DIST"/billing
cp billing/success.html "$DIST"/billing/success.html
cp billing/cancel.html "$DIST"/billing/cancel.html

echo "Built $DIST/ ($(find "$DIST" -type f | wc -l | tr -d ' ') files)"
