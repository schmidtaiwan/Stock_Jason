/* Tailscale Live Bridge：讀 Win11 EXE 的 HTTPS API（僅白名單 Google）。 */
(function (global) {
  const cfg = global.GOOGLE_CONFIG || {};
  const LS_KEY = "sj-live-bridge-url";
  const JASON_EMAIL = "jason660803@gmail.com";
  const FETCH_MS = 4000;
  const ONLINE_TTL_OK_MS = 20000;
  // 失敗快取短一點：手機 Tailscale 第一跳常慢，勿鎖死太久
  const ONLINE_TTL_FAIL_MS = 4000;
  const PAGE_ORIGIN = "https://schmidtaiwan.github.io";

  let _online = null;
  let _onlineAt = 0;
  let _lastError = "";
  let _relayReady = false;
  let _preferRelay = false;
  let _preferRelayUntil = 0;
  let _fubonLiveCache = null;
  let _fubonLiveCacheAt = 0;
  const PREFER_RELAY_LS = "sj-bridge-prefer-relay-until";

  function loadPreferRelay() {
    try {
      const until = Number(localStorage.getItem(PREFER_RELAY_LS) || 0);
      if (until > Date.now()) {
        _preferRelay = true;
        _preferRelayUntil = until;
      }
    } catch (e) { /* ignore */ }
  }

  function savePreferRelay(on) {
    _preferRelay = !!on;
    _preferRelayUntil = on ? Date.now() + 24 * 3600 * 1000 : 0;
    try {
      if (on) localStorage.setItem(PREFER_RELAY_LS, String(_preferRelayUntil));
      else localStorage.removeItem(PREFER_RELAY_LS);
    } catch (e) { /* ignore */ }
  }

  loadPreferRelay();

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
    _relayReady = false;
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

  let _forcedEmail = "";
  let _forcedName = "";
  const MEMBER_LS = "sj-bridge-member-email";
  const MEMBER_NAME_LS = "sj-bridge-member-name";

  /** 由 app.js 在登入／登出時呼叫，避免手機讀不到 SJDrive.account。 */
  function setIdentity(email, name) {
    _forcedEmail = String(email || "").trim().toLowerCase();
    _forcedName = String(name || "").trim();
    try {
      if (_forcedEmail) {
        localStorage.setItem(MEMBER_LS, _forcedEmail);
        if (_forcedName) localStorage.setItem(MEMBER_NAME_LS, _forcedName);
        else localStorage.removeItem(MEMBER_NAME_LS);
      } else {
        localStorage.removeItem(MEMBER_LS);
        localStorage.removeItem(MEMBER_NAME_LS);
      }
    } catch (e) { /* ignore */ }
  }

  function accountEmail() {
    if (_forcedEmail) return _forcedEmail;
    try {
      const D = global.SJDrive;
      if (D && typeof D.account === "function") {
        const a = D.account();
        if (a && a.email) return String(a.email).trim().toLowerCase();
      }
    } catch (e) { /* ignore */ }
    try {
      const raw = sessionStorage.getItem("sj-g-token");
      if (raw) {
        const data = JSON.parse(raw);
        if (data && data.email && Number(data.exp) > Date.now()) {
          return String(data.email).trim().toLowerCase();
        }
      }
    } catch (e) { /* ignore */ }
    try {
      return String(localStorage.getItem(MEMBER_LS) || "").trim().toLowerCase();
    } catch (e) {
      return "";
    }
  }

  function accountName() {
    if (_forcedName) return _forcedName;
    try {
      const D = global.SJDrive;
      if (D && typeof D.account === "function") {
        const a = D.account();
        if (a && a.name) return String(a.name).trim();
      }
    } catch (e) { /* ignore */ }
    try {
      const raw = sessionStorage.getItem("sj-g-token");
      if (raw) {
        const data = JSON.parse(raw);
        if (data && data.name) return String(data.name).trim();
      }
    } catch (e) { /* ignore */ }
    try {
      return String(localStorage.getItem(MEMBER_NAME_LS) || "").trim();
    } catch (e) {
      return "";
    }
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

  /**
   * 手機開 Tailscale 時 MagicDNS 把 *.ts.net 指到 100.x，
   * github.io 的 fetch 會被 Chrome Local Network Access 擋成 Failed to fetch。
   * 改用隱藏 iframe 載入 Bridge 同源 /relay（文件導覽常比 fetch 寬鬆），再 postMessage 回傳 JSON。
   */
  function fetchViaRelay(path, timeoutMs) {
    const root = baseUrl();
    if (!root) return Promise.reject(new Error("no bridge url"));
    const ms = timeoutMs > 0 ? timeoutMs : 12000;
    const apiPath = String(path || "/api/health");
    const id = "sj" + Date.now() + Math.floor(Math.random() * 1e6);

    return new Promise(function (resolve, reject) {
      let done = false;
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;top:0;border:0;opacity:0;";
      iframe.referrerPolicy = "no-referrer";

      function finish(err, value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        try { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); } catch (e) { /* ignore */ }
        if (err) reject(err);
        else resolve(value);
      }

      function onMsg(ev) {
        try {
          if (!ev || !ev.data || ev.data.source !== "sj-live-bridge-relay") return;
          if (ev.data.id !== id) return;
          const origin = String(ev.origin || "");
          if (origin.indexOf(".ts.net") < 0 && origin.indexOf("127.0.0.1") < 0 &&
              origin.indexOf("localhost") < 0) {
            return;
          }
          if (ev.data.ok) finish(null, ev.data.payload);
          else finish(new Error(ev.data.error || "relay failed"));
        } catch (e) {
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      }

      const timer = setTimeout(function () {
        finish(new Error("relay 逾時（Chrome 可能擋區域網路 iframe）"));
      }, ms);

      window.addEventListener("message", onMsg);
      const ident = clientIdentity();
      let cleanPath = String(apiPath || "/api/health");
      try {
        const u = new URL(cleanPath, "https://bridge.local");
        cleanPath = u.pathname || "/api/health";
      } catch (e) {
        cleanPath = cleanPath.split("?")[0] || "/api/health";
      }
      let relayUrl = root + "/relay.html?id=" + encodeURIComponent(id) +
        "&path=" + encodeURIComponent(cleanPath) +
        "&parent=" + encodeURIComponent(PAGE_ORIGIN);
      if (ident.sjEmail) relayUrl += "&sjEmail=" + encodeURIComponent(ident.sjEmail);
      if (ident.sjName) relayUrl += "&sjName=" + encodeURIComponent(ident.sjName);
      if (ident.sjGuest) relayUrl += "&sjGuest=" + encodeURIComponent(ident.sjGuest);
      const url = relayUrl;
      try {
        document.body.appendChild(iframe);
        iframe.src = url;
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  function guestId() {
    const key = "sj-bridge-guest-id";
    try {
      let id = String(localStorage.getItem(key) || "").trim();
      if (!id) {
        id = "g" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
        localStorage.setItem(key, id);
      }
      return id;
    } catch (e) {
      return "g" + Date.now().toString(36);
    }
  }

  /** 身分只走 query（避免自訂 header 觸發 CORS／PNA 預檢，手機常因此 Failed to fetch）。 */
  function clientIdentity() {
    const email = accountEmail();
    if (email) {
      const out = { sjEmail: email };
      const name = accountName();
      if (name) out.sjName = name.slice(0, 40);
      return out;
    }
    return { sjGuest: guestId() };
  }

  function withIdentityQuery(path, ident) {
    let p = String(path || "/");
    try {
      const u = new URL(p, "https://bridge.local");
      u.searchParams.delete("sjEmail");
      u.searchParams.delete("sjName");
      u.searchParams.delete("sjGuest");
      p = u.pathname + (u.search || "");
    } catch (e) { /* keep p */ }
    const parts = [];
    if (ident && ident.sjEmail) parts.push("sjEmail=" + encodeURIComponent(ident.sjEmail));
    if (ident && ident.sjName) parts.push("sjName=" + encodeURIComponent(ident.sjName));
    if (ident && ident.sjGuest) parts.push("sjGuest=" + encodeURIComponent(ident.sjGuest));
    if (!parts.length) return p;
    return p + (p.indexOf("?") >= 0 ? "&" : "?") + parts.join("&");
  }

  async function fetchJson(path, needAuth, timeoutMs) {
    const root = baseUrl();
    if (!root) return null;
    const ident = clientIdentity();
    const apiPath = withIdentityQuery(path, ident);
    const headers = {};
    const token = accessToken();
    if (needAuth) {
      if (!token) return null;
      headers.Authorization = "Bearer " + token;
    }
    const mobile = isMobileUa();
    loadPreferRelay();
    const ms = timeoutMs > 0 ? timeoutMs : (mobile ? 10000 : FETCH_MS);

    async function doFetch(addressSpace, budgetMs) {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      let timer = null;
      if (ctrl) {
        timer = setTimeout(function () {
          try { ctrl.abort(); } catch (e) { /* ignore */ }
        }, budgetMs > 0 ? budgetMs : ms);
      }
      try {
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
        const res = await fetch(root + apiPath, fetchOpts);
        if (res.status === 401) throw new Error("Live Bridge 拒絕（非白名單或 token 過期）");
        if (res.status === 403) throw new Error("Live Bridge 拒絕（無權限）");
        if (!res.ok) throw new Error("Live Bridge HTTP " + res.status);
        return res.json();
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    try {
      let data;
      if (mobile && !needAuth) {
        // 手機：已知需 relay 就直走 relay；否則短直連與 relay 競速（避免直連卡滿逾時才改走）
        if (_preferRelay && Date.now() < _preferRelayUntil) {
          data = await fetchViaRelay(apiPath, Math.min(Math.max(ms, 8000), 12000));
          _relayReady = true;
        } else {
          data = await new Promise(function (resolve, reject) {
            let left = 2;
            let lastErr = null;
            let done = false;
            function win(v, viaRelay) {
              if (done) return;
              done = true;
              if (viaRelay) {
                savePreferRelay(true);
                _relayReady = true;
              } else {
                savePreferRelay(false);
              }
              resolve(v);
            }
            function lose(err) {
              lastErr = err;
              left -= 1;
              if (left <= 0 && !done) reject(lastErr || new Error("bridge unreachable"));
            }
            doFetch("", 1800).then(function (v) { win(v, false); }, lose);
            fetchViaRelay(apiPath, Math.min(Math.max(ms, 8000), 12000))
              .then(function (v) { win(v, true); }, lose);
          });
        }
      } else {
        try {
          data = await doFetch("", ms);
        } catch (firstErr) {
          const msg = String((firstErr && firstErr.message) || firstErr || "");
          const useRelay = !needAuth && /Failed to fetch|NetworkError|Load failed|Permission|local|abort/i.test(
            msg + " " + ((firstErr && firstErr.name) || "")
          );
          if (useRelay) {
            try {
              data = await fetchViaRelay(apiPath, Math.min(Math.max(ms, 8000), 12000));
              _relayReady = true;
            } catch (relayErr) {
              try {
                data = await doFetch("local", Math.min(ms, 4000));
              } catch (e2) {
                throw firstErr;
              }
            }
          } else {
            try {
              data = await doFetch("local", Math.min(ms, 4000));
            } catch (e2) {
              throw firstErr;
            }
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
      else _lastError = msg.slice(0, 160);
      throw err;
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
    const perTry = timeoutMs > 0 ? timeoutMs : (mobile ? 12000 : 3000);
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
    const now = Date.now();
    if (_fubonLiveCache && now - _fubonLiveCacheAt < 3000) return _fubonLiveCache;
    try {
      // 自選要快：手機直連短逾時，失敗才 relay
      const data = await fetchJson("/api/fubon-live", false, isMobileUa() ? 10000 : FETCH_MS);
      if (data) {
        _fubonLiveCache = data;
        _fubonLiveCacheAt = Date.now();
      }
      return data;
    } catch (err) {
      return _fubonLiveCache;
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

  function histFromPack(pack, id, fallbackSource) {
    if (!pack) return null;
    if (id && pack.byCode && pack.byCode[id]) {
      const row = pack.byCode[id];
      return {
        ok: true,
        source: pack.source || fallbackSource,
        code: id,
        bars: Array.isArray(row) ? row : (row.bars || []),
        asOf: pack.asOf,
        at: pack.at
      };
    }
    if (Array.isArray(pack.bars) && pack.bars.length >= 3) return pack;
    return pack;
  }

  /** MIS 上市 180 日歷史（免登入）；網頁 historyBars 最優先。 */
  async function readHistMis(code) {
    if (!canReach()) return null;
    try {
      const id = String(code || "").trim().toUpperCase();
      if (id) {
        const one = await fetchJson("/api/hist-mis/" + encodeURIComponent(id), false);
        if (one && Array.isArray(one.bars) && one.bars.length >= 3) return one;
      }
      const pack = await fetchJson("/api/hist-mis", false);
      return histFromPack(pack, id, "mis-hist");
    } catch (err) {
      return null;
    }
  }

  /** 富邦自選備援日Ｋ（免登入）。 */
  async function readHistDaily(code) {
    if (!canReach()) return null;
    try {
      const id = String(code || "").trim().toUpperCase();
      if (id) {
        const one = await fetchJson("/api/hist-daily/" + encodeURIComponent(id), false);
        if (one && Array.isArray(one.bars) && one.bars.length >= 3) return one;
      }
      const pack = await fetchJson("/api/hist-daily", false);
      return histFromPack(pack, id, "fubon-hist");
    } catch (err) {
      return null;
    }
  }

  async function readCloudPack(path) {
    if (!canReach()) return null;
    try {
      const pack = await fetchJson(path, false);
      if (pack && pack.ok !== false) return pack;
      return pack || null;
    } catch (err) {
      return null;
    }
  }

  async function readChipsDaily(code) {
    if (!canReach()) return null;
    try {
      const id = String(code || "").trim().toUpperCase();
      if (id) {
        const one = await fetchJson("/api/chips-daily/" + encodeURIComponent(id), false);
        if (one && one.ok !== false && (one.row || one.byCode)) return one;
      }
      return await readCloudPack("/api/chips-daily");
    } catch (err) {
      return null;
    }
  }

  async function readLevelsDaily() {
    return readCloudPack("/api/levels-daily");
  }

  async function readPulseBoard() {
    return readCloudPack("/api/pulse-board");
  }

  async function readFlowSeries() {
    return readCloudPack("/api/flow-series");
  }

  async function readWatchUniverse() {
    return readCloudPack("/api/watch-universe");
  }

  async function health() {
    if (!canReach()) return null;
    try {
      const ms = isMobileUa() ? 12000 : 3000;
      return await fetchJson("/api/health", false, ms);
    } catch (err) {
      return null;
    }
  }

  global.SJLiveBridge = {
    baseUrl: baseUrl,
    setBaseUrl: setBaseUrl,
    setIdentity: setIdentity,
    canUse: canUse,
    canReach: canReach,
    isOnline: isOnline,
    probe: probe,
    lastError: lastError,
    isJason: isJason,
    readFubonLive: readFubonLive,
    readFubonTape: readFubonTape,
    readFubonHoldings: readFubonHoldings,
    readHistMis: readHistMis,
    readHistDaily: readHistDaily,
    readChipsDaily: readChipsDaily,
    readLevelsDaily: readLevelsDaily,
    readPulseBoard: readPulseBoard,
    readFlowSeries: readFlowSeries,
    readWatchUniverse: readWatchUniverse,
    health: health,
  };
})(window);
