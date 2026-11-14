/* Tailscale Live Bridge：讀 Win11 EXE 的 HTTPS API（僅白名單 Google）。 */
(function (global) {
  const cfg = global.GOOGLE_CONFIG || {};
  const LS_KEY = "sj-live-bridge-url";
  const JASON_EMAIL = "jason660803@gmail.com";

  function baseUrl() {
    let raw = "";
    try {
      raw = String(localStorage.getItem(LS_KEY) || "").trim();
    } catch (e) { /* ignore */ }
    if (!raw) raw = String(cfg.liveBridgeBaseUrl || "").trim();
    if (!raw) return "";
    return raw.replace(/\/+$/, "");
  }

  function setBaseUrl(url) {
    const v = String(url || "").trim().replace(/\/+$/, "");
    try {
      if (v) localStorage.setItem(LS_KEY, v);
      else localStorage.removeItem(LS_KEY);
    } catch (e) { /* ignore */ }
    return v;
  }

  function accessToken() {
    const D = global.SJDrive;
    if (D && typeof D.accessToken === "function") {
      const t = D.accessToken();
      if (t) return t;
    }
    return "";
  }

  function accountEmail() {
    const D = global.SJDrive;
    if (!D || !D.account || !D.account()) return "";
    return String(D.account().email || "").trim().toLowerCase();
  }

  function isJason() {
    return accountEmail() === JASON_EMAIL;
  }

  function canUse() {
    const D = global.SJDrive;
    if (!baseUrl()) return false;
    if (!D || !D.account || !D.account()) return false;
    if (D.isAllowed && !D.isAllowed((D.account().email) || "")) return false;
    if (!accessToken()) return false;
    return true;
  }

  /** 報價／分時：有 Tailscale URL 即可（免 Google token）；庫存仍要登入。 */
  function canReach() {
    return !!baseUrl();
  }

  async function fetchJson(path, needAuth) {
    const root = baseUrl();
    if (!root) return null;
    const headers = {};
    const token = accessToken();
    if (needAuth) {
      if (!token) return null;
      headers.Authorization = "Bearer " + token;
    } else if (token) {
      headers.Authorization = "Bearer " + token;
    }
    const res = await fetch(root + path, {
      method: "GET",
      headers: headers,
      cache: "no-store",
      mode: "cors",
    });
    if (res.status === 401) throw new Error("Live Bridge 拒絕（非白名單或 token 過期）");
    if (res.status === 403) throw new Error("Live Bridge 拒絕（無權限）");
    if (!res.ok) throw new Error("Live Bridge HTTP " + res.status);
    return res.json();
  }

  async function readFubonLive() {
    if (!canReach()) return null;
    try {
      return await fetchJson("/api/fubon-live", false);
    } catch (err) {
      return null;
    }
  }

  async function readFubonTape(code, dateYmd) {
    if (!canReach()) return null;
    const id = String(code || "").trim().toUpperCase();
    if (!id) return null;
    try {
      const tape = await fetchJson("/api/fubon-tape/" + encodeURIComponent(id), false);
      // 空 ticks 當失敗，讓呼叫端改走 Drive／live.focusTape
      if (!tape || !Array.isArray(tape.ticks) || tape.ticks.length < 4) return null;
      return tape;
    } catch (err) {
      return null;
    }
  }

  /** 僅 jason660803；Backy 不呼叫。 */
  async function readFubonHoldings() {
    if (!canUse() || !isJason()) return null;
    try {
      return await fetchJson("/api/fubon-holdings", true);
    } catch (err) {
      return null;
    }
  }

  async function health() {
    const root = baseUrl();
    if (!root) return null;
    try {
      const res = await fetch(root + "/api/health", { cache: "no-store", mode: "cors" });
      if (!res.ok) return null;
      return res.json();
    } catch (err) {
      return null;
    }
  }

  global.SJLiveBridge = {
    baseUrl: baseUrl,
    setBaseUrl: setBaseUrl,
    canUse: canUse,
    canReach: canReach,
    isJason: isJason,
    readFubonLive: readFubonLive,
    readFubonTape: readFubonTape,
    readFubonHoldings: readFubonHoldings,
    health: health,
  };
})(window);
