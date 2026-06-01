// Web shell glue for app.tabmargin.com.
//
// The extension splits its UI across the newtab editor (script.js) and the
// settings popup (popup.js); on the web they share one page. This file is the
// only web-only logic — it:
//   - gates the editor behind sign-in (the site requires login)
//   - boots the editor (TabMarginEditor.init) once a session exists
//   - reacts to sign-in / sign-up / sign-out via the TabMarginOnAuthChange hook
//     that popup.js calls whenever it recomputes auth state
//   - drives the settings slide-over and refreshes the plan badge on focus
//     (so it flips Free→Pro after returning from Stripe)
(function () {
  const authGate = document.getElementById('authGate');
  const appShell = document.getElementById('appShell');
  const authTagline = document.getElementById('authTagline');
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsScrim = document.getElementById('settingsScrim');
  const emailInput = document.getElementById('emailInput');

  let editorBooted = false;

  function showApp() {
    authGate.hidden = true;
    appShell.hidden = false;
    if (!editorBooted) {
      editorBooted = true;
      // Boots theme + notes + sync. refreshAuthState() inside starts syncing if
      // the account is Pro, or surfaces "Upgrade to sync" if free.
      window.TabMarginEditor.init();
    } else {
      // Already booted (signed out, then back in): just re-check auth so the
      // sync engine picks up the new session in THIS tab — the storage event
      // doesn't fire in the tab that wrote the session.
      window.TabMarginEditor.refreshAuthState();
    }
  }

  function showGate() {
    closeSettings();
    appShell.hidden = true;
    authGate.hidden = false;
    // If the editor was already running, tell it to re-check auth so it tears
    // down its signed-in sync state (clears dirty/pending, stops flushing). In
    // the extension a storage event does this; on the web the writing tab gets
    // no such event, so we call it explicitly.
    if (editorBooted) window.TabMarginEditor.refreshAuthState();
  }

  // popup.js calls this after sign-in, sign-up (when a session results),
  // sign-out, on load, and on cross-tab storage changes. Passed the session or
  // null. This is the single source of truth for which surface is visible.
  window.TabMarginOnAuthChange = (session) => {
    if (session) showApp();
    else showGate();
  };

  // ----- Settings slide-over -----
  function openSettings() {
    settingsPanel.classList.add('open');
    settingsScrim.classList.add('open');
    settingsToggle.setAttribute('aria-expanded', 'true');
    // Move focus into the panel (tabindex=-1, labelled "Settings") so keyboard
    // and screen-reader users land in the opened slide-over.
    settingsPanel.focus();
    // Re-fetch /me so the plan badge is current each time the panel opens.
    window.TabMarginAccount?.renderAccountView();
  }

  // restoreFocus returns focus to the gear after a user-initiated close. Skip it
  // when closing as part of the signed-out teardown (showGate) — the gear is
  // hidden then, so focusing it would just drop focus to <body>.
  function closeSettings(restoreFocus = false) {
    settingsPanel.classList.remove('open');
    settingsScrim.classList.remove('open');
    settingsToggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus && !appShell.hidden) settingsToggle.focus();
  }

  settingsToggle.addEventListener('click', () => {
    if (settingsPanel.classList.contains('open')) closeSettings(true);
    else openSettings();
  });
  settingsScrim.addEventListener('click', () => closeSettings(true));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsPanel.classList.contains('open')) closeSettings(true);
  });

  // After returning from Stripe checkout/portal, re-fetch /me so the plan badge
  // flips Free→Pro (the next sync then stops hitting 402 and the status bar
  // flips to "Synced"). Harmless when signed out (renderAccountView no-ops the
  // /me call and just re-confirms the gate via the auth hook).
  window.addEventListener('focus', () => {
    window.TabMarginAccount?.renderAccountView();
  });

  // Deep links from the marketing site: ?signup=1 / ?login=1 set the gate copy.
  const params = new URLSearchParams(window.location.search);
  if (params.get('signup')) {
    authTagline.textContent = 'Create your account.';
  } else if (params.get('login')) {
    authTagline.textContent = 'Welcome back.';
  }

  // Initial gate. getSession() reads localStorage; popup.js's load-time
  // renderAccountView() also fires the hook above, so this is idempotent — it
  // just removes any dependence on popup.js timing and focuses the form.
  TabMarginAPI.getSession().then((session) => {
    if (session) {
      showApp();
    } else {
      showGate();
      emailInput.focus();
    }
  });
})();
