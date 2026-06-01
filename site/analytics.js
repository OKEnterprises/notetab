// First-party, cookieless pageview beacon for tabmargin.com.
//
// Posts the bare pathname to the TabMargin API, which derives a privacy-
// preserving daily visitor hash (sha256 of salt+day+ip+user-agent) server-side.
// No cookies, no localStorage, nothing that identifies the visitor is stored in
// the browser. Uses a text/plain sendBeacon (a CORS-safelisted request) so there
// is no preflight and the cross-origin POST needs no CORS allow-listing. See the
// API's POST /e route.
(function () {
  try {
    var url = 'https://api.tabmargin.com/e';
    var payload = JSON.stringify({
      path: location.pathname,
      referrer: document.referrer || ''
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: 'text/plain' }));
    } else {
      // Older browsers: a keepalive no-cors POST (default text/plain body).
      fetch(url, { method: 'POST', body: payload, keepalive: true, mode: 'no-cors' });
    }
  } catch (e) {
    /* analytics must never affect the page */
  }
})();
