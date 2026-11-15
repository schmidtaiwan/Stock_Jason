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

  function accountEmail() {
    try {
      const D = global.SJDrive;
      if (D && typeof D.account === "function") {
        const a = D.account();
        if (a && a.email) return String(a.email).trim().toLowerCase();
      }
    } catch (e) { /* ignore */ }
    // 備援：直接讀 session（避免 SJDrive.account 尚未就緒時被標成訪客）
    try {
      const raw = sessionStorage.getItem("sj-g-token");
      if (!raw) return "";
      const data = JSON.parse(raw);
      if (!data || !data.email) return "";
      if (!(Number(data.exp) > Date.now())) return "";
      return String(data.email).trim().toLowerCase();
    } catch (e) {
      return "";
    }
  }

  function accountName() {
    try {
      const D = global.SJDrive;
      if (D && typeof D.account === "function") {
        const a = D.account();
        if (a && a.name) return String(a.name).trim();
      }
    } catch (e) { /* ignore */ }
    try {
      const raw = sessionStorage.getItem("sj-g-token");
      if (!raw) return "";
      const data = JSON.parse(raw);
      return data && data.name ? String(data.name).trim() : "";
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
      const ident = clientIdentityHeaders();
      let relayUrl = root + "/relay.html?id=" + encodeURIComponent(id) +
        "&path=" + encodeURIComponent(apiPath) +
        "&parent=" + encodeURIComponent(PAGE_ORIGIN);
      if (ident["X-SJ-Email"]) {
        relayUrl += "&sjEmail=" + encodeURIComponent(ident["X-SJ-Email"]);
      }
      if (ident["X-SJ-Name"]) {
        relayUrl += "&sjName=" + encodeURIComponent(ident["X-SJ-Name"]);
      }
      if (ident["X-SJ-Guest"]) {
        relayUrl += "&sjGuest=" + encodeURIComponent(ident["X-SJ-Guest"]);
      }
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

  function clientIdentityHeaders() {
    const headers = {};
    const email = accountEmail();
    if (email) {
      headers["X-SJ-Email"] = email;
      const name = accountName();
      if (name) headers["X-SJ-Name"] = name.slice(0, 40);
    } else {
      headers["X-SJ-Guest"] = guestId();
    }
    return headers;
  }

  /** 身分同時塞 query（Tailscale／部分環境會丟自訂 header）。 */
  function withIdentityQuery(path, ident) {
    let p = String(path || "/");
    const parts = [];
    if (ident && ident["X-SJ-Email"]) {
      parts.push("sjEmail=" + encodeURIComponent(ident["X-SJ-Email"]));
    }
    if (ident && ident["X-SJ-Name"]) {
      parts.push("sjName=" + encodeURIComponent(ident["X-SJ-Name"]));
    }
    if (ident && ident["X-SJ-Guest"]) {
      parts.push("sjGuest=" + encodeURIComponent(ident["X-SJ-Guest"]));
    }
    if (!parts.length) return p;
    return p + (p.indexOf("?") >= 0 ? "&" : "?") + parts.join("&");
  }

  async function fetchJson(path, needAuth, timeoutMs) {
    const root = baseUrl();
    if (!root) return null;
    const headers = clientIdentityHeaders();
    const apiPath = withIdentityQuery(path, headers);
    const token = accessToken();
    // health／live／tape 不要帶 Authorization（避免多餘 CORS 預檢）
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

    async function doFetch(addressSpace) {
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
    }

    try {
      let data;
      try {
        data = await doFetch("");
      } catch (firstErr) {
        // 手機 Failed to fetch：改 relay（不帶 auth 的路徑）
        const msg = String((firstErr && firstErr.message) || firstErr || "");
        const useRelay = !needAuth && /Failed to fetch|NetworkError|Load failed|Permission|local/i.test(msg);
        if (useRelay) {
          try {
            data = await fetchViaRelay(apiPath, Math.max(ms, 12000));
            _relayReady = true;
          } catch (relayErr) {
            try {
              data = await doFetch("local");
            } catch (e2) {
              throw firstErr;
            }
          }
        } else {
          try {
            data = await doFetch("local");
          } catch (e2) {
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
      else _lastError = msg.slice(0, 160);
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
    readHistMis: readHistMis,
    readHistDaily: readHistDaily,
    readChipsDaily: readChipsDaily,
    readLevelsDaily: readLevelsDaily,
    readPulseBoard: readPulseBoard,
    readFlowSeries: readFlowSeries,
    health: health,
  };
})(window);
