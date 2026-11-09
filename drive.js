/* Google 登入與雲端硬碟。自選股與日誌不進 Git。 */
(function (global) {
  const cfg = global.GOOGLE_CONFIG || {};
  const SCOPES = "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email";

  let tokenClient = null;
  let token = "";
  let exp = 0;
  let inflight = null;
  let account = null;
  let folderId = "";
  let fileCache = new Map();
  let writeLock = Promise.resolve();

  function preferredEmail() {
    return String(cfg.preferredEmail || "").trim().toLowerCase();
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
        if (Date.now() - start > 15000) {
          reject(new Error("Google 登入元件載入逾時，請重新整理"));
          return;
        }
        setTimeout(tick, 80);
      })();
    });
  }

  function init() {
    const id = String(cfg.clientId || "").trim();
    if (!id) return Promise.reject(new Error("尚未設定 Google 用戶端 ID"));
    if (tokenClient) return Promise.resolve();
    return waitForGis().then(function () {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: id,
        scope: SCOPES,
        callback: function () {}
      });
    });
  }

  function requestToken(prompt, hint) {
    return init().then(function () {
      return new Promise(function (resolve, reject) {
        tokenClient.callback = function (resp) {
          if (!resp || resp.error) {
            reject(new Error((resp && (resp.error_description || resp.error)) || "登入未完成"));
            return;
          }
          token = resp.access_token;
          const sec = Number(resp.expires_in) || 3600;
          exp = Date.now() + Math.max(60, sec - 120) * 1000;
          resolve(token);
        };
        const req = {};
        if (prompt) req.prompt = prompt;
        if (hint) req.hint = hint;
        tokenClient.requestAccessToken(req);
      });
    });
  }

  function getToken(force) {
    if (!force && token && Date.now() < exp) return Promise.resolve(token);
    if (!force && inflight) return inflight;
    const hint = account && account.email ? account.email : "";
    const run = requestToken("", hint).catch(function () {
      return requestToken("select_account", "");
    });
    inflight = run.finally(function () {
      if (inflight === run) inflight = null;
    });
    return inflight;
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
    const q = "mimeType='application/vnd.google-apps.folder' and name='" + qEscape(name) + "' and trashed=false";
    const found = await listFiles(q);
    const owned = found.filter(function (file) {
      const emails = (file.owners || []).map(function (item) {
        return String(item.emailAddress || "").trim().toLowerCase();
      });
      return emails.indexOf(owner) >= 0 || (file.ownedByMe && accountEmail() === owner);
    });
    owned.sort(function (a, b) {
      return String(a.createdTime || "").localeCompare(String(b.createdTime || ""));
    });
    let id = owned[0] && owned[0].id;
    if (!id) {
      if (accountEmail() !== owner) {
        throw new Error("還沒找到 " + owner + " 的「" + name + "」資料夾。請先用那個帳號登入一次。");
      }
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
    if (accountEmail() === owner) {
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
    account = { email: u.email, name: u.name || "" };
    return account;
  }

  async function login(opts) {
    opts = opts || {};
    token = "";
    exp = 0;
    account = null;
    folderId = "";
    fileCache = new Map();
    await requestToken(opts.prompt != null ? opts.prompt : "select_account", opts.hint || "");
    return fetchAccount();
  }

  function logout() {
    const old = token;
    token = "";
    exp = 0;
    account = null;
    folderId = "";
    fileCache = new Map();
    if (old && global.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(old, function () {}); } catch (e) { /* 忽略 */ }
    }
  }

  function friendly(err) {
    const msg = (err && err.message) || "";
    if (/idpiframe|origin/i.test(msg)) {
      return "這個網址還沒加入 Google 登入允許清單。請用 https://schmidtaiwan.github.io/Stock_Jason/ 開啟。";
    }
    if (/popup_closed|access_denied|user_cancel|cancelled/i.test(msg)) return "已取消登入";
    return msg || "登入失敗";
  }

  global.SJDrive = {
    login: login,
    logout: logout,
    account: function () { return account; },
    allowedEmails: allowedEmails,
    isAllowed: isAllowed,
    preferredEmail: preferredEmail,
    bookName: bookName,
    readBook: readBook,
    writeBook: writeBook,
    friendly: friendly
  };
})(window);
