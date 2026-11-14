/* Tailscale Live Bridge：讀 Win11 EXE 的 HTTPS API（僅白名單 Google）。 */
(function (global) {
  const cfg = global.GOOGLE_CONFIG || {};
  const LS_KEY = "sj-live-bridge-url";
  const JASON_EMAIL = "jason660803@gmail.com";
  const FETCH_MS = 4000;
  const ONLINE_TTL_OK_MS = 20000;
  const ONLINE_TTL_FAIL_MS = 4000;
  const PAGE_ORIGIN = "https://schmidtaiwan.github.io";

  let _online = null;
  let _onlineAt = 0;
  let _lastError = "";
  let _iframe = null;
  let _iframeReady = null;
  let _iframeWaiters = [];
  let _reqSeq = 0;
  const _pending = new Map();

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
    destroyIframe();
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

  function canReach() {
    return !!baseUrl();
  }

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

  function lastError() {
    return _lastError || "";
  }

  function isMobileUa() {
    try {
      return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
    } catch (e) {
      return false;
    }
  }

  function destroyIframe() {
    if (_iframe && _iframe.parentNode) {
      try { _iframe.parentNode.removeChild(_iframe); } catch (e) { /* ignore */ }
    }
    _iframe = null;
    _iframeReady = null;
    _iframeWaiters = [];
    _pending.forEach(function (p) {
      try { p.reject(new Error("bridge iframe reset")); } catch (e) { /* ignore */ }
    });
    _pending.clear();
  }

  function onBridgeMessage(ev) {
    const root = baseUrl();
    if (!root) return;
    let originOk = false;
    try {
      originOk = ev.origin === root || ev.origin === new URL(root).origin;
    } catch (e) { originOk = false; }
    if (!originOk) return;
    const d = ev.data || {};
    if (d.type === "sj-bridge-ready") {
      _iframeReady = true;
      const waiters = _iframeWaiters.splice(0);
      waiters.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
      return;
    }
    if (d.type !== "sj-bridge-res") return;
    const p = _pending.get(d.id);
    if (!p) return;
    _pending.delete(d.id);
    clearTimeout(p.timer);
    if (!d.ok) {
      p.reject(new Error(d.error || ("HTTP " + (d.status || "?"))));
      return;
    }
    if (d.data == null) {
      p.reject(new Error("empty bridge response"));
      return;
    }
    p.resolve(d.data);
  }

  if (!global.__sjBridgeMsgBound) {
    global.__sjBridgeMsgBound = true;
    global.addEventListener("message", onBridgeMessage);
  }

  function ensureIframe(timeoutMs) {
    const root = baseUrl();
    if (!root) return Promise.reject(new Error("no bridge url"));
    if (_iframe && _iframeReady) return Promise.resolve();
    if (_iframe && !_iframeReady) {
      return new Promise(function (resolve, reject) {
        const t = setTimeout(function () {
          reject(new Error("bridge iframe timeout"));
        }, timeoutMs || 12000);
        _iframeWaiters.push(function () {
          clearTimeout(t);
          resolve();
        });
      });
    }
    return new Promise(function (resolve, reject) {
      const frame = document.createElement("iframe");
      frame.id = "sj-live-bridge-frame";
      frame.title = "LiveBridge";
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;top:-9999px;border:0;opacity:0;";
      frame.src = root + "/bridge.html?_=" + Date.now();
      _iframe = frame;
      _iframeReady = false;
      const t = setTimeout(function () {
        reject(new Error("bridge iframe load timeout"));
      }, timeoutMs || 12000);
      _iframeWaiters.push(function () {
        clearTimeout(t);
        resolve();
      });
      frame.onerror = function () {
        clearTimeout(t);
        reject(new Error("bridge iframe error"));
      };
      document.body.appendChild(frame);
    });
  }

  function fetchViaIframe(path, headers, timeoutMs) {
    const root = baseUrl();
    if (!root) return Promise.reject(new Error("no bridge url"));
    const ms = timeoutMs > 0 ? timeoutMs : 12000;
    return ensureIframe(ms).then(function () {
      return new Promise(function (resolve, reject) {
        const id = "r" + (++_reqSeq) + "_" + Date.now();
        const timer = setTimeout(function () {
          _pending.delete(id);
          reject(new Error("bridge rpc timeout"));
        }, ms);
        _pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        try {
          _iframe.contentWindow.postMessage({
            type: "sj-bridge-req",
            id: id,
            path: path,
            headers: headers || {}
          }, root);
        } catch (err) {
          clearTimeout(timer);
          _pending.delete(id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  async function fetchJson(path, needAuth, timeoutMs) {
    const root = baseUrl();
    if (!root) return null;
    const headers = {};
    const token = accessToken();
    // health／live／tape 不帶 Authorization，減少 CORS 預檢
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

    async function doCorsFetch(addressSpace) {
      const fetchOpts = {
        method: "GET",
        headers: headers,
        cache: "no-store",
        mode: "cors",
        signal: ctrl ? ctrl.signal : undefined
      };
      if (addressSpace) {
        try { fetchOpts.targetAddressSpace = addressSpace; } catch (e) { /* ignore */ }
      }
      const res = await fetch(root + path, fetchOpts);
      if (res.status === 401) throw new Error("Live Bridge 拒絕（非白名單或 token 過期）");
      if (res.status === 403) throw new Error("Live Bridge 拒絕（無權限）");
      if (!res.ok) throw new Error("Live Bridge HTTP " + res.status);
      return res.json();
    }

    try {
      let data;
      try {
        data = await doCorsFetch("");
      } catch (firstErr) {
        // 手機 Tailscale 開著時 MagicDNS→100.x，Chrome 擋跨站 fetch：改 iframe 同來源代打
        try {
          if (timer) { clearTimeout(timer); timer = null; }
          data = await fetchViaIframe(path, headers, Math.max(ms, 12000));
        } catch (iframeErr) {
          try {
            data = await doCorsFetch("local");
          } catch (e3) {
            throw firstErr;
          }
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
    const perTry = timeoutMs > 0 ? timeoutMs : (mobile ? 12000 : 4000);
    const tries = mobile ? 2 : 2;
    for (let i = 0; i < tries; i++) {
      try {
        if (i > 0) {
          _online = null;
          _onlineAt = 0;
          await new Promise(function (r) { setTimeout(r, 500); });
        }
        await fetchJson("/api/health", false, perTry);
        return true;
      } catch (err) { /* next */ }
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
      if (!tape || !Array.isArray(tape.ticks) || tape.ticks.length < 4) return null;
      return tape;
    } catch (err) {
      return null;
    }
  }

  async function readFubonHoldings() {
    if (!canUse() || !isJason()) return null;
    try {
      return await fetchJson("/api/fubon-holdings", true);
    } catch (err) {
      return null;
    }
  }

  async function health() {
    if (!canReach()) return null;
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
