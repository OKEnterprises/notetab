// Password-reset page (app.tabmargin.com/reset-password) — the redirect target
// for Supabase recovery emails. Reads the recovery access_token from the URL
// fragment and PUTs the new password to Supabase /auth/v1/user.
//
// Standalone: it deliberately does NOT load the app's shared core, so the
// (publishable) Supabase URL + anon key are inlined here, matching the constants
// in extension/api.js. Served under web/_headers' `script-src 'self'` CSP — the
// connect-src there already allows the Supabase origin for the PUT below.
(function () {
  const SUPABASE_URL = 'https://lktbfmoaodwmkdywkmfs.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_eBYGppKqlRMhzB8JTXcRGg_Gt4BszpL';

  const params = new URLSearchParams(location.hash.slice(1));
  const accessToken = params.get('access_token');
  const type = params.get('type');
  const form = document.getElementById('form');
  const done = document.getElementById('done');
  const error = document.getElementById('error');
  const submit = document.getElementById('submit');
  const meta = document.getElementById('meta');

  function showError(msg) { error.textContent = msg; error.hidden = false; }

  if (type !== 'recovery' || !accessToken) {
    form.hidden = true;
    showError('This page must be opened from a password-reset email.');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const pw = document.getElementById('pw').value;
    const pw2 = document.getElementById('pw2').value;
    if (pw !== pw2) return showError('Passwords do not match.');
    submit.disabled = true;
    submit.textContent = 'Saving…';
    try {
      const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + accessToken,
        },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.msg || data.error_description || data.error || ('Error ' + res.status));
        submit.disabled = false;
        submit.textContent = 'Set password';
        return;
      }
      form.hidden = true;
      done.hidden = false;
      meta.hidden = true;
    } catch (err) {
      showError(err.message || 'Network error');
      submit.disabled = false;
      submit.textContent = 'Set password';
    }
  });
})();
