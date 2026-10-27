// Phone alerts (web push): "Turn on alerts" panel on the Guide page.
// Saves this device's push subscription to Supabase (no sign-in) through the push_subscribe /
// push_unsubscribe functions (supabase/003_push_subs.sql). The pipeline sends the alerts.
(function () {
  const SUPABASE_URL = "https://hewbbugkbycdkazlwspq.supabase.co";
  const SUPABASE_KEY = "sb_publishable_a_CTgL6PKT4kcUCc6CyJwg_AihMMe3G"; // public by design
  const VAPID_PUBLIC = "BKuAVWCf9lScyffyEpxymTTDlcDvdw647fsgqaep7U9_hZvgJKeG7yUi4hXDdX1ROD1Qk4sgh3JnqLosnf2DvvI"; // public half of the alert signing key
  const A = { reg: null, sub: null, busy: false, msg: "", ready: false };

  const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = () => window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);

  function keyBytes(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  async function rpc(fn, body) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`server said ${r.status}`);
  }

  function inner() {
    const lead = `<p>Get a notification when a game's player lines first go up (more than half of its tracked players have a line).</p>`;
    if (!supported()) {
      if (isIOS() && !standalone())
        return lead + `<p class="muted">On iPhone, alerts work only in the Stix home-screen app: tap Share → <b>Add to Home Screen</b>, open Stix from your Home Screen, then come back to this page.</p>`;
      return lead + `<p class="muted">This browser doesn't support alerts.</p>`;
    }
    if (!A.ready) return lead + `<p class="muted">Checking…</p>`;
    const note = A.msg ? `<p class="muted small">${A.msg}</p>` : "";
    if (A.sub) return `<p><b>Alerts are on for this device.</b></p>${note}<button type="button" id="alerts-off" ${A.busy ? "disabled" : ""}>Turn off</button>`;
    if (Notification.permission === "denied")
      return lead + `<p class="muted">Notifications are blocked for Stix on this device. Turn them on in your device's notification settings, then come back.</p>`;
    return lead + note + `<button type="button" id="alerts-on" class="on" ${A.busy ? "disabled" : ""}>Turn on alerts</button>`;
  }
  function refresh() { const el = document.getElementById("alerts-body"); if (el) el.innerHTML = inner(); }
  window.alertsPanel = () => `<div class="panel" id="alerts-panel"><h3>Alerts</h3><div class="body" id="alerts-body">${inner()}</div></div>`;

  async function turnOn() {
    A.busy = true; A.msg = ""; refresh();
    try {
      // Called straight from the tap, as iOS requires; this also shows the permission prompt.
      const sub = await A.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) });
      const j = sub.toJSON();
      try { await rpc("push_subscribe", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth }); }
      catch (e) { await sub.unsubscribe().catch(() => {}); throw e; }
      A.sub = sub; A.msg = "You'll get the next alert when a game's lines go up.";
    } catch (e) {
      A.msg = Notification.permission === "denied" ? "" : `Couldn't turn on alerts (${e.message || e}). Try again.`;
    }
    A.busy = false; refresh();
  }
  async function turnOff() {
    A.busy = true; A.msg = ""; refresh();
    try {
      const ep = A.sub.endpoint;
      await A.sub.unsubscribe();
      A.sub = null;
      await rpc("push_unsubscribe", { p_endpoint: ep }).catch(() => {}); // a stale row is also removed at the next send
      A.msg = "Alerts are off for this device.";
    } catch (e) { A.msg = `Couldn't turn off alerts (${e.message || e}).`; }
    A.busy = false; refresh();
  }

  document.addEventListener("click", (e) => {
    if (A.busy || !A.reg) return;
    if (e.target.closest("#alerts-on")) turnOn();
    else if (e.target.closest("#alerts-off")) turnOff();
  });

  if (supported()) {
    navigator.serviceWorker.register("sw.js").then(async (reg) => {
      A.reg = reg;
      try { A.sub = await reg.pushManager.getSubscription(); } catch (e) { A.sub = null; }
      A.ready = true; refresh();
    }).catch((e) => { console.error(e); A.ready = true; A.msg = "Alerts couldn't start on this device."; refresh(); });
  }
})();
