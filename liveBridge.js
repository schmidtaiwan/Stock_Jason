/* Tailscale Live Bridge：讀 Win11 EXE 的 HTTPS API（僅白名單 Google）。 */
(function (global) {
  const cfg = global.GOOGLE_CONFIG || {};
  const LS_KEY = "sj-live-bridge-url";
  const JASON_EMAIL = "jason660803@gmail.com";
  const FETCH_MS = 4000;
  const ONLINE_TTL_OK_MS = 20000;
  // 失敗快取短一點：手機 Tailscale 第一跳常慢，勿鎖死太久
  const ONLINE_TTL_FAIL_MS = 4000;

  let _online = null;
  let _onlineAt = 0;

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
    _online = null;
    _onlineAt = 0;
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

  /** 有設定 Tailscale URL（未必真的連得上）。 */
  function canReach() {
    return !!baseUrl();
  }

  /** 最近探活結果：true／false／null（未知）。 */
  function isOnline() {
    if (_online == null || !_onlineAt) return null;
    const age = Date.now() - _onlineAt;
    if (_online === true && age < ONLINE_TTL_OK_MS) return true;
    if (_online === false && age < ONLINE_TTL_FAIL_MS) return false;
    return null;
  }

  function markOnline(ok) {
    _online = !!ok;
    _onlineAt = Date.now();
  }

  let _lastError = "";

  function lastError() {
    return _lastError || "";
  }

  async function fetchJson(path, needAuth, timeoutMs) {
    const root = baseUrl();
    if (!root) return null;
    const headers = {};
    const token = accessToken();
    // 重要：health／live／tape 不要帶 Authorization。
    // 登入後若一律加 Bearer，手機會走 CORS 預檢＋Private Network，常被 Chrome 擋掉。
    if (needAuth) {
      if (!token) return null;
      headers.Authorization = "Bearer " + token;
    }
    const ms = timeoutMs > 0 ? timeoutMs : FETCH_MS;
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timer = null;
    if (ctrl) {
      timer = setTimeout(function () {
        try { ctrl.abort(); } catch (e) { /* ignore */ }
      }, ms);
    }
    function buildOpts(addressSpace) {
      const fetchOpts = {
        method: "GET",
        headers: headers,
        cache: "no-store",
        mode: "cors",
        signal: ctrl ? ctrl.signal : undefined
      };
      // Tailscale 100.x 屬 local（CGNAT），不是 private；設錯會直接 Failed to fetch
      if (addressSpace) {
        try { fetchOpts.targetAddressSpace = addressSpace; } catch (e) { /* ignore */ }
      }
      return fetchOpts;
    }

    async function doFetch(addressSpace) {
      const res = await fetch(root + path, buildOpts(addressSpace));
      if (res.status === 401) throw new Error("Live Bridge 拒絕（非白名單或 token 過期）");
      if (res.status === 403) throw new Error("Live Bridge 拒絕（無權限）");
      if (!res.ok) throw new Error("Live Bridge HTTP " + res.status);
      return res.json();
    }

    try {
      // 先一般 fetch（Funnel 公開網址時最穩）；失敗再試 local（tailnet 100.x）
      let data;
      try {
        data = await doFetch("");
      } catch (firstErr) {
        try {
          data = await doFetch("local");
        } catch (e2) {
          throw firstErr;
        }
      }
      markOnline(true);
      _lastError = "";
      return data;
    } catch (err) {
      markOnline(false);
      const name = err && err.name ? String(err.name) : "";
      const msg = err && err.message ? String(err.message) : String(err || "fetch failed");
      if (name === "AbortError") _lastError = "逾時 " + ms + "ms";
      else _lastError = msg.slice(0, 120);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function isMobileUa() {
    try {
      return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
    } catch (e) {
      return false;
    }
  }

  /**
   * 探活：手機 Tailscale 第一跳（DERP）常 >2.5s，需較長 timeout＋重試。
   * force 則略過快取。
   */
  async function probe(timeoutMs, force) {
    if (!baseUrl()) {
      markOnline(false);
      return false;
    }
    if (!force) {
      const known = isOnline();
      if (known != null) return known;
    }
    const mobile = isMobileUa();
    const perTry = timeoutMs > 0 ? timeoutMs : (mobile ? 10000 : 4000);
    const tries = mobile ? 3 : 2;
    for (let i = 0; i < tries; i++) {
      try {
        // 重試時先清失敗快取，避免 markOnline(false) 擋住
        if (i > 0) {
          _online = null;
          _onlineAt = 0;
          await new Promise(function (r) { setTimeout(r, 800 * i); });
        }
        await fetchJson("/api/health", false, perTry);
        return true;
      } catch (err) {
        /* try next */
      }
    }
    markOnline(false);
    return false;
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
      return await fetchJson("/api/health", false, 2500);
    } catch (err) {
      return null;
    }
  }

  global.SJLiveBridge = {
    baseUrl: baseUrl,
    setBaseUrl: setBaseUrl,
    canUse: canUse,
    canReach: canReach,
    isOnline: isOnline,
    probe: probe,
    lastError: lastError,
    isJason: isJason,
    readFubonLive: readFubonLive,
    readFubonTape: readFubonTape,
    readFubonHoldings: readFubonHoldings,
    health: health,
  };
})(window);
