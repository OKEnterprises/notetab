// Server-rendered analytics dashboard (GET /admin). Self-contained: a login form
// that signs in against Supabase client-side, then fetches the access-gated
// /admin/stats JSON and renders it. Styled to match the product's monospace,
// low-chrome aesthetic. The inline <style>/<script> carry the CSP nonce; only
// the nonce and the (public) Supabase URL + anon key are interpolated from the
// server — the client script itself contains no template placeholders.
export function adminDashboardPage(scriptNonce: string, supabaseUrl: string, anonKey: string): string {
  const cfg = JSON.stringify({ supabaseUrl, anonKey })
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TabMargin — analytics</title>
<style nonce="${scriptNonce}">
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 0 auto; padding: 2rem 1.25rem; max-width: 820px; }
  h1 { font-size: 1.05rem; font-weight: 600; margin: 0 0 .25rem; }
  h2 { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; opacity: .55; margin: 0 0 .5rem; }
  .muted { opacity: .55; }
  form { display: flex; gap: .5rem; flex-wrap: wrap; margin: 1.25rem 0; }
  input, button { font: inherit; padding: .5rem .6rem; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 5px; background: transparent; color: inherit; }
  button { cursor: pointer; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: .6rem; }
  .card { border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 6px; padding: .7rem .8rem; }
  .card .n { font-size: 1.5rem; font-weight: 600; }
  .card .l { font-size: .68rem; text-transform: uppercase; letter-spacing: .04em; opacity: .55; }
  section { margin-top: 1.5rem; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; font-size: .78rem; }
  th, td { text-align: right; padding: .3rem .5rem; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); }
  th:first-child, td:first-child { text-align: left; }
  .err { color: #c0392b; margin: .5rem 0; }
</style>
</head>
<body>
  <h1>TabMargin analytics</h1>
  <p class="muted">Sign in with an admin account to view metrics.</p>
  <form id="login">
    <input id="email" type="email" placeholder="email" autocomplete="username" required>
    <input id="password" type="password" placeholder="password" autocomplete="current-password" required>
    <button type="submit">Sign in</button>
  </form>
  <div id="error" class="err" hidden></div>
  <div id="report" hidden></div>

  <script nonce="${scriptNonce}">
  (function () {
    var CFG = ${cfg};
    var loginForm = document.getElementById('login');
    var errorBox = document.getElementById('error');
    var report = document.getElementById('report');

    function showError(msg) { errorBox.textContent = msg; errorBox.hidden = false; }
    function num(n) { return (n == null ? 0 : n).toLocaleString(); }
    function card(value, label) {
      return '<div class="card"><div class="n">' + num(value) + '</div><div class="l">' + label + '</div></div>';
    }

    function render(d) {
      var pv = d.pageviews || {}, lg = d.logins || {}, au = d.active_users || {};
      var html = '';
      html += '<section><h2>Landing page — unique visitors</h2><div class="cards">';
      html += card(pv.unique_today, 'today');
      html += card(pv.unique_visitor_days_7d, '7d (visitor-days)');
      html += card(pv.unique_visitor_days_30d, '30d (visitor-days)');
      html += card(pv.total_30d, 'pageviews 30d');
      html += '</div></section>';

      html += '<section><h2>Logins</h2><div class="cards">';
      html += card(lg.today, 'today');
      html += card(lg.d7, 'last 7d');
      html += card(lg.d30, 'last 30d');
      html += '</div></section>';

      html += '<section><h2>Active users (signed-in, web)</h2><div class="cards">';
      html += card(au.dau, 'DAU');
      html += card(au.wau, 'WAU');
      html += card(au.mau, 'MAU');
      html += '</div></section>';

      var rows = (d.daily || []).slice().reverse();
      html += '<section><h2>Last 30 days</h2><table><thead><tr>';
      html += '<th>Day</th><th>Unique visitors</th><th>Logins</th><th>Active users</th>';
      html += '</tr></thead><tbody>';
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        html += '<tr><td>' + r.day + '</td><td>' + num(r.unique_visitors) +
          '</td><td>' + num(r.logins) + '</td><td>' + num(r.active_users) + '</td></tr>';
      }
      html += '</tbody></table></section>';
      html += '<p class="muted">All windows are UTC calendar days. ' +
        'Firefox-extension active users live in the Mozilla AMO developer dashboard.</p>';

      report.innerHTML = html;
      report.hidden = false;
    }

    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      errorBox.hidden = true;
      var email = document.getElementById('email').value.trim();
      var password = document.getElementById('password').value;

      fetch(CFG.supabaseUrl + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': CFG.anonKey },
        body: JSON.stringify({ email: email, password: password })
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error_description || data.msg || 'Sign-in failed');
          return data.access_token;
        });
      }).then(function (token) {
        return fetch('/admin/stats', { headers: { 'Authorization': 'Bearer ' + token } });
      }).then(function (res) {
        if (res.status === 403) throw new Error('That account is not an admin.');
        if (!res.ok) throw new Error('Could not load stats (' + res.status + ').');
        return res.json();
      }).then(function (data) {
        loginForm.hidden = true;
        render(data);
      }).catch(function (err) {
        showError(err.message || String(err));
      });
    });
  })();
  </script>
</body>
</html>`
}
