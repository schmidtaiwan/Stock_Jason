/* Google 登入與雲端硬碟。自選股與日誌不進 Git。 */
(function (global) {
  const cfg = global.GOOGLE_CONFIG || {};
  const SCOPES = "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
  const TOKEN_KEY = "sj-g-token";

  let tokenClient = null;
  let token = "";
  let exp = 0;
  let inflight = null;
  let account = null;
  let folderId = "";
  let fileCache = new Map();
  let writeLock = Promise.resolve();
  let readyPromise = null;

  const LIVE_URL = "https://schmidtaiwan.github.io/Stock_Jason/";

  function preferredEmail() {
    return String(cfg.preferredEmail || "").trim().toLowerCase();
  }

  /** Cursor／VS Code 內建瀏覽器無法完整跑 Google OAuth（常變白頁）。 */
  function isEmbeddedBrowser() {
    try {
      if (window.top !== window.self) return true;
    } catch (e) {
      return true;
    }
    if (location.protocol === "file:") return true;
    const ua = navigator.userAgent || "";
    if (/Cursor\/|VSCode|Electron\//i.test(ua)) return true;
    return false;
  }

  function liveUrl() {
    return LIVE_URL;
  }

  function accountEmail() {
    return String((account && account.email) || "").trim().toLowerCase();
  }

  function allowedEmails() {
    const list = [];
    function add(raw) {
      const email = String(raw || "").trim().toLowerCase();
      if (email && list.indexOf(email) < 0) list.push(email);
    }
    add(cfg.preferredEmail);
    (cfg.editors || []).forEach(add);
    return list;
  }

  function isAllowed(email) {
    return allowedEmails().indexOf(String(email || "").trim().toLowerCase()) >= 0;
  }

  function folderName() {
    return String(cfg.folderName || "StockJason").trim() || "StockJason";
  }

  function bookName(email) {
    const key = String(email || "guest").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return "book-" + (key || "guest") + ".json";
  }

  function qEscape(s) {
    return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  function waitForGis() {
    const start = Date.now();
    return new Promise(function (resolve, reject) {
      (function tick() {
        if (global.google && google.accounts && google.accounts.oauth2) {
          resolve();
          return;
        }
        if (Date.now() - start > 20000) {
          reject(new Error("Google 登入元件載入逾時，請重新整理後再試"));
          return;
        }
        setTimeout(tick, 50);
      })();
    });
  }

  function saveSession() {
    try {
      if (!token || !(exp > Date.now()) || !account) {
        sessionStorage.removeItem(TOKEN_KEY);
        return;
      }
      sessionStorage.setItem(TOKEN_KEY, JSON.stringify({
        token: token,
        exp: exp,
        email: account.email,
        name: account.name || "",
        picture: account.picture || ""
      }));
    } catch (e) { /* 無痕／額度滿就略過 */ }
  }

  function clearSession() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }

  function restoreSession() {
    try {
      const raw = sessionStorage.getItem(TOKEN_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !data.token || !(Number(data.exp) > Date.now() + 30000)) {
        clearSession();
        return false;
      }
      token = data.token;
      exp = Number(data.exp);
      account = {
        email: data.email || "",
        name: data.name || "",
        picture: data.picture || ""
      };
      if (!account.email || !isAllowed(account.email)) {
        token = "";
        exp = 0;
        account = null;
        clearSession();
        return false;
      }
      return true;
    } catch (e) {
      clearSession();
      return false;
    }
  }

  function init() {
    if (tokenClient) return Promise.resolve();
    if (readyPromise) return readyPromise;
    const id = String(cfg.clientId || "").trim();
    if (!id) return Promise.reject(new Error("尚未設定 Google 用戶端 ID"));
    readyPromise = waitForGis().then(function () {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: id,
        scope: SCOPES,
        callback: function () {},
        error_callback: function () {}
      });
    }).catch(function (err) {
      readyPromise = null;
      throw err;
    });
    return readyPromise;
  }

  function requestToken(prompt, hint) {
    // 必須在使用者點擊的同一輪同步呼叫 requestAccessToken，否則手機常擋彈窗
    if (!tokenClient) {
      return init().then(function () {
        return Promise.reject(new Error("登入元件剛就緒，請再按一次「用 Google 登入」。"));
      });
    }
    return new Promise(function (resolve, reject) {
      let settled = false;
      function finish(err, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(value);
      }
      const timer = setTimeout(function () {
        finish(new Error("登入逾時。請再按一次；若沒有跳出 Google 視窗，請到瀏覽器允許此網站的彈出視窗。"));
      }, 90000);
      tokenClient.callback = function (resp) {
        if (!resp || resp.error) {
          finish(new Error((resp && (resp.error_description || resp.error)) || "登入未完成"));
          return;
        }
        token = resp.access_token;
        const sec = Number(resp.expires_in) || 3600;
        exp = Date.now() + Math.max(60, sec - 120) * 1000;
        finish(null, token);
      };
      tokenClient.error_callback = function (err) {
        const type = (err && err.type) || "";
        if (type === "popup_failed_to_open") {
          finish(new Error("無法開啟 Google 登入視窗。請允許彈出視窗後再按一次。"));
          return;
        }
        if (type === "popup_closed") {
          finish(new Error("已取消登入"));
          return;
        }
        finish(new Error((err && (err.message || err.type)) || "登入未完成"));
      };
      const req = {};
      if (prompt != null && prompt !== "") req.prompt = prompt;
      if (hint) {
        req.hint = hint;
        req.login_hint = hint;
      }
      try {
        tokenClient.requestAccessToken(req);
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e || "登入失敗")));
      }
    });
  }

  function getToken(force) {
    if (!force && token && Date.now() < exp) return Promise.resolve(token);
    if (!force && inflight) return inflight;
    // 背景刷新不能開彈窗；請使用者再按登入
    return Promise.reject(new Error("登入已過期，請再按一次登入。"));
  }

  function driveFetch(url, options, retried) {
    options = options || {};
    return getToken(!!retried).then(function (tok) {
      const headers = new Headers(options.headers || {});
      headers.set("Authorization", "Bearer " + tok);
      return fetch(url, {
        method: options.method || "GET",
        headers: headers,
        body: options.body
      }).then(function (res) {
        if (res.status === 401 && !retried) {
          token = "";
          exp = 0;
          return driveFetch(url, options, true);
        }
        return res;
      });
    });
  }

  async function readErr(res, fallback) {
    let text = "";
    try { text = await res.text(); } catch (e) { text = ""; }
    let msg = fallback;
    try {
      const data = JSON.parse(text);
      msg = (data.error && (data.error.message || data.error)) || msg;
    } catch (e) { /* 保留 fallback */ }
    throw new Error(msg || fallback);
  }

  async function listFiles(q) {
    const out = [];
    let page = "";
    do {
      const url = "https://www.googleapis.com/drive/v3/files?pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=nextPageToken,files(id,name,createdTime,ownedByMe,owners(emailAddress))" +
        "&q=" + encodeURIComponent(q) + (page ? "&pageToken=" + encodeURIComponent(page) : "");
      const res = await driveFetch(url);
      if (!res.ok) await readErr(res, "讀取雲端檔案失敗");
      const data = await res.json();
      (data.files || []).forEach(function (f) { out.push(f); });
      page = data.nextPageToken || "";
    } while (page);
    return out;
  }

  async function grantWriter(id, email) {
    const res = await driveFetch(
      "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) +
      "/permissions?supportsAllDrives=true&sendNotificationEmail=false",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "writer", type: "user", emailAddress: email })
      }
    );
    if (res.ok || res.status === 409) return;
    const text = await res.text();
    if (!/already exists|duplicate/i.test(text)) console.error("分享資料夾失敗", email, text.slice(0, 180));
  }

  async function ensureFolder() {
    if (folderId) return folderId;
    const name = folderName();
    const owner = preferredEmail();
    const me = accountEmail();
    if (!isAllowed(me)) {
      throw new Error("這個帳號沒有權限讀寫自選資料。");
    }
    const q = "mimeType='application/vnd.google-apps.folder' and name='" + qEscape(name) + "' and trashed=false";
    const found = await listFiles(q);
    const owned = found.filter(function (file) {
      const emails = (file.owners || []).map(function (item) {
        return String(item.emailAddress || "").trim().toLowerCase();
      });
      return emails.indexOf(owner) >= 0 || (file.ownedByMe && me === owner);
    });
    owned.sort(function (a, b) {
      return String(a.createdTime || "").localeCompare(String(b.createdTime || ""));
    });
    // 優先主帳號資料夾；否則用目前帳號看得到的同名資料夾（含共用）
    let id = (owned[0] && owned[0].id) || (found[0] && found[0].id) || "";
    if (!id) {
      // 編輯者也可先在自己雲端建一份，避免登入後卡死無畫面
      const res = await driveFetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          mimeType: "application/vnd.google-apps.folder",
          parents: ["root"]
        })
      });
      if (!res.ok) await readErr(res, "建立資料夾失敗");
      const created = await res.json();
      id = created.id;
    }
    if (me === owner && id) {
      const others = allowedEmails().filter(function (email) { return email !== owner; });
      for (let i = 0; i < others.length; i++) {
        try { await grantWriter(id, others[i]); } catch (e) { console.error(e); }
      }
    }
    folderId = id;
    return id;
  }

  async function findBookFile(name) {
    if (fileCache.has(name)) return fileCache.get(name);
    const parent = await ensureFolder();
    const q = "name='" + qEscape(name) + "' and '" + parent + "' in parents and trashed=false";
    const found = await listFiles(q);
    const id = (found[0] && found[0].id) || "";
    if (id) fileCache.set(name, id);
    return id;
  }

  async function readBook() {
    const name = bookName(accountEmail());
    const id = await findBookFile(name);
    if (!id) return null;
    const res = await driveFetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(id) + "?alt=media&supportsAllDrives=true");
    if (!res.ok) await readErr(res, "讀取自選股失敗");
    return res.json();
  }

  function writeBook(data) {
    const run = writeLock.then(function () { return writeBookNow(data); });
    writeLock = run.then(function () {}, function () {});
    return run;
  }

  async function writeBookNow(data) {
    const name = bookName(accountEmail());
    const text = JSON.stringify(data);
    const id = await findBookFile(name);
    if (id) {
      const res = await driveFetch(
        "https://www.googleapis.com/upload/drive/v3/files/" + encodeURIComponent(id) + "?uploadType=media&supportsAllDrives=true",
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: text }
      );
      if (!res.ok) await readErr(res, "寫入雲端失敗");
      return;
    }
    const parent = await ensureFolder();
    const boundary = "sj" + Date.now();
    const body = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify({ name: name, parents: [parent], mimeType: "application/json" }) +
      "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" +
      text + "\r\n--" + boundary + "--";
    const res = await driveFetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id",
      { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body: body }
    );
    if (!res.ok) await readErr(res, "建立雲端檔失敗");
    const created = await res.json();
    if (created.id) fileCache.set(name, created.id);
  }

  async function fetchAccount() {
    const info = await driveFetch("https://www.googleapis.com/oauth2/v2/userinfo");
    if (!info.ok) await readErr(info, "無法讀取 Google 帳號");
    const u = await info.json();
    if (!u.email) throw new Error("無法讀取 Google 帳號信箱");
    account = {
      email: u.email,
      name: u.name || "",
      picture: u.picture || ""
    };
    saveSession();
    return account;
  }

  function login(opts) {
    opts = opts || {};
    if (isEmbeddedBrowser()) {
      return Promise.reject(new Error(
        "Cursor／IDE 右側瀏覽器無法顯示 Google 登入（會變白頁）。請用 Chrome 或 Edge 開啟 " + LIVE_URL + " 再登入。"
      ));
    }
    // 不可先 await：手機上離開點擊同步堆疊後彈窗會被擋
    if (!tokenClient) {
      return init().then(function () {
        throw new Error("登入元件剛就緒，請再按一次「用 Google 登入」。");
      });
    }
    token = "";
    exp = 0;
    account = null;
    folderId = "";
    fileCache = new Map();
    clearSession();
    // select_account 不要帶主帳 hint，否則編輯者帳號常被鎖住或回調卡住
    const prompt = opts.prompt != null ? opts.prompt : "select_account";
    const hint = opts.hint != null ? opts.hint
      : (prompt === "select_account" ? "" : (preferredEmail() || ""));
    return requestToken(prompt, hint).then(function () {
      return fetchAccount();
    });
  }

  function logout() {
    const old = token;
    token = "";
    exp = 0;
    account = null;
    folderId = "";
    fileCache = new Map();
    clearSession();
    if (old && global.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(old, function () {}); } catch (e) { /* 忽略 */ }
    }
  }

  function friendly(err) {
    const msg = (err && err.message) || "";
    if (/Cursor|IDE 右側|內建瀏覽器|變白頁/i.test(msg)) return msg;
    if (/idpiframe|origin|authorized javascript origins|redirect_uri/i.test(msg)) {
      return "這個網址還沒加入 Google 登入允許清單。請用 " + LIVE_URL + " 開啟。";
    }
    if (/popup_closed|access_denied|user_cancel|cancelled|已取消/i.test(msg)) return "已取消登入";
    if (/popup_failed|無法開啟 Google|登入逾時/i.test(msg)) {
      return "無法開啟 Google 登入視窗。請改用 Chrome／Edge 開啟 " + LIVE_URL + "（Cursor 右側預覽常會白頁）。";
    }
    return msg || "登入失敗";
  }

  // 頁面一載入就預載 GIS，避免第一次點登入時錯過使用者手勢
  init().catch(function () { /* 按鈕時再試 */ });
  restoreSession();

  global.SJDrive = {
    ready: init,
    login: login,
    logout: logout,
    account: function () { return account; },
    fetchAccount: fetchAccount,
    allowedEmails: allowedEmails,
    isAllowed: isAllowed,
    preferredEmail: preferredEmail,
    bookName: bookName,
    readBook: readBook,
    writeBook: writeBook,
    friendly: friendly,
    restoreSession: restoreSession,
    isEmbeddedBrowser: isEmbeddedBrowser,
    liveUrl: liveUrl
  };
})(window);
