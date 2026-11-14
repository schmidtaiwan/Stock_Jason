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

  async function fetchJson(path) {
    const root = baseUrl();
    if (!root) return null;
    const token = accessToken();
    if (!token) return null;
    const res = await fetch(root + path, {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
      mode: "cors",
    });
    if (res.status === 401) throw new Error("Live Bridge 拒絕（非白名單或 token 過期）");
    if (res.status === 403) throw new Error("Live Bridge 拒絕（無權限）");
    if (!res.ok) throw new Error("Live Bridge HTTP " + res.status);
    return res.json();
  }

  async function readFubonLive() {
    if (!canUse()) return null;
    try {
      return await fetchJson("/api/fubon-live");
    } catch (err) {
      return null;
    }
  }

  async function readFubonTape(code, dateYmd) {
    if (!canUse()) return null;
    const id = String(code || "").trim().toUpperCase();
    if (!id) return null;
    try {
      return await fetchJson("/api/fubon-tape/" + encodeURIComponent(id));
    } catch (err) {
      return null;
    }
  }

  /** 僅 jason660803；Backy 不呼叫。 */
  async function readFubonHoldings() {
    if (!canUse() || !isJason()) return null;
    try {
      return await fetchJson("/api/fubon-holdings");
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
    isJason: isJason,
    readFubonLive: readFubonLive,
    readFubonTape: readFubonTape,
    readFubonHoldings: readFubonHoldings,
    health: health,
  };
})(window);
