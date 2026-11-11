(function () {
  const PAGE_BUILD = 47;
  const PAGE_DATE = "2026-11-11";
  const $ = function (id) { return document.getElementById(id); };
  const M = window.SJMarket;
  const D = window.SJDrive;

  const state = {
    range: "20d",
    on: { dji: false, spx: false, ndx: true, tw: true, jp: false, kr: false, sox: true, fx: true },
    focus: null,
    focusFrom: null,
    view: "chart",
    tool: "",
    picks: {},
    plot: null,
    chartGen: 0,
    foreignGen: 0,
    custom: false,
    from: "",
    to: "",
    chartStyle: "line"
  };

  let book = emptyBook();
  let saveTimer = 0;
  let importRows = [];
  let liveTimer = 0;
  let liveBusy = false;
  const alertSent = {};

  function emptyBook() {
    return { watch: [], holdings: [], journal: [], capital: 1000000, riskPct: 1, profile: "穩健" };
  }

  function twName(s) {
    return M && M.toTW ? M.toTW(s) : String(s == null ? "" : s);
  }

  const NOTIFY_MODES = {
    pct: { label: "漲跌%", prefix: "±", suffix: "%", def: 3 },
    priceUp: { label: "漲到價", prefix: "≥", suffix: "", def: "" },
    priceDown: { label: "跌到價", prefix: "≤", suffix: "", def: "" },
    pnlUp: { label: "獲利元", prefix: "≥", suffix: "元", def: "" },
    pnlDown: { label: "虧損元", prefix: "≥", suffix: "元", def: "" }
  };

  function notifyModeOf(row) {
    const m = row && row.notifyMode;
    return NOTIFY_MODES[m] ? m : "pct";
  }

  function notifyValOf(row) {
    const mode = notifyModeOf(row);
    const raw = row && row.notifyVal != null ? row.notifyVal : row && row.notifyPct;
    const n = Number(raw);
    if (n > 0 && isFinite(n)) return n;
    return mode === "pct" ? 3 : null;
  }

  function notifyPctOf(row) {
    return notifyModeOf(row) === "pct" ? (notifyValOf(row) || 3) : 3;
  }

  function normalizeNotify(row) {
    const mode = notifyModeOf(row);
    const val = notifyValOf(row);
    row.notify = !!row.notify;
    row.notifyMode = mode;
    row.notifyVal = val;
    row.notifyPct = mode === "pct" ? (val || 3) : notifyPctOf(row);
    return row;
  }

  function normalizeBook(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    function fixRow(row) {
      if (!row || typeof row !== "object") return row;
      const out = Object.assign({}, row);
      if (out.name != null) out.name = twName(out.name);
      if (out.market != null) out.market = twName(out.market);
      return normalizeNotify(out);
    }
    return {
      watch: Array.isArray(src.watch) ? src.watch.map(fixRow) : [],
      holdings: Array.isArray(src.holdings) ? src.holdings.map(fixRow) : [],
      journal: Array.isArray(src.journal) ? src.journal.map(fixRow) : [],
      capital: Number(src.capital) > 0 ? Number(src.capital) : 1000000,
      riskPct: Number(src.riskPct) > 0 ? Number(src.riskPct) : 1,
      profile: src.profile || "穩健"
    };
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function fmt(n) {
    if (!isFinite(n)) return "—";
    const a = Math.abs(n);
    const digits = a >= 1000 ? 2 : 2;
    return n.toLocaleString("zh-Hant", { maximumFractionDigits: digits, minimumFractionDigits: a >= 100 ? 2 : 2 });
  }

  function pct(n) {
    if (!isFinite(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return sign + (n * 100).toFixed(1) + "%";
  }

  function pctClass(n) {
    if (!isFinite(n) || n === 0) return "";
    return n > 0 ? "up" : "down";
  }

  function showVer() {
    const text = "版次 " + PAGE_BUILD + " (" + PAGE_DATE + ")";
    $("gate-ver").textContent = text;
    $("pageVer").textContent = text;
  }

  function showApp() {
    $("gate").hidden = true;
    $("app").hidden = false;
    paintChrome(false);
    // 進站／登入後紅框先抓加權，再載圖
    paintTwii(true).then(function () {
      if (state.view === "chart") loadChart();
    });
  }

  function paintChrome(skipTwii) {
    const account = D.account();
    $("who").textContent = account ? account.email : "尚未登入";
    $("login").hidden = !!account;
    $("logout").hidden = !account;
    $("watch-note").textContent = "";
    $("prefer").textContent = (window.GOOGLE_CONFIG.editors || []).join(" 或 ");
    if (!skipTwii) paintTwii(false);
  }

  let twiiBusy = false;
  let twiiSeq = 0;
  async function paintTwii(force) {
    const priceEl = $("twii-price");
    const chgEl = $("twii-chg");
    if (!priceEl || !chgEl) return;
    if (twiiBusy && !force) return;
    const seq = ++twiiSeq;
    twiiBusy = true;
    if (force) {
      priceEl.textContent = "…";
      priceEl.className = "";
      chgEl.className = "twii-chg";
      chgEl.textContent = "讀取中";
    }
    try {
      if (M.bustLiveCaches) M.bustLiveCaches(["100.TWII"]);
      const q = await M.twiiQuote();
      if (seq !== twiiSeq) return;
      const cls = pctClass((q.pct || 0) / 100);
      priceEl.textContent = fmt(q.price);
      priceEl.className = cls;
      const pts = q.change == null || !isFinite(q.change) ? "—" :
        ((q.change > 0 ? "+" : "") + q.change.toFixed(2) + " 點");
      const pctTxt = q.pct == null || !isFinite(q.pct) ? "" :
        "（" + (q.pct > 0 ? "+" : "") + q.pct.toFixed(2) + "%）";
      chgEl.className = "twii-chg " + cls;
      chgEl.textContent = pts + pctTxt;
    } catch (err) {
      if (seq !== twiiSeq) return;
      priceEl.textContent = "—";
      priceEl.className = "";
      chgEl.className = "twii-chg";
      chgEl.textContent = "加權讀取失敗";
    } finally {
      if (seq === twiiSeq) twiiBusy = false;
    }
  }

  function setWatchCompose(open) {
    const board = $("watch-board");
    const compose = $("watch-compose");
    const openBtn = $("watch-open-add");
    if (!board || !compose) return;
    board.hidden = !!open;
    compose.hidden = !open;
    if (openBtn) openBtn.hidden = !!open;
    if (open) {
      const q = $("watch-q");
      if (q) setTimeout(function () { q.focus(); }, 0);
    } else {
      renderWatch();
    }
  }

  function setView(name) {
    state.view = name;
    $("view-chart").hidden = name !== "chart";
    $("view-watch").hidden = name !== "watch";
    $("view-tools").hidden = name !== "tools";
    $("view-tool").hidden = name !== "tool";
    document.querySelectorAll(".dock button").forEach(function (btn) {
      const on = btn.getAttribute("data-view") === (name === "tool" ? "tools" : name);
      if (on) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    if (name === "chart") loadChart();
    if (name === "watch") {
      setWatchCompose(false);
      renderWatch();
    }
  }

  function openTool(id) {
    const titles = {
      ideas: "交易點子產生器",
      tech: "自動化技術分析師",
      news: "新聞轉交易策略",
      test: "交易策略回測分析師",
      risk: "投資組合風險管理",
      journal: "交易日誌分析師",
      predict: "台股漲跌預測",
      report: "盤後排序報表",
      advise: "個股綜合研判"
    };
    state.tool = id;
    $("tool-title").textContent = titles[id] || "";
    const note = $("tool-note");
    if (note) {
      if (id === "report") {
        note.hidden = false;
        note.textContent = "每日16:00後更新";
      } else {
        note.hidden = true;
        note.textContent = "";
      }
    }
    ["ideas", "tech", "news", "test", "risk", "journal", "predict", "report", "advise"].forEach(function (key) {
      $("panel-" + key).hidden = key !== id;
    });
    setView("tool");
    if (id === "risk") renderHoldings();
    if (id === "journal") renderJournal();
    if (id === "predict") syncPredictStockBox();
    if (id === "report" && $("report-date")) $("report-date").value = taipeiDay();
    if (id === "advise") paintAdviseWatch();
    syncMoney();
  }

  function paintAdviseWatch() {
    const box = $("advise-watch");
    if (!box) return;
    if (!book.watch.length) {
      box.innerHTML = '<span class="fine">自選還是空的，請搜尋代號。</span>';
      return;
    }
    box.innerHTML = book.watch.map(function (item, idx) {
      return '<button type="button" class="chip" data-advise-watch="' + idx + '">' +
        esc((item.name || "") + " " + (item.code || "")) + "</button>";
    }).join("");
  }

  function syncPredictStockBox() {
    const stock = $("predict-horizon").value === "stock";
    $("predict-stock-box").hidden = !stock;
  }

  function syncMoney() {
    $("idea-capital").value = book.capital;
    $("idea-risk").value = book.riskPct;
    $("news-capital").value = book.capital;
    $("news-risk").value = book.riskPct;
    $("risk-profile").value = book.profile;
  }

  function rememberMoney() {
    book.capital = Number($("idea-capital").value) || Number($("news-capital").value) || book.capital;
    book.riskPct = Number($("idea-risk").value) || book.riskPct;
    book.profile = $("risk-profile").value || book.profile;
    scheduleSave();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 300);
  }

  async function persist() {
    try {
      if (D.account()) await D.writeBook(book);
      else sessionStorage.setItem("sj-book", JSON.stringify(book));
    } catch (err) {
      $("who").textContent = "雲端寫入失敗：" + (err.message || err);
    }
  }

  async function loadBook() {
    try {
      if (D.account()) book = normalizeBook(await D.readBook());
      else book = normalizeBook(JSON.parse(sessionStorage.getItem("sj-book") || "null"));
    } catch (err) {
      book = emptyBook();
      $("who").textContent = "讀取雲端失敗：" + (err.message || err);
    }
    syncMoney();
    renderWatch();
  }

  async function doLogin() {
    $("gate-msg").textContent = "正在開啟 Google 登入…";
    $("gate-login").disabled = true;
    const headerLogin = $("login");
    if (headerLogin) headerLogin.disabled = true;
    try {
      const account = await D.login({ prompt: "select_account" });
      if (!D.isAllowed(account.email)) {
        const want = D.allowedEmails().join(" 或 ");
        $("gate-msg").textContent = "現在登入的是 " + account.email + "。請改用 " + want + "。";
        D.logout();
        paintChrome();
        return;
      }
      $("gate-msg").textContent = "";
      $("gate").hidden = true;
      $("app").hidden = false;
      paintChrome(true);
      await paintTwii(true);
      await loadBook();
      paintChrome(true);
      if (state.view === "chart") loadChart();
    } catch (err) {
      $("gate-msg").textContent = D.friendly(err);
      if ($("app") && !$("app").hidden) {
        $("who").textContent = D.friendly(err);
      }
    } finally {
      $("gate-login").disabled = false;
      if (headerLogin) headerLogin.disabled = false;
    }
  }

  function buildToggles() {
    $("ranges").innerHTML = Object.keys(M.RANGES).map(function (id) {
      const spec = M.RANGES[id];
      const on = !state.custom && state.range === id;
      return '<button type="button" class="chip" data-range="' + id + '" aria-pressed="' + on + '">' + spec.label + "</button>";
    }).join("");
    $("markets").innerHTML = M.MARKETS.map(function (m) {
      return '<button type="button" class="chip" data-market="' + m.id + '" aria-pressed="' + !!state.on[m.id] + '">' + m.name + "</button>";
    }).join("");
    const styles = $("chart-styles");
    if (styles) {
      styles.querySelectorAll("[data-chart-style]").forEach(function (btn) {
        btn.setAttribute("aria-pressed", btn.dataset.chartStyle === state.chartStyle ? "true" : "false");
      });
    }
    syncDateInputs();
  }

  function setChartStyle(style) {
    state.chartStyle = style === "candle" ? "candle" : "line";
    buildToggles();
  }

  function syncDateInputs() {
    const from = $("range-from");
    const to = $("range-to");
    if (!from || !to) return;
    if (document.activeElement === from || document.activeElement === to) return;
    if (state.from) from.value = state.from;
    if (state.to) to.value = state.to;
    from.classList.toggle("custom", !!state.custom);
    to.classList.toggle("custom", !!state.custom);
  }

  function plotWindow() {
    return state.custom && state.from && state.to ? { from: state.from, to: state.to } : null;
  }

  function fillDatesFromPlot() {
    const plot = state.plot;
    if (!plot || !plot.axis || !plot.axis.length) return;
    let first = "";
    let last = "";
    for (let i = 0; i < plot.axis.length; i++) {
      const d = String(plot.axis[i] || "").slice(0, 10);
      if (d.length >= 10) { first = d; break; }
    }
    for (let i = plot.axis.length - 1; i >= 0; i--) {
      const d = String(plot.axis[i] || "").slice(0, 10);
      if (d.length >= 10) { last = d; break; }
    }
    if (!first || !last) return;
    state.from = first;
    state.to = last;
    syncDateInputs();
  }

  function applyCustomDates() {
    const from = $("range-from").value;
    const to = $("range-to").value;
    if (!from || !to) return;
    if (from > to) {
      $("chart-status").textContent = "起始日不能晚於結束日。";
      return;
    }
    state.custom = true;
    state.from = from;
    state.to = to;
    buildToggles();
    loadChart();
  }

  function paintFocus() {
    const on = !!state.focus;
    $("focus-bar").hidden = !on;
    $("market-box").hidden = on;
    if (on) {
      $("focus-name").textContent = state.focus.name + " " + state.focus.code + " · " + (state.focus.market || "");
      $("focus-clear").textContent = state.focusFrom === "watch" ? "回自選" : "回到市場";
    }
  }

  function isTwMarketOpen(now) {
    const d = now || new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(d);
    const map = {};
    parts.forEach(function (p) { if (p.type !== "literal") map[p.type] = p.value; });
    const wd = map.weekday;
    if (wd === "Sat" || wd === "Sun") return false;
    const hh = Number(map.hour);
    const mm = Number(map.minute);
    const mins = hh * 60 + mm;
    return mins >= 9 * 60 && mins <= 13 * 60 + 30;
  }

  function liveSecids() {
    const ids = [];
    if (state.focus && state.focus.secid) ids.push(state.focus.secid);
    M.MARKETS.forEach(function (m) {
      if (state.on[m.id]) ids.push(m.secid);
    });
    (book.watch || []).forEach(function (item) {
      if (item.secid) ids.push(item.secid);
    });
    return ids;
  }

  function hasWatchAlerts() {
    return (book.watch || []).some(function (item) { return item.notify; });
  }

  async function liveTick() {
    if (liveBusy || !isTwMarketOpen()) return;
    const alertOn = hasWatchAlerts();
    if (document.hidden && !alertOn) return;
    liveBusy = true;
    try {
      if (M.bustLiveCaches) M.bustLiveCaches(liveSecids());
      if (!document.hidden) paintTwii();
      if (!document.hidden && state.view === "chart") await loadChart();
      else if (!document.hidden && state.view === "watch") paintWatchQuotes();
      else if (alertOn) await pollWatchAlerts();
    } catch (err) {
      /* 下一輪再試 */
    } finally {
      liveBusy = false;
    }
  }

  function startLiveClock() {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = setInterval(liveTick, 20000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && isTwMarketOpen()) liveTick();
      else if (document.hidden && hasWatchAlerts() && isTwMarketOpen()) liveTick();
    });
  }

  function taipeiDay() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }

  async function ensureNotifyPermission() {
    if (!("Notification" in window)) {
      $("watch-status").textContent = "這個瀏覽器不支援系統通知。";
      return false;
    }
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") {
      $("watch-status").textContent = "通知權限被拒絕，請到瀏覽器設定開啟。";
      return false;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        $("watch-status").textContent = "尚未允許通知，無法跳出資訊。";
        return false;
      }
      $("watch-status").textContent = "已開啟通知。盤中達門檻會跳出提醒。";
      return true;
    } catch (err) {
      $("watch-status").textContent = "無法請求通知權限。";
      return false;
    }
  }

  function fireWatchNotice(title, body, tag) {
    try {
      new Notification(title, {
        body: body,
        tag: tag || "stock-jason",
        renotify: true,
        silent: false
      });
    } catch (err) { /* 略過 */ }
  }

  function watchAlertHit(item, quote) {
    if (!item || !item.notify || !quote) return null;
    const mode = notifyModeOf(item);
    const val = notifyValOf(item);
    if (!(val > 0)) return null;
    const price = Number(quote.price);
    const pctChg = Number(quote.pct);
    const pnl = watchPnl(price, item.cost, item.shares, item.code).value;
    if (mode === "pct") {
      if (!isFinite(pctChg) || Math.abs(pctChg) < val) return null;
      const side = pctChg >= 0 ? "up" : "down";
      const sign = pctChg > 0 ? "+" : "";
      return {
        key: side + "|pct|" + val,
        body: "幅度 " + sign + pctChg.toFixed(2) + "%（門檻 ±" + val + "%）· 成交 " + fmtPx(price)
      };
    }
    if (mode === "priceUp") {
      if (!isFinite(price) || price < val) return null;
      return { key: "priceUp|" + val, body: "漲到 " + fmtPx(price) + "（門檻 ≥" + fmtPx(val) + "）" };
    }
    if (mode === "priceDown") {
      if (!isFinite(price) || price > val) return null;
      return { key: "priceDown|" + val, body: "跌到 " + fmtPx(price) + "（門檻 ≤" + fmtPx(val) + "）" };
    }
    if (mode === "pnlUp") {
      if (pnl == null || !isFinite(pnl) || pnl < val) return null;
      return {
        key: "pnlUp|" + val,
        body: "獲利 " + fmt(pnl) + " 元（門檻 ≥" + fmt(val) + "）· 成交 " + fmtPx(price)
      };
    }
    if (mode === "pnlDown") {
      if (pnl == null || !isFinite(pnl) || pnl > -val) return null;
      return {
        key: "pnlDown|" + val,
        body: "虧損 " + fmt(Math.abs(pnl)) + " 元（門檻 ≥" + fmt(val) + "）· 成交 " + fmtPx(price)
      };
    }
    return null;
  }

  function checkWatchAlertsFromRows(items, rows) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const day = taipeiDay();
    (items || []).forEach(function (item, idx) {
      if (!item || !item.notify) return;
      const hit = watchAlertHit(item, rows && rows[idx]);
      if (!hit) return;
      const key = (item.secid || item.code) + "|" + day + "|" + hit.key;
      if (alertSent[key]) return;
      alertSent[key] = true;
      fireWatchNotice(
        twName(item.name || "") + " " + (item.code || ""),
        hit.body,
        "watch-" + (item.code || idx)
      );
    });
  }

  async function pollWatchAlerts() {
    const items = (book.watch || []).filter(function (item) { return item.notify; });
    if (!items.length) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const rows = await M.watchBoard(items);
      checkWatchAlertsFromRows(items, rows);
    } catch (err) { /* 下一輪 */ }
  }

  function moneyText(n) {
    if (n == null || !isFinite(n)) return "—";
    return (n > 0 ? "+" : "") + n.toFixed(1);
  }

  async function renderForeign() {
    const box = $("foreign");
    if (!box) return;
    const gen = ++state.foreignGen;
    const order = ["1d", "5d", "20d", "180d", "1y"];
    if (!box.dataset.ready) box.textContent = "正在讀外資買賣超…";
    try {
      const nets = await M.foreignNets();
      if (gen !== state.foreignGen) return;
      box.dataset.ready = "1";
      box.innerHTML = '<p class="fine">外資買賣超（億元）</p><div class="chips">' + order.map(function (id) {
        const v = nets[id];
        const cls = (v > 0 ? "up" : v < 0 ? "down" : "") + (!state.custom && state.range === id ? " on" : "");
        return '<span class="' + cls + '">' + esc(M.RANGES[id].label) + " " + moneyText(v) + "</span>";
      }).join("") + "</div>";
    } catch (err) {
      if (gen === state.foreignGen) box.textContent = "外資買賣超這次沒讀到。";
    }
  }

  async function loadChart() {
    const gen = ++state.chartGen;
    $("chart-status").textContent = "正在讀行情…";
    paintFocus();
    renderForeign();
    try {
      let items = [];
      let statusNote = "";
      const win = plotWindow();
      const align = win
        ? ((Date.parse(win.to) - Date.parse(win.from)) / 86400000 <= 5 ? "index" : "date")
        : ((M.RANGES[state.range] || {}).align || "date");
      if (state.focus) {
        const series = await M.bars(state.focus.secid, state.range, win);
        items = [{ name: state.focus.name, color: "#e0a100", bars: series }];
      } else {
        const picked = M.MARKETS.filter(function (m) { return state.on[m.id]; });
        if (!picked.length) {
          $("chart-status").textContent = "至少選擇一個市場。";
          renderKPatterns(null);
          return;
        }
        const got = await Promise.all(picked.map(async function (m) {
          try { return { name: m.name, color: m.color, bars: await M.bars(m.secid, state.range, win) }; }
          catch (err) { return { name: m.name, error: err.message || "失敗" }; }
        }));
        if (gen !== state.chartGen) return;
        items = got.filter(function (row) { return row.bars && row.bars.length; });
        const bad = got.filter(function (row) { return !row.bars; }).map(function (row) { return row.name; });
        if (!items.length) throw new Error("行情暫時讀不到");
        statusNote = bad.length ? bad.join("、") + " 這次沒讀到。" : "";
      }
      if (gen !== state.chartGen) return;
      const candle = state.chartStyle === "candle";
      if (candle && items.length > 1) {
        const tw = items.find(function (row) { return row.name === "台股"; });
        items = [tw || items[0]];
        statusNote = (statusNote ? statusNote + " " : "") + "K線只顯示 " + items[0].name + "。";
      }
      const mode = candle || items.length === 1 ? "price" : "pct";
      state.plot = buildPlot(items, mode, align);
      state.plot.style = candle ? "candle" : "line";
      draw();
      renderLegend(items, mode);
      renderKPatterns(candle ? items[0] : null);
      fillDatesFromPlot();
      $("chart-status").textContent = state.focus && !statusNote ? "" : statusNote;
    } catch (err) {
      if (gen === state.chartGen) {
        $("chart-status").textContent = err.message || "讀取失敗";
        renderKPatterns(null);
      }
    }
  }

  function barOhlc(b) {
    if (!b) return null;
    const c = Number(b.c);
    if (!isFinite(c)) return null;
    const o = isFinite(b.o) ? Number(b.o) : c;
    const h = isFinite(b.h) ? Number(b.h) : Math.max(o, c);
    const l = isFinite(b.l) ? Number(b.l) : Math.min(o, c);
    return { o: o, h: Math.max(h, o, c), l: Math.min(l, o, c), c: c };
  }

  function buildPlot(items, mode, align) {
    const series = items.map(function (item) {
      const first = item.bars[0].c;
      const last = item.bars[item.bars.length - 1].c;
      const priceMap = new Map(item.bars.map(function (b) { return [b.t.slice(0, 10), b.c]; }));
      const ohlcMap = new Map(item.bars.map(function (b) { return [b.t.slice(0, 10), barOhlc(b)]; }));
      return {
        name: item.name,
        color: item.color,
        bars: item.bars,
        change: first ? last / first - 1 : 0,
        last: last,
        isTw: item.name === "台股",
        map: new Map(item.bars.map(function (b) {
          const y = mode === "pct" ? (b.c / first - 1) * 100 : b.c;
          return [b.t.slice(0, 10), y];
        })),
        priceMap: priceMap,
        ohlcMap: ohlcMap
      };
    });
    if (align === "date" && mode === "pct") {
      const days = [];
      const seen = {};
      series.forEach(function (s) {
        s.bars.forEach(function (b) {
          const d = b.t.slice(0, 10);
          if (!seen[d]) { seen[d] = true; days.push(d); }
        });
      });
      days.sort();
      series.forEach(function (s) {
        const end = s.bars[s.bars.length - 1].t.slice(0, 10);
        let carry = null;
        let priceCarry = null;
        s.values = days.map(function (d) {
          if (d > end) return null;
          if (s.map.has(d)) carry = s.map.get(d);
          return carry;
        });
        s.prices = days.map(function (d) {
          if (d > end) return null;
          if (s.priceMap.has(d)) priceCarry = s.priceMap.get(d);
          return priceCarry;
        });
        s.ohlc = days.map(function (d) {
          if (d > end) return null;
          return s.ohlcMap.has(d) ? s.ohlcMap.get(d) : null;
        });
      });
      return { axis: days, series: series, mode: mode };
    }
    const max = Math.max.apply(null, series.map(function (s) { return s.bars.length; }));
    const longest = series.slice().sort(function (a, b) { return b.bars.length - a.bars.length; })[0];
    series.forEach(function (s) {
      const pad = max - s.bars.length;
      const values = new Array(max).fill(null);
      const prices = new Array(max).fill(null);
      const ohlc = new Array(max).fill(null);
      s.bars.forEach(function (b, i) {
        const y = mode === "pct" ? (b.c / s.bars[0].c - 1) * 100 : b.c;
        values[pad + i] = y;
        prices[pad + i] = b.c;
        ohlc[pad + i] = barOhlc(b);
      });
      s.values = values;
      s.prices = prices;
      s.ohlc = ohlc;
    });
    const axis = new Array(max).fill("");
    longest.bars.forEach(function (b, i) {
      axis[(max - longest.bars.length) + i] = b.t.slice(0, 16);
    });
    return { axis: axis, series: series, mode: mode };
  }

  function drawCandles(ctx, s, xOf, yOf, n) {
    const slot = n <= 1 ? 10 : Math.abs(xOf(Math.min(1, n - 1)) - xOf(0));
    const w = Math.max(2, Math.min(12, slot * 0.72));
    (s.ohlc || []).forEach(function (bar, i) {
      if (!bar) return;
      const up = bar.c >= bar.o;
      const color = up ? "#ff1f1f" : "#3dbe7a";
      const x = xOf(i);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yOf(bar.h));
      ctx.lineTo(x, yOf(bar.l));
      ctx.stroke();
      const y1 = yOf(Math.max(bar.o, bar.c));
      const y2 = yOf(Math.min(bar.o, bar.c));
      const bh = Math.max(1, y2 - y1);
      ctx.fillStyle = color;
      ctx.fillRect(x - w / 2, y1, w, bh);
    });
  }

  function draw() {
    const canvas = $("chart");
    const plot = state.plot;
    if (!plot) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 260;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const left = 52;
    const right = 22;
    const top = 16;
    const bottom = 28;
    const iw = width - left - right;
    const ih = height - top - bottom;
    const candle = plot.style === "candle";
    let min = Infinity;
    let max = -Infinity;
    plot.series.forEach(function (s) {
      if (candle && s.ohlc) {
        s.ohlc.forEach(function (bar) {
          if (!bar) return;
          min = Math.min(min, bar.l);
          max = Math.max(max, bar.h);
        });
        return;
      }
      s.values.forEach(function (v) {
        if (v == null) return;
        min = Math.min(min, v);
        max = Math.max(max, v);
      });
    });
    if (!isFinite(min) || !isFinite(max)) return;
    if (plot.mode === "pct") { min = Math.min(min, 0); max = Math.max(max, 0); }
    const pad = (max - min) * 0.08 || 1;
    min -= pad;
    max += pad;
    const yOf = function (v) { return top + (max - v) / (max - min) * ih; };
    const xOf = function (i) {
      const n = plot.axis.length;
      return left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    };
    const axisFont = '12px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
    ctx.strokeStyle = "#2c3846";
    ctx.fillStyle = "#93a0b0";
    ctx.font = axisFont;
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const v = min + (max - min) * (g / 4);
      const y = yOf(v);
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(width - right, y);
      ctx.stroke();
      const label = plot.mode === "pct" ? v.toFixed(1) + "%" : fmt(v);
      ctx.fillText(label, 4, y + 4);
    }
    if (plot.mode === "pct") {
      ctx.strokeStyle = "#8d97a6";
      ctx.beginPath();
      ctx.moveTo(left, yOf(0));
      ctx.lineTo(width - right, yOf(0));
      ctx.stroke();
    }
    if (candle) {
      plot.series.forEach(function (s) {
        drawCandles(ctx, s, xOf, yOf, plot.axis.length);
      });
    } else {
      plot.series.forEach(function (s) {
        ctx.beginPath();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        let open = false;
        let lastX = null;
        let lastY = null;
        s.values.forEach(function (v, i) {
          if (v == null) { open = false; return; }
          const x = xOf(i);
          const y = yOf(v);
          if (!open) { ctx.moveTo(x, y); open = true; }
          else ctx.lineTo(x, y);
          lastX = x;
          lastY = y;
        });
        ctx.stroke();
        if (lastX != null && s.name) {
          const tag = String(s.name).charAt(0);
          ctx.font = axisFont;
          ctx.fillStyle = s.color;
          ctx.textBaseline = "middle";
          ctx.fillText(tag, lastX + 4, lastY);
          ctx.textBaseline = "alphabetic";
        }
      });
    }
    ctx.fillStyle = "#93a0b0";
    ctx.font = axisFont;
    const marks = [0, Math.floor((plot.axis.length - 1) / 2), plot.axis.length - 1];
    marks.forEach(function (i) {
      const text = String(plot.axis[i] || "").slice(5, 16);
      ctx.fillText(text, xOf(i) - 18, height - 8);
    });
    canvas._layout = {
      left: left,
      top: top,
      width: iw,
      height: ih,
      min: min,
      max: max,
      axis: plot.axis,
      series: plot.series,
      mode: plot.mode,
      style: plot.style || "line"
    };
  }

  function renderKPatterns(item) {
    const box = $("k-patterns");
    if (!box) return;
    if (!item || !item.bars || !item.bars.length || !M.kPatterns) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const rows = M.kPatterns(item.bars).slice(0, 16);
    const ref = '<p class="fine">型態對照 <a href="https://www.cmoney.tw/notes/note-detail.aspx?nid=291749" target="_blank" rel="noopener">CMoney 15種基本K線</a>（大陽／大陰／十字／錘頭／抵抗／阻力／墓碑／試探／一字／T字／白三兵／三烏鴉／黃昏之星等）。偏多／偏空是提示，不是下單建議。</p>';
    if (!rows.length) {
      box.hidden = false;
      box.innerHTML = "<h3>K線分析</h3>" + ref + '<p class="fine">這段區間沒抓到明顯型態。</p>';
      return;
    }
    box.hidden = false;
    box.innerHTML = "<h3>K線分析 · " + esc(item.name) + "</h3>" + ref + "<ul>" +
      rows.map(function (row) {
        const cls = row.bias === "多" ? "up" : row.bias === "空" ? "down" : "";
        return "<li><span class=\"k-date\">" + esc(row.date.slice(5)) + "</span>" +
          '<span class="k-name ' + cls + '">' + esc(row.name) + "</span>" +
          '<span class="k-detail">' + esc(row.detail) + "</span></li>";
      }).join("") + "</ul>";
  }

  function renderLegend(items, mode) {
    $("legend").innerHTML = items.map(function (item, idx) {
      const first = item.bars[0].c;
      const last = item.bars[item.bars.length - 1].c;
      const change = first ? last / first - 1 : 0;
      const color = item.color;
      return '<div><span class="swatch" style="background:' + color + '"></span>' + esc(item.name) +
        " " + fmt(last) + ' <span class="' + pctClass(change) + '">' + pct(change) + "</span></div>";
    }).join("");
    if (mode === "pct") {
      $("legend").insertAdjacentHTML("beforeend", '<p class="fine">數字是區間漲跌幅，起點對齊各市場自己的第一根。下方提示會顯示台股當日點數。</p>');
    }
  }

  function seriesLabel(s, i, mode, style) {
    if (style === "candle" && s.ohlc && s.ohlc[i]) {
      const bar = s.ohlc[i];
      return s.name + " 開 " + fmt(bar.o) + " 高 " + fmt(bar.h) + " 低 " + fmt(bar.l) + " 收 " + fmt(bar.c);
    }
    const v = s.values[i];
    if (v == null) return "";
    if (s.isTw) {
      const price = s.prices && s.prices[i];
      if (mode === "pct") {
        const pctText = (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
        return price != null ? "台股 " + fmt(price) + " 點（" + pctText + "）" : "台股 " + pctText;
      }
      return "台股 " + fmt(v) + " 點";
    }
    if (mode === "pct") return s.name + " " + (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
    return s.name + " " + fmt(v);
  }

  function onChartPointer(ev) {
    const canvas = $("chart");
    const layout = canvas._layout;
    const tip = $("hover");
    if (!layout || !state.plot) { tip.hidden = true; return; }
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const n = layout.axis.length;
    if (n < 1 || x < layout.left || x > layout.left + layout.width) { tip.hidden = true; return; }
    const i = Math.round((x - layout.left) / layout.width * (n - 1));
    const parts = layout.series.map(function (s) {
      return seriesLabel(s, i, layout.mode, layout.style);
    }).filter(Boolean);
    if (!parts.length) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.classList.remove("on-line");
    tip.style.left = "";
    tip.style.top = "";
    tip.style.right = "";
    tip.style.bottom = "";
    tip.textContent = (layout.axis[i] || "") + "  " + parts.join(" · ");
  }

  function fmtPx(n) {
    if (n == null || !isFinite(n)) return "—";
    const a = Math.abs(n);
    if (a >= 1000) return Math.round(n).toLocaleString("zh-Hant");
    if (a >= 100) return n.toLocaleString("zh-Hant", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
    return n.toLocaleString("zh-Hant", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }

  function signedPx(n) {
    if (n == null || !isFinite(n)) return "—";
    return (n > 0 ? "+" : "") + fmtPx(n);
  }

  // 台股預估損益：扣賣出手續費（萬元 1.425‰、單筆最低 20）與證交稅（股票 0.3%、ETF 0.1%）
  // 買價視為券商平均成本（多半已含買進費），不再重扣買進手續費。
  const BROKER_FEE_RATE = 0.001425;
  const BROKER_FEE_MIN = 20;
  const TAX_STOCK = 0.003;
  const TAX_ETF = 0.001;

  function isEtfLike(code) {
    const c = String(code || "").trim().toUpperCase();
    if (!c) return false;
    if (/^00\d/.test(c)) return true;
    if (/[A-Z]/.test(c)) return true;
    return false;
  }

  function brokerFee(amount) {
    if (!(amount > 0)) return 0;
    return Math.max(BROKER_FEE_MIN, Math.round(amount * BROKER_FEE_RATE));
  }

  function sellTax(amount, code) {
    if (!(amount > 0)) return 0;
    return Math.round(amount * (isEtfLike(code) ? TAX_ETF : TAX_STOCK));
  }

  function watchPnl(price, cost, shares, code) {
    const p = Number(price);
    const c = Number(cost);
    const s = Number(shares);
    if (!(p > 0) || !isFinite(c) || !(s > 0)) return { text: "—", cls: "", value: null };
    const mv = p * s;
    const v = mv - c * s - brokerFee(mv) - sellTax(mv, code);
    return {
      text: (v > 0 ? "+" : "") + Math.round(v).toLocaleString("zh-Hant"),
      cls: v > 0 ? "up" : v < 0 ? "down" : "",
      value: v
    };
  }

  function paintWatchPnl(idx) {
    const box = $("watch-list");
    if (!box) return;
    const row = box.querySelector('tr[data-watch-row="' + idx + '"]');
    const item = book.watch[idx];
    if (!row || !item) return;
    const price = Number(row.getAttribute("data-price"));
    const pnl = watchPnl(price, item.cost, item.shares, item.code);
    const cell = row.querySelector("[data-watch-pnl]");
    if (!cell) return;
    cell.className = pnl.cls;
    cell.textContent = pnl.text;
  }

  function paintWatchTotal() {
    const el = $("watch-total-pnl");
    if (!el) return;
    const box = $("watch-list");
    if (!book.watch.length) {
      el.className = "";
      el.textContent = "—";
      return;
    }
    let sum = 0;
    let n = 0;
    book.watch.forEach(function (item, idx) {
      const row = box && box.querySelector('tr[data-watch-row="' + idx + '"]');
      const price = row ? Number(row.getAttribute("data-price")) : NaN;
      const pnl = watchPnl(price, item.cost, item.shares, item.code);
      if (pnl.value == null || !isFinite(pnl.value)) return;
      sum += pnl.value;
      n += 1;
    });
    if (!n) {
      el.className = "";
      el.textContent = "—";
      return;
    }
    el.className = sum > 0 ? "up" : sum < 0 ? "down" : "";
    el.textContent = (sum > 0 ? "+" : "") + Math.round(sum).toLocaleString("zh-Hant");
  }

  function watchLabel(item) {
    const name = M.preferTwName
      ? M.preferTwName(item.name, "", item.code)
      : twName(item.name || "");
    item.name = name;
    return name + (item.code || "");
  }

  function applyWatchQuoteRow(box, m, idx) {
    const item = book.watch[idx];
    const row = box.querySelector('tr[data-watch-row="' + idx + '"]');
    if (!row || !item) return;
    // 只在缺中文名時才補名稱，绝不让 Yahoo 英文覆写
    const nextName = M.preferTwName
      ? M.preferTwName(item.name, m && m.name, item.code)
      : twName(item.name || (m && m.name) || "");
    if (nextName && nextName !== item.name) {
      item.name = nextName;
      const btn = row.querySelector("[data-open-watch]");
      if (btn) btn.textContent = nextName + (item.code || "");
    }
    const priceCell = row.querySelector("[data-watch-price]");
    if (priceCell) {
      if (m && m.price != null && isFinite(m.price)) {
        const cls = pctClass((m.pct || 0) / 100);
        const pctTxt = m.pct == null || !isFinite(m.pct) ? "" :
          " " + (m.pct > 0 ? "+" : "") + Number(m.pct).toFixed(2) + "%";
        priceCell.className = "watch-num " + cls;
        priceCell.innerHTML = fmtPx(m.price) +
          (pctTxt ? '<small class="' + cls + '">' + pctTxt + "</small>" : "");
        row.setAttribute("data-price", String(m.price));
      } else {
        priceCell.className = "watch-num";
        priceCell.textContent = "—";
        row.setAttribute("data-price", "");
      }
    }
    paintWatchPnl(idx);
  }

  // 只更新目前價／損益／總損益／籌碼，不重繪整張表（避免名稱變英文、輸入被清掉）
  async function paintWatchQuotes() {
    const box = $("watch-list");
    if (!box || !book.watch.length) return;
    if (!box.querySelector("[data-watch-row]")) {
      renderWatch(true);
      return;
    }
    const gen = (paintWatchQuotes.gen = (paintWatchQuotes.gen || 0) + 1);
    try {
      const got = await Promise.all([
        M.watchBoard(book.watch),
        M.watchChips ? M.watchChips(book.watch).catch(function () { return null; }) : Promise.resolve(null)
      ]);
      if (gen !== paintWatchQuotes.gen) return;
      const rows = got[0] || [];
      rows.forEach(function (m, idx) { applyWatchQuoteRow(box, m, idx); });
      if (got[1]) paintWatchChipRows(box, got[1]);
      paintWatchTotal();
      checkWatchAlertsFromRows(book.watch, rows);
    } catch (err) {
      if (gen !== paintWatchQuotes.gen) return;
      paintWatchTotal();
    }
  }

  function renderWatch(force) {
    const box = $("watch-list");
    if (!book.watch.length) {
      box.innerHTML = '<p class="note">自選股還是空的。按右上角「加入」用代號或庫存圖新增。</p>';
      paintWatchTotal();
      return;
    }
    // 表格已在且非強制重建：只刷新報價
    if (!force && box.querySelector("[data-watch-row]")) {
      paintWatchQuotes();
      return;
    }
    const gen = (renderWatch.gen = (renderWatch.gen || 0) + 1);
    box.innerHTML = '<div class="watch-table-wrap"><table class="watch-table"><thead><tr>' +
      "<th>標的</th><th>目前</th><th>買價</th><th>損益</th><th>股數</th><th></th><th>通知</th>" +
      "</tr></thead><tbody>" + book.watch.map(function (item, idx) {
        const shares = item.shares == null ? "" : item.shares;
        const cost = item.cost == null ? "" : item.cost;
        normalizeNotify(item);
        const mode = notifyModeOf(item);
        const meta = NOTIFY_MODES[mode];
        const val = notifyValOf(item);
        const valText = val == null ? "" : String(val);
        if (item.market) item.market = twName(item.market);
        const label = watchLabel(item);
        const modeOpts = Object.keys(NOTIFY_MODES).map(function (key) {
          return '<option value="' + key + '"' + (key === mode ? " selected" : "") + ">" +
            NOTIFY_MODES[key].label + "</option>";
        }).join("");
        return '<tr data-watch-row="' + idx + '" data-price="">' +
          '<td class="watch-name"><button type="button" class="watch-link" data-open-watch="' + idx + '">' +
          esc(label) + '</button><div class="watch-chips" data-watch-chips="' + idx + '"><span class="note">籌碼…</span></div></td>' +
          '<td class="watch-num" data-watch-price="' + idx + '"><span class="note">…</span></td>' +
          '<td><input class="watch-input" data-watch-cost="' + idx + '" inputmode="decimal" value="' +
          esc(cost) + '" placeholder="買價" aria-label="買價"></td>' +
          '<td class="watch-num" data-watch-pnl="' + idx + '">—</td>' +
          '<td><input class="watch-input" data-watch-shares="' + idx + '" inputmode="numeric" value="' +
          esc(shares) + '" placeholder="股數" aria-label="股數"></td>' +
          '<td><button type="button" class="danger" data-del-watch="' + idx + '">移除</button></td>' +
          '<td class="watch-alert-cell"><div class="watch-alert">' +
          '<label class="watch-alert-toggle"><input type="checkbox" data-watch-notify="' + idx + '"' +
          (item.notify ? " checked" : "") + "> 開</label>" +
          '<select class="watch-alert-mode" data-watch-notify-mode="' + idx + '" aria-label="通知條件">' +
          modeOpts + "</select>" +
          '<label class="watch-alert-val"><span data-alert-prefix="1">' + esc(meta.prefix) + "</span>" +
          '<input data-watch-notify-val="' + idx + '" inputmode="decimal" value="' + esc(valText) +
          '" placeholder="' + (mode === "pct" ? "3" : "數值") + '" aria-label="通知門檻">' +
          '<span data-alert-suffix="1">' + esc(meta.suffix || "") + "</span>" +
          "</label></div></td>" +
          "</tr>";
      }).join("") + "</tbody></table></div>";
    Promise.all([
      M.watchBoard(book.watch),
      M.watchChips ? M.watchChips(book.watch).catch(function () { return { date: "", byCode: {} }; }) : Promise.resolve({ date: "", byCode: {} })
    ]).then(function (got) {
      if (gen !== renderWatch.gen) return;
      const rows = got[0] || [];
      const chips = got[1] || { date: "", byCode: {} };
      rows.forEach(function (m, idx) { applyWatchQuoteRow(box, m, idx); });
      paintWatchChipRows(box, chips);
      paintWatchTotal();
      checkWatchAlertsFromRows(book.watch, rows);
    }).catch(function () {
      if (gen !== renderWatch.gen) return;
      box.querySelectorAll("[data-watch-price]").forEach(function (cell) {
        cell.className = "watch-num";
        cell.textContent = "—";
      });
      paintWatchTotal();
    });
  }

  function chipLotsTag(n, tag) {
    if (n == null || !isFinite(n)) return "";
    const lots = Math.round(n / 1000);
    const cls = lots > 0 ? "up" : lots < 0 ? "down" : "";
    const sign = lots > 0 ? "+" : lots < 0 ? "-" : "";
    return '<span class="' + cls + '" title="' + esc(tag) + '買賣超">' + esc(tag) + sign +
      Math.abs(lots).toLocaleString("zh-Hant") + "張</span>";
  }

  function paintWatchChipRows(box, pack) {
    if (!box) return;
    const byCode = (pack && pack.byCode) || {};
    const date = pack && pack.date ? String(pack.date) : "";
    const dateLabel = date.length === 8 ? date.slice(4, 6) + "/" + date.slice(6, 8) : "";
    book.watch.forEach(function (item, idx) {
      const el = box.querySelector('[data-watch-chips="' + idx + '"]');
      if (!el) return;
      const code = String(item && item.code || "").toUpperCase();
      const row = code && byCode[code];
      if (!row) {
        el.innerHTML = '<span class="note">' + (dateLabel ? dateLabel + " 無" : "—") + "</span>";
        return;
      }
      const parts = [
        chipLotsTag(row.foreignNet, "外"),
        chipLotsTag(row.trustNet, "投"),
        chipLotsTag(row.dealerNet, "自")
      ].filter(Boolean);
      el.innerHTML = (parts.join(" ") || '<span class="note">—</span>') +
        (dateLabel ? '<span class="watch-chip-date">' + esc(dateLabel) + "</span>" : "");
    });
  }

  function bindSearch(inputId, hitId, key, prefer) {
    let timer = 0;
    $(inputId).addEventListener("input", function () {
      clearTimeout(timer);
      const q = $(inputId).value.trim();
      timer = setTimeout(async function () {
        if (q.length < 1) { $(hitId).innerHTML = ""; return; }
        try {
          let rows = await M.search(q);
          if (prefer) {
            const hit = rows.filter(function (row) { return row.market === prefer; });
            if (hit.length) rows = hit;
          }
          $(hitId).innerHTML = rows.map(function (row) {
            return '<button type="button" class="hit" data-pick="' + key + '" data-secid="' + esc(row.secid) +
              '" data-code="' + esc(row.code) + '" data-name="' + esc(row.name) + '" data-market="' + esc(row.market) +
              '"><strong>' + esc(row.name) + "</strong> " + esc(row.code) + "<small>" + esc(row.market) + "</small></button>";
          }).join("") || '<p class="note">' + (prefer ? "找不到這個台股。" : "找不到美股、台股、日股或韓股。") + "</p>";
        } catch (err) {
          $(hitId).innerHTML = '<p class="note">' + esc(err.message || "搜尋失敗") + "</p>";
        }
      }, 250);
    });
  }

  function syncHolding(item) {
    if (item.shares === "" || item.shares == null) return;
    const hold = book.holdings.find(function (row) { return row.secid === item.secid; });
    if (hold) {
      hold.shares = item.shares;
      hold.cost = item.cost;
      hold.name = item.name;
      hold.code = item.code;
      hold.market = item.market;
      return;
    }
    book.holdings.push({
      secid: item.secid,
      code: item.code,
      name: item.name,
      market: item.market,
      shares: item.shares,
      cost: item.cost
    });
  }

  function savePosition(row) {
    const item = {
      secid: row.secid,
      code: row.code,
      name: twName(row.name),
      market: twName(row.market || ""),
      shares: row.shares == null ? "" : String(row.shares).trim(),
      cost: row.cost == null ? "" : String(row.cost).trim()
    };
    const found = book.watch.find(function (entry) { return entry.secid === item.secid; });
    if (found) {
      found.shares = item.shares;
      found.cost = item.cost;
      found.name = item.name;
      found.code = item.code;
      found.market = item.market;
    } else book.watch.push(item);
    syncHolding(found || item);
    scheduleSave();
    renderWatch(true);
  }

  function lotsText(n) {
    if (n == null || !isFinite(n)) return "—";
    const lots = n / 1000;
    const sign = lots > 0 ? "+" : "";
    return sign + lots.toFixed(0) + " 張";
  }

  function pctText(n) {
    if (n == null || !isFinite(n)) return "—";
    return n.toFixed(1) + "%";
  }

  function renderStockDetail(detail) {
    const box = $("stock-detail");
    if (!box) return;
    if (!detail) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    if (!detail.ok) {
      box.innerHTML = '<article class="card"><p class="note">' + esc(detail.reason || "沒有明細") + "</p></article>";
      return;
    }
    const q = detail.quote;
    const own = detail.ownership || {};
    const m = detail.margins || {};
    const per = detail.per;
    const quoteHtml = q
      ? '<article class="card"><h3>今日行情 ' + esc(q.date.slice(5)) + "</h3><p>收 " + fmt(q.close) +
        ' <span class="' + pctClass((q.spread || 0) / (q.close - (q.spread || 0) || 1)) + '">' +
        (q.spread > 0 ? "+" : "") + fmt(q.spread) + "</span></p><p>最高 " + fmt(q.high) + " · 最低 " + fmt(q.low) +
        " · 成交 " + (q.volume != null ? Math.round(q.volume / 1000).toLocaleString("zh-Hant") + " 張" : "—") +
        "</p></article>"
      : "";
    const chipsHtml = '<article class="card"><h3>今日籌碼日報 ' + esc((detail.chipDate || "").slice(5)) +
      '</h3><div class="chip-grid">' + (detail.chipCards || []).map(function (c) {
        return '<div class="chip-cell"><span class="tag ' + c.tone.cls + '">' + esc(c.tone.label) +
          "</span><div>" + esc(c.name) + '</div><strong class="' + (c.net > 0 ? "up" : c.net < 0 ? "down" : "") + '">' +
          lotsText(c.net) + "</strong></div>";
      }).join("") + '</div><p class="fine">依當日買賣超佔成交比重粗分大買／中買／中立／中賣／大賣。</p></article>';
    const ownHtml = '<article class="card"><h3>籌碼分佈</h3><ul class="stat-list">' +
      "<li><span>外資持股占比</span><strong>" + pctText(own.foreignPct) + "</strong></li>" +
      "<li><span>外資剩餘可投資占比</span><strong>" + pctText(own.foreignRemain) + "</strong></li>" +
      '<li><span>近 5 日外資買賣超</span><strong class="' + ((own.flow5 && own.flow5.foreign) > 0 ? "up" : "down") + '">' + lotsText(own.flow5 && own.flow5.foreign) + "</strong></li>" +
      '<li><span>近 5 日投信買賣超</span><strong class="' + ((own.flow5 && own.flow5.trust) > 0 ? "up" : "down") + '">' + lotsText(own.flow5 && own.flow5.trust) + "</strong></li>" +
      '<li><span>近 5 日自營買賣超</span><strong class="' + ((own.flow5 && own.flow5.dealer) > 0 ? "up" : "down") + '">' + lotsText(own.flow5 && own.flow5.dealer) + "</strong></li>" +
      '<li><span>近 5 日法人合計</span><strong class="' + ((own.flow5 && own.flow5.total) > 0 ? "up" : "down") + '">' + lotsText(own.flow5 && own.flow5.total) + "</strong></li>" +
      '</ul><p class="fine">持股占比目前公開資料主要是外資；投信／自營以近 5 日買賣超代表法人籌碼流向。</p></article>';
    const finHtml = '<article class="card"><h3>財務狀況（三率）</h3><ul class="stat-list">' +
      "<li><span>毛利率</span><strong>" + pctText(m.gross) + ' <span class="' + (m.grossTrend && m.grossTrend.cls) + '">' + esc(m.grossTrend && m.grossTrend.text) + "</span></strong></li>" +
      "<li><span>營益率</span><strong>" + pctText(m.op) + ' <span class="' + (m.opTrend && m.opTrend.cls) + '">' + esc(m.opTrend && m.opTrend.text) + "</span></strong></li>" +
      "<li><span>淨利率</span><strong>" + pctText(m.net) + ' <span class="' + (m.netTrend && m.netTrend.cls) + '">' + esc(m.netTrend && m.netTrend.text) + "</span></strong></li>" +
      '</ul><p class="fine">用最近一季對上一季判斷上升／下降。資料截至 ' + esc(m.date || "—") + "。</p></article>";
    const epsHtml = '<article class="card"><h3>EPS 與本益比</h3><table class="eps-table"><thead><tr><th>年</th><th>EPS</th><th>別</th></tr></thead><tbody>' +
      (detail.epsYears || []).map(function (row) {
        return "<tr><td>" + row.year + "</td><td>" + (row.eps == null ? "—" : row.eps.toFixed(2)) + "</td><td>" + esc(row.kind) + "</td></tr>";
      }).join("") + "</tbody></table><p>本益比 " + (per && per.per != null ? per.per.toFixed(2) + " 倍" : "—") +
      " · 股價淨值比 " + (per && per.pbr != null ? per.pbr.toFixed(2) : "—") +
      " · 殖利率 " + (per && per.yield != null ? per.yield.toFixed(2) + "%" : "—") +
      '</p><p class="fine">前兩年為財報季 EPS 加總；今年未滿四季會年化。後兩年依近兩年成長粗估，不是券商正式預估。</p></article>';
    const volHtml = '<article class="card"><h3>近 60 日成交張數</h3><ul class="vol-list">' +
      (detail.volumes || []).map(function (row) {
        return "<li><span>" + esc(row.date.slice(5)) + '</span><strong class="' + (row.spread > 0 ? "up" : row.spread < 0 ? "down" : "") + '">' +
          row.lots.toLocaleString("zh-Hant") + "</strong></li>";
      }).join("") + "</ul></article>";
    box.innerHTML = quoteHtml + chipsHtml + ownHtml + finHtml + epsHtml + volHtml;
  }

  async function loadStockDetail(row) {
    const box = $("stock-detail");
    if (!box) return;
    if (!row) { renderStockDetail(null); return; }
    box.hidden = false;
    box.innerHTML = '<article class="card"><p class="status">正在讀籌碼與財務…</p></article>';
    try {
      const detail = await M.stockDetail(row.secid, row.code);
      if (!state.focus || state.focus.secid !== row.secid) return;
      renderStockDetail(detail);
    } catch (err) {
      if (!state.focus || state.focus.secid !== row.secid) return;
      box.innerHTML = '<article class="card"><p class="note">' + esc(err.message || "明細讀取失敗") + "</p></article>";
    }
  }

  function openSymbol(row) {
    state.focus = row;
    state.focusFrom = "watch";
    state.range = state.range === "1d" ? "1d" : "1y";
    state.custom = false;
    state.chartStyle = "candle";
    setView("chart");
    buildToggles();
    paintFocus();
    loadStockDetail(row);
  }

  function addFromForm() {
    const row = state.picks.watch;
    if (!row) {
      $("watch-status").textContent = "先點一個搜尋結果。";
      return;
    }
    savePosition({
      secid: row.secid,
      code: row.code,
      name: row.name,
      market: row.market,
      shares: $("watch-shares").value,
      cost: $("watch-cost").value
    });
    state.picks.watch = null;
    $("watch-pick").textContent = "點選搜尋結果後，填買進價格與股數。";
    $("watch-q").value = "";
    $("watch-shares").value = "";
    $("watch-cost").value = "";
    $("watch-hits").innerHTML = "";
    $("watch-status").textContent = "";
    setWatchCompose(false);
  }

  function renderImport() {
    const box = $("import-box");
    if (!importRows.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = importRows.map(function (row, idx) {
      const note = row.note ? "<small>" + esc(row.note) + "</small>" : "";
      const miss = row.secid ? "" : "<small>找不到這個代號，這列會略過。</small>";
      return '<div class="item"><div><strong>' + esc(row.name || row.code) + "</strong> " + esc(row.code) +
        miss + note +
        '<div class="grid2"><input data-import-shares="' + idx + '" inputmode="numeric" value="' + esc(row.shares) + '" aria-label="股數">' +
        '<input data-import-cost="' + idx + '" inputmode="decimal" value="' + esc(row.cost) + '" aria-label="買價"></div></div></div>';
    }).join("") + '<button id="import-ok" class="primary" type="button">匯入這些持股</button>';
  }

  function commitImport() {
    let n = 0;
    importRows.forEach(function (row) {
      if (!row.secid) return;
      savePosition(row);
      n += 1;
    });
    importRows = [];
    renderImport();
    $("watch-status").textContent = n ? "已匯入 " + n + " 檔。" : "沒有可匯入的代號。";
    if (n) setWatchCompose(false);
  }

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error("辨識程式載入失敗")); };
      document.head.appendChild(script);
    });
  }

  function prepImage(file) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
        // 券商截圖：略過頂部深藍標題與底部導覽，保留白色庫存表
        const top = Math.round(img.height * 0.16);
        const bottom = Math.round(img.height * 0.88);
        const cropH = Math.max(1, bottom - top);
        const scale = img.width < 2000 ? 2000 / img.width : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(cropH * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, top, img.width, cropH, 0, 0, canvas.width, canvas.height);
        const out = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = out.data;
        let min = 255;
        let max = 0;
        for (let i = 0; i < px.length; i += 4) {
          const L = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          if (L < min) min = L;
          if (L > max) max = L;
        }
        const span = Math.max(1, max - min);
        for (let i = 0; i < px.length; i += 4) {
          let L = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          L = ((L - min) / span) * 255;
          L = (L - 128) * 1.35 + 128;
          L = L < 0 ? 0 : L > 255 ? 255 : L;
          px[i] = px[i + 1] = px[i + 2] = L;
        }
        ctx.putImageData(out, 0, 0);
        URL.revokeObjectURL(img.src);
        resolve(canvas);
      };
      img.onerror = function () { reject(new Error("這張圖讀不起來")); };
      img.src = URL.createObjectURL(file);
    });
  }

  function usefulWatchName(name) {
    let n = String(name || "").replace(/現股/g, "").replace(/[時人之]+$/g, "").trim();
    n = n.replace(/^(主動)/, "$1");
    if (/野村台灣/.test(n)) n = "主動野村台灣50";
    if (/統一台股增長/.test(n)) n = "主動統一台股增長";
    if (/統一升級/.test(n)) n = "主動統一升級50";
    if (/^廣達/.test(n)) n = "廣達";
    if (/^欣興/.test(n)) n = "欣興";
    if (/^智邦/.test(n)) n = "智邦";
    return n.length >= 2 && /[\u4e00-\u9fff]/.test(n) ? n : "";
  }

  async function resolveParsed(parsed) {
    const out = [];
    for (let i = 0; i < parsed.length; i++) {
      const row = parsed[i];
      let hit = null;
      const want = String(row.code || "").toUpperCase();
      try {
        const found = await M.search(row.code);
        hit = found.find(function (item) { return String(item.code).toUpperCase() === want && item.market === "台股"; })
          || found.find(function (item) { return String(item.code).toUpperCase() === want; })
          || null;
      } catch (err) { /* 單一代號失敗就留白，讓使用者改 */ }
      const byName = usefulWatchName(row.name);
      if (byName) {
        try {
          const named = await M.search(byName);
          const nameHit = named.find(function (item) {
            return item.market === "台股" && (
              String(item.name || "").indexOf(byName.slice(0, 2)) >= 0 ||
              byName.indexOf(String(item.name || "").slice(0, 2)) >= 0
            );
          }) || named.find(function (item) { return item.market === "台股"; }) || null;
          if (nameHit) {
            const codeOk = hit && String(hit.code).toUpperCase() === String(nameHit.code).toUpperCase();
            if (!hit || !codeOk) hit = nameHit;
          }
        } catch (err) { /* 名稱備援失敗就用代號結果 */ }
      }
      const item = {
        code: hit ? hit.code : row.code,
        name: hit ? hit.name : (byName || row.code),
        secid: hit ? hit.secid : "",
        market: hit ? hit.market : "台股",
        shares: row.shares,
        cost: "",
        note: ""
      };
      const costOk = row.cost > 0 && row.cost !== row.shares && row.cost < 100000;
      if (costOk) {
        item.cost = (Math.round(row.cost * 100) / 100).toFixed(2);
        item.note = row.note || "圖上成本均價";
      } else if (item.secid && (row.pct != null || row.pnl != null)) {
        try {
          const map = await M.quoteMap([item.secid]);
          const quote = map[item.secid];
          if (quote && quote.price > 0 && row.shares > 0) {
            let cost = null;
            let note = "";
            // 獲利率比損益數字穩，優先用％回推
            if (row.pct != null && isFinite(row.pct) && Math.abs(row.pct) < 80 && row.pct !== -100) {
              cost = quote.price / (1 + row.pct / 100);
              note = "現價 " + fmt(quote.price) + "，獲利 " + row.pct + "%，回推買價";
            } else if (row.pnl != null) {
              cost = quote.price - row.pnl / row.shares;
              note = "現價 " + fmt(quote.price) + "，損益 " + row.pnl + "，回推買價";
            }
            if (cost > 0) {
              item.cost = (Math.round(cost * 100) / 100).toFixed(2);
              item.note = note;
            }
          }
        } catch (err) { /* 沒報價就讓使用者自己填買價 */ }
      }
      if (!item.note && row.pnl != null) item.note = "圖上損益 " + row.pnl + "，請補買價";
      out.push(item);
    }
    return out;
  }

  async function readFubonHoldingsJson(file) {
    $("watch-json-btn").disabled = true;
    $("watch-status").textContent = "正在讀富邦庫存 JSON…";
    try {
      const text = await file.text();
      const parsed = M.parseFubonHoldingsJson(text).map(function (row) {
        return Object.assign({}, row, { note: row.cost > 0 ? "富邦 JSON 成本" : "" });
      });
      if (!parsed.length) {
        $("watch-status").textContent = "JSON 裡沒有可用的代號與股數。請確認是 StockJason 匯出的富邦庫存檔。";
        importRows = [];
        renderImport();
        return;
      }
      const priced = parsed.filter(function (row) { return row.cost > 0; }).length;
      $("watch-status").textContent = "讀到 " + parsed.length + " 檔" +
        (priced ? "，其中 " + priced + " 檔有成本。" : "，部分沒有成本請補買價。");
      importRows = await resolveParsed(parsed);
      renderImport();
      $("watch-status").textContent = "確認股數與買價後按匯入。JSON 只在這台裝置讀取，不會上傳。";
    } catch (err) {
      $("watch-status").textContent = err.message || "JSON 讀取失敗";
    } finally {
      $("watch-json-btn").disabled = false;
    }
  }

  async function readInventoryPhoto(file) {
    $("watch-photo-btn").disabled = true;
    $("watch-status").textContent = "正在讀圖。第一次會下載中文辨識資料。";
    let worker = null;
    try {
      await loadTesseract();
      worker = await window.Tesseract.createWorker("chi_tra+eng", 1, {
        logger: function (msg) {
          if (!msg) return;
          if (msg.status === "recognizing text") {
            $("watch-status").textContent = "辨識中 " + Math.round((msg.progress || 0) * 100) + "%";
          } else {
            $("watch-status").textContent = "辨識準備中…";
          }
        }
      });
      const canvas = await prepImage(file);
      // 多種排版模式合併，提高券商表格讀取率
      const texts = [];
      for (let i = 0; i < 3; i++) {
        const psm = ["6", "4", "11"][i];
        $("watch-status").textContent = "辨識中（模式 " + (i + 1) + "/3）…";
        await worker.setParameters({ tessedit_pageseg_mode: psm });
        const ret = await worker.recognize(canvas);
        if (ret && ret.data && ret.data.text) texts.push(ret.data.text);
      }
      const parsed = M.parseInventory(texts.join("\n"));
      if (!parsed.length) {
        $("watch-status").textContent = "沒讀到代號和股數。請改用上方搜尋，或換一張較清晰、直式的庫存表。";
        importRows = [];
        renderImport();
        return;
      }
      const priced = parsed.filter(function (row) { return row.cost > 0; }).length;
      $("watch-status").textContent = priced
        ? "讀到 " + parsed.length + " 檔，其中 " + priced + " 檔用圖上的成本均價當買價。"
        : "讀到 " + parsed.length + " 檔，正在查現價回推買價…";
      importRows = await resolveParsed(parsed);
      renderImport();
      $("watch-status").textContent = "確認股數與買價後按匯入。圖只在這台手機辨識，不會另存。";
    } catch (err) {
      $("watch-status").textContent = err.message || "讀圖失敗";
    } finally {
      $("watch-photo-btn").disabled = false;
      if (worker) worker.terminate();
    }
  }

  function moneyFrom(which) {
    if (which === "news") {
      book.capital = Number($("news-capital").value) || book.capital;
      book.riskPct = Number($("news-risk").value) || book.riskPct;
    } else {
      book.capital = Number($("idea-capital").value) || book.capital;
      book.riskPct = Number($("idea-risk").value) || book.riskPct;
    }
    scheduleSave();
    return { capital: book.capital, riskPct: book.riskPct };
  }

  function ideaLimit() {
    const n = Math.floor(Number($("idea-count").value));
    const limit = Math.max(1, Math.min(20, isFinite(n) && n > 0 ? n : 5));
    $("idea-count").value = String(limit);
    return limit;
  }

  async function runIdeas() {
    const money = moneyFrom("idea");
    const limit = ideaLimit();
    $("idea-run").disabled = true;
    $("idea-status").textContent = "開始掃描…";
    $("idea-out").innerHTML = "";
    try {
      const report = await M.scan({
        market: "台股",
        limit: limit,
        capital: money.capital,
        riskPct: money.riskPct,
        onProgress: function (done, total, name) {
          $("idea-status").textContent = "正在讀 " + name + "（" + done + "/" + total + "）";
        }
      });
      $("idea-status").textContent = "掃了 " + report.scanned + " 檔，可進場 " + report.tradable + " 檔。以下是分數最高的 " + report.ideas.length + " 檔。";
      $("idea-out").innerHTML = report.ideas.map(function (item) {
        return '<article class="card"><p><span class="badge ' + (item.badge === "可進場" ? "go" : "") + '">' + esc(item.badge) +
          "</span> " + item.rank + ". " + esc(item.name) + " " + esc(item.code) + " · " + esc(item.market) + " · " + esc(item.setup) +
          "</p><p>進場 " + fmt(item.entry) + " · 停損 " + fmt(item.stop) + " · 停利 " + fmt(item.target) +
          " · 風報比 " + (item.rr || "—") + "</p><p>單筆風險約 " + fmt(item.riskCash) + "，建議股數 " + item.shares + "。</p><p>" +
          item.reasons.map(esc).join("</p><p>") + "</p><p>" + esc(item.fundamental) + "</p></article>";
      }).join("") + '<p class="fine">規則試算，不是下單建議。</p>';
    } catch (err) {
      $("idea-status").textContent = err.message || "掃描失敗";
    } finally {
      $("idea-run").disabled = false;
    }
  }

  async function runTech() {
    const pick = state.picks.tech;
    if (!pick) { $("tech-status").textContent = "先選一個標的。"; return; }
    $("tech-run").disabled = true;
    $("tech-status").textContent = "正在拆日線與週線…";
    try {
      const r = await M.technical(pick.secid);
      $("tech-status").textContent = "";
      $("tech-out").innerHTML = '<article class="card"><h3>' + esc(r.name) + " · " + esc(r.verdict) + "</h3><p>收盤 " + fmt(r.close) +
        "</p><ol>" + r.steps.map(function (step) {
          return '<li class="' + (step.pass ? "pass" : "fail") + '">' + esc(step.name) + "：" + esc(step.detail) + "</li>";
        }).join("") + "</ol><p>支撐 " + (r.supports.map(fmt).join("、") || "附近沒有擺動低點") +
        "</p><p>壓力 " + (r.resistances.map(fmt).join("、") || "附近沒有擺動高點") +
        "</p><p>" + esc(r.trend) + "</p><p>" + r.mas.map(function (m) {
          return m.name + " " + fmt(m.value) + (m.above ? "（價在之上）" : "（價在之下）");
        }).join(" · ") + "</p><p>" + esc(r.momentum) + "</p><p>" + esc(r.weekly) +
        "</p><p class=\"fine\">買進要四項都過；賣出要均線、MACD、RSI 與週線同時偏空；其餘觀望。</p></article>";
    } catch (err) {
      $("tech-status").textContent = err.message || "分析失敗";
    } finally {
      $("tech-run").disabled = false;
    }
  }

  async function runAdvise() {
    const pick = state.picks.advise;
    if (!pick) { $("advise-status").textContent = "先選一個標的（可點自選）。"; return; }
    $("advise-run").disabled = true;
    $("advise-status").textContent = "正在讀基本面、籌碼與 K 線…";
    try {
      const r = await M.stockAdvice(pick.secid, pick.code);
      if (!r.ok) {
        $("advise-status").textContent = r.reason || "無法研判";
        $("advise-out").innerHTML = "";
        return;
      }
      $("advise-status").textContent = "";
      const adviceCls = r.advice.indexOf("買") >= 0 ? "up" : r.advice.indexOf("賣") >= 0 || r.advice.indexOf("減") >= 0 ? "down" : "";
      const fundLis = (r.fund.notes || []).map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");
      const chipLis = (r.chip.notes || []).map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");
      const buyLis = (r.buyPoints || []).map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");
      const sellLis = (r.sellPoints || []).map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");
      const patLis = (r.patterns || []).slice(0, 6).map(function (p) {
        const cls = p.bias === "多" ? "up" : p.bias === "空" ? "down" : "";
        return "<li><span class=\"k-date\">" + esc((p.date || "").slice(5)) + "</span> " +
          '<strong class="' + cls + '">' + esc(p.name) + "</strong> " + esc(p.detail) + "</li>";
      }).join("");
      const techLine = r.tech
        ? "<p>技術結論 " + esc(r.tech.verdict) + " · " + esc(r.tech.momentum || "") + " · " + esc(r.tech.weekly || "") + "</p>"
        : "<p class=\"fine\">技術條件這次沒算完，改以籌碼與 K 線為主。</p>";
      $("advise-out").innerHTML = '<article class="card"><h3>' + esc(r.name) + " " + esc(r.code) +
        ' · <span class="' + adviceCls + '">' + esc(r.advice) + "</span></h3>" +
        "<p>現價 " + fmt(r.close) + (r.atr != null ? " · ATR(14) " + fmt(r.atr) : "") +
        " · 綜合分 " + esc(String(r.score)) + "</p>" + techLine +
        "<h4>基本面</h4><ul class=\"stat-list\">" + fundLis + "</ul>" +
        "<h4>籌碼面" + (r.chip.date ? "（" + esc(String(r.chip.date).slice(5)) + "）" : "") + "</h4><ul class=\"stat-list\">" + chipLis + "</ul>" +
        "<h4>K線買點</h4><ul>" + buyLis + "</ul>" +
        "<h4>K線賣點／停損</h4><ul>" + sellLis + "</ul>" +
        (patLis ? "<h4>近期型態</h4><ul>" + patLis + "</ul>" : "") +
        '<p class="fine">規則試算，不是投資建議。盤中法人買賣超可能尚未公告。</p></article>';
    } catch (err) {
      $("advise-status").textContent = err.message || "研判失敗";
    } finally {
      $("advise-run").disabled = false;
    }
  }

  async function runNews() {
    const pick = state.picks.news;
    if (!pick) { $("news-status").textContent = "先選一個標的。"; return; }
    const text = $("news-text").value.trim();
    if (!text) { $("news-status").textContent = "先貼上新聞。"; return; }
    const money = moneyFrom("news");
    $("news-run").disabled = true;
    $("news-status").textContent = "正在對照價格…";
    try {
      const r = await M.newsPlan({ secid: pick.secid, text: text, capital: money.capital, riskPct: money.riskPct });
      $("news-status").textContent = "";
      const seen = r.noTime
        ? "<p>內文沒有明確的已發生或未來時點，不把句子硬分成已反映。</p>"
        : "<p>較像已經公開：" + (r.seen.map(esc).join("；") || "沒有") + "</p><p>較像尚未完全反映：" + (r.unseen.map(esc).join("；") || "沒有") + "</p>";
      $("news-out").innerHTML = '<article class="card"><h3>' + esc(r.name) + " · 方向 " + esc(r.bias) + "</h3><p>現價 " + fmt(r.close) +
        "。短線波動區間 " + fmt(r.shortRange[0]) + "～" + fmt(r.shortRange[1]) + "（約 1.2 倍 ATR）。</p><p>較長區間 " +
        fmt(r.longRange[0]) + "～" + fmt(r.longRange[1]) + "。" + esc(r.weeklyNote) + "</p><p>" + esc(r.pricedText) + "</p>" +
        seen + "<p>" + esc(r.fundamental) + "</p><p>部位：單筆風險 " + fmt(r.riskCash) + "，停損 " + fmt(r.stop) +
        "，約 " + r.shares + " 股。失效條件：收盤跌破停損，或新聞裡的未來事項被公司否認。</p><p class=\"fine\">詞彙與波動只是估計，不是事件研究。</p></article>";
    } catch (err) {
      $("news-status").textContent = err.message || "轉換失敗";
    } finally {
      $("news-run").disabled = false;
    }
  }

  async function runTest() {
    const pick = state.picks.test;
    if (!pick) { $("test-status").textContent = "先選一個標的。"; return; }
    $("test-run").disabled = true;
    $("test-status").textContent = "正在回測…";
    try {
      const r = await M.backtest({ secid: pick.secid, strategy: $("test-strategy").value, range: $("test-range").value });
      const m = r.metrics;
      const pf = m.profitFactor == null ? "無虧損單" : m.profitFactor.toFixed(2);
      $("test-status").textContent = "";
      $("test-out").innerHTML = '<article class="card"><h3>' + esc(r.name) + "</h3><p>" + esc(r.strategy) + " · " + esc(r.rangeLabel) +
        " · " + r.bars + " 根日線。收盤價成交，未扣成本。" + (m.open ? " 最後一筆尚未平倉，不計入勝率。" : "") +
        "</p><p>交易 " + m.trades + " 筆 · 勝率 " + (m.winRate == null ? "—" : (m.winRate * 100).toFixed(1) + "%") +
        " · 獲利因子 " + pf + " · 最大回撤 " + (m.maxDD * 100).toFixed(1) + "% · 平均報酬 " + (m.avg * 100).toFixed(2) +
        "%</p><h3>改進</h3><ul>" + r.tips.map(function (tip) { return "<li>" + esc(tip) + "</li>"; }).join("") + "</ul></article>";
    } catch (err) {
      $("test-status").textContent = err.message || "回測失敗";
    } finally {
      $("test-run").disabled = false;
    }
  }

  function renderHoldings() {
    const box = $("risk-list");
    if (!book.holdings.length) {
      box.innerHTML = '<p class="note">還沒有持股。搜尋後輸入股數與成本。</p>';
      return;
    }
    box.innerHTML = book.holdings.map(function (item, idx) {
      if (item.name) item.name = twName(item.name);
      if (item.market) item.market = twName(item.market);
      return '<div class="item"><div><strong>' + esc(item.name) + "</strong> " + esc(item.code) +
        '<div class="grid2"><input data-shares="' + idx + '" inputmode="decimal" value="' + esc(item.shares) + '" aria-label="股數">' +
        '<input data-cost="' + idx + '" inputmode="decimal" value="' + esc(item.cost) + '" aria-label="成本"></div></div>' +
        '<button type="button" class="danger" data-del-hold="' + idx + '">移除</button></div>';
    }).join("");
  }

  async function runRisk() {
    $("risk-run").disabled = true;
    $("risk-status").textContent = "正在算權重與相關…";
    book.profile = $("risk-profile").value;
    scheduleSave();
    try {
      const r = await M.riskReport({ holdings: book.holdings, profile: book.profile });
      $("risk-status").textContent = "";
      const cash = r.cashFrac == null ? "beta 偏低，不必為了把跌幅壓半而大幅減碼。" :
        "若要把大盤跌 20% 時的估計跌幅壓到約 10%，可把約 " + Math.round(r.cashFrac * 100) + "% 的持股換成現金，優先減 beta 較高的部位。";
      $("risk-out").innerHTML = '<article class="card"><p>市值合計 ' + fmt(r.total) + " · 組合 beta " + r.beta.toFixed(2) +
        "（對標普500）· 大盤跌 20% 時估計約跌 " + (r.drop * 100).toFixed(1) + "%</p><table><tr><th>標的</th><th>權重</th><th>beta</th><th>未實現</th></tr>" +
        r.rows.map(function (row) {
          return "<tr><td>" + esc(row.code) + "</td><td>" + (row.weight * 100).toFixed(1) + "%</td><td>" +
            (row.beta == null ? "—" : row.beta.toFixed(2)) + "</td><td>" + (row.pnl == null ? "—" : fmt(row.pnl)) + "</td></tr>";
        }).join("") + "</table><h3>弱點</h3><ul>" + r.weak.map(function (line) { return "<li>" + esc(line) + "</li>"; }).join("") +
        "</ul><h3>再平衡</h3><ul>" + r.plan.map(function (row) {
          return "<li>" + esc(row.code) + " " + (row.from * 100).toFixed(1) + "% → " + (row.to * 100).toFixed(1) + "%</li>";
        }).join("") + "</ul>" + (r.cashLeft > 0.01 ? "<p>超過上限的部分約 " + (r.cashLeft * 100).toFixed(1) + "% 先留現金。</p>" : "") +
        "<p>" + cash + "</p><p class=\"fine\">beta 用近 180 個交易日，相關高於 0.75 才標成隱藏連動。</p></article>";
    } catch (err) {
      $("risk-status").textContent = err.message || "計算失敗";
    } finally {
      $("risk-run").disabled = false;
    }
  }

  function renderJournal() {
    const rows = book.journal.slice().sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); });
    $("j-list").innerHTML = rows.length ? rows.slice(0, 20).map(function (item) {
      return '<div class="item"><div><strong>' + esc(item.date) + " " + esc(item.name || item.code) + "</strong><small>" +
        esc(item.side) + (item.missed ? " · 錯過" : "") + " " + esc(item.emotion || "") + "</small></div>" +
        '<button type="button" class="danger" data-del-j="' + esc(item.id) + '">刪</button></div>';
    }).join("") : '<p class="note">還沒有交易紀錄。</p>';
  }

  function addJournal() {
    const pick = state.picks.journal;
    if (!pick) { $("j-status").textContent = "先選標的。"; return; }
    if (!$("j-date").value) { $("j-status").textContent = "先填日期。"; return; }
    book.journal.push({
      id: Date.now().toString(36),
      date: $("j-date").value,
      secid: pick.secid,
      code: pick.code,
      name: pick.name,
      side: $("j-side").value,
      entry: $("j-entry").value,
      exit: $("j-exit").value,
      qty: $("j-qty").value,
      stop: $("j-stop").value,
      emotion: $("j-emotion").value,
      missed: $("j-missed").checked,
      note: $("j-note").value.trim()
    });
    if (book.journal.length > 100) book.journal = book.journal.slice(-100);
    scheduleSave();
    $("j-note").value = "";
    $("j-missed").checked = false;
    $("j-status").textContent = "已寫入。";
    renderJournal();
  }

  function runJournal() {
    const r = M.reviewJournal(book.journal);
    $("j-status").textContent = "";
    $("j-out").innerHTML = '<article class="card"><p>最近 ' + r.sample + " 筆，其中完成進出 " + r.filled + " 筆、錯過 " + r.missed +
      " 筆。勝率 " + (r.winRate == null ? "—" : (r.winRate * 100).toFixed(0) + "%") +
      "。平均獲利 " + (r.avgWin * 100).toFixed(1) + "%，平均虧損 " + (r.avgLoss * 100).toFixed(1) +
      "%。沒寫停損 " + r.noStop + " 筆。</p><h3>行為</h3><ul>" + r.biases.map(function (line) {
        return "<li>" + esc(line) + "</li>";
      }).join("") + "</ul><h3>立刻可執行的三條</h3><ol>" + r.rules.map(function (line) {
        return "<li>" + esc(line) + "</li>";
      }).join("") + "</ol>" + (r.small ? "<p class=\"fine\">樣本不到 5 筆，規則先當起步約束。</p>" : "") + "</article>";
  }

  let lastPredict = null;

  function predictCsvText(r) {
    const lines = [
      "項目,數值",
      "標的," + r.target,
      "預測區間," + r.horizon,
      "歷史期間," + r.history,
      "資料日," + r.asOf,
      "總分," + r.score,
      "方向," + r.grade,
      "回測筆數," + r.backtest.trials,
      "方向命中率," + (r.backtest.accuracy == null ? "" : (r.backtest.accuracy * 100).toFixed(1) + "%"),
      "",
      "因子,類別,權重,分數,報酬或淨額"
    ];
    r.parts.forEach(function (p) {
      lines.push([p.label, p.group, p.weight, p.score, p.ret].join(","));
    });
    lines.push("");
    lines.push("回測日期,分數,預測,實際,後續報酬");
    (r.backtest.samples || []).forEach(function (s) {
      lines.push([s.date, s.score, s.pred, s.actual, (s.futurePct * 100).toFixed(2) + "%"].join(","));
    });
    return lines.join("\n");
  }

  async function runPredict() {
    const horizon = $("predict-horizon").value;
    const history = $("predict-history").value;
    if (horizon === "stock" && !state.picks.predict) {
      $("predict-status").textContent = "個股模式請先選標的。";
      return;
    }
    $("predict-run").disabled = true;
    $("predict-csv").hidden = true;
    $("predict-status").textContent = "正在讀國際與法人資料…";
    $("predict-out").innerHTML = "";
    try {
      const pick = state.picks.predict;
      const r = await M.twPredict({
        horizon: horizon,
        history: history,
        secid: pick && pick.secid,
        code: pick && pick.code,
        name: pick && pick.name
      });
      lastPredict = r;
      const bt = r.backtest;
      const acc = bt.accuracy == null ? "—" : (bt.accuracy * 100).toFixed(1) + "%";
      $("predict-status").textContent = "";
      $("predict-out").innerHTML = '<article class="card">' +
        "<h3>" + esc(r.target) + " · " + esc(r.grade) + "（" + esc(r.band) + "）</h3>" +
        "<p>總分 <strong>" + r.score + "</strong>／資料日 " + esc(r.asOf) +
        " · 預測 " + esc(horizon) + " · 回測 " + esc(history) + "</p>" +
        "<p>歷史方向命中 " + acc + "（僅評 |分|≥30 的交易日，共 " + bt.trials + " 筆；偏多 " +
        bt.longN + "／偏空 " + bt.shortN + "）。這是方向強弱，不是漲跌機率保證。</p>" +
        "<h3>類別分數</h3><ul>" + r.groups.map(function (g) {
          return "<li>" + esc(g.label) + "：" + g.score + "</li>";
        }).join("") + "</ul>" +
        "<h3>主要因子</h3><table><tr><th>指標</th><th>分數</th></tr>" +
        r.parts.slice(0, 12).map(function (p) {
          return "<tr><td>" + esc(p.label) + "</td><td>" + p.score + "</td></tr>";
        }).join("") + "</table>" +
        "<h3>組合條件</h3><ul>" + r.combos.map(function (line) {
          return "<li>" + esc(line) + "</li>";
        }).join("") + "</ul>" +
        "<h3>已納入（原期貨／廣度／融資）</h3><ul>" + (r.included || []).map(function (line) {
          return "<li>" + esc(line) + "</li>";
        }).join("") + "</ul>" +
        "<h3>中期參考（產業／總經）</h3><ul>" + (r.midTerm || []).map(function (line) {
          return "<li>" + esc(line) + "</li>";
        }).join("") + "</ul>" +
        "<p class=\"fine\">" + esc(r.weightsNote) +
        " CSV 可匯入 Excel；若要做 Logistic／XGBoost，請用同一份歷史因子另開 Python 訓練。</p></article>";
      $("predict-csv").hidden = false;
    } catch (err) {
      $("predict-status").textContent = err.message || "預測失敗";
    } finally {
      $("predict-run").disabled = false;
    }
  }

  function downloadPredictCsv() {
    if (!lastPredict) return;
    const blob = new Blob(["\ufeff" + predictCsvText(lastPredict)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tw-predict-" + (lastPredict.asOf || "out") + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  let lastReport = null;

  function reportSortLabel(mode) {
    return ({
      pctDown: "漲跌％由高到低",
      pctUp: "漲跌％由低到高",
      foreignBuy: "外資買賣超（買超多）",
      foreignSell: "外資買賣超（賣超多）",
      instBuy: "三大法人買賣超（買超多）",
      instSell: "三大法人買賣超（賣超多）",
      amount: "成交金額由高到低"
    })[mode] || mode;
  }

  function fmtShareNet(n) {
    if (n == null || !isFinite(n)) return "—";
    const lots = n / 1000;
    const sign = lots > 0 ? "+" : "";
    return sign + lots.toLocaleString("zh-TW", { maximumFractionDigits: 0 }) + " 張";
  }

  function fmtAmt(n) {
    if (n == null || !isFinite(n)) return "—";
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + " 億";
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(0) + " 萬";
    return n.toLocaleString("zh-TW");
  }

  function filterReportRows(rows, only) {
    return (rows || []).filter(function (row) {
      const code = String(row.code || "");
      // 4 碼且非 00xx（ETF 常見）視為一般上市股票
      const isStock = /^\d{4}$/.test(code) && !/^00/.test(code);
      if (only === "stock") return isStock;
      if (only === "etf") return !isStock;
      return true;
    });
  }

  function reportTableHtml(rows, limit, days) {
    const slice = rows.slice(0, limit);
    const multi = days > 1;
    return '<table class="report-table"><thead><tr>' +
      "<th>#</th><th>代號</th><th>名稱</th><th>收盤</th><th>" + (multi ? "區間漲跌" : "漲跌") + "</th><th>" +
      (multi ? "區間％" : "漲跌％") + "</th>" +
      "<th>" + (multi ? "外資合計" : "外資") + "</th><th>" + (multi ? "法人合計" : "三大法人") +
      "</th><th>" + (multi ? "成交合計" : "成交金額") + "</th></tr></thead><tbody>" +
      slice.map(function (row, i) {
        const cls = pctClass((row.pct || 0) / 100);
        const chg = row.change == null ? "—" :
          ((row.change > 0 ? "+" : "") + Number(row.change).toFixed(2));
        const p = row.pct == null ? "—" :
          ((row.pct > 0 ? "+" : "") + Number(row.pct).toFixed(2) + "%");
        return "<tr><td>" + (i + 1) + "</td><td>" + esc(row.code) + "</td><td>" + esc(row.name) +
          "</td><td class=\"num\">" + (row.close == null ? "—" : fmt(row.close)) +
          "</td><td class=\"num " + cls + "\">" + chg +
          "</td><td class=\"num " + cls + "\">" + p +
          "</td><td class=\"num " + pctClass(row.foreignNet || 0) + "\">" + fmtShareNet(row.foreignNet) +
          "</td><td class=\"num " + pctClass(row.instNet || 0) + "\">" + fmtShareNet(row.instNet) +
          "</td><td class=\"num\">" + fmtAmt(row.amount) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  function buildReportView(pack, mode, only, limit) {
    const filtered = filterReportRows(pack.rows, only);
    const sorted = M.sortDailyReportRows(filtered, mode);
    const twii = pack.twii;
    const days = pack.days || 1;
    const rangeLabel = days > 1
      ? (pack.startDate + "～" + pack.date + "（" + days + " 日）")
      : pack.date;
    const fundLabel = pack.fundDateFrom && pack.fundDateFrom !== pack.fundDate
      ? (pack.fundDateFrom + "～" + pack.fundDate)
      : (pack.fundDate || "尚未公告");
    const summary = '<div class="report-summary">' +
      "<div><span>行情區間</span><strong>" + esc(rangeLabel) + "</strong></div>" +
      "<div><span>法人區間</span><strong>" + esc(fundLabel) + "</strong></div>" +
      "<div><span>加權收盤</span><strong class=\"" + (twii ? pctClass((twii.pct || 0) / 100) : "") + "\">" +
      (twii && twii.close != null ? fmt(twii.close) : "—") + "</strong></div>" +
      "<div><span>" + (days > 1 ? "加權區間漲跌" : "加權漲跌") + "</span><strong class=\"" +
      (twii ? pctClass((twii.pct || 0) / 100) : "") + "\">" +
      (twii && twii.change != null
        ? ((twii.change > 0 ? "+" : "") + Number(twii.change).toFixed(2) +
          "（" + (twii.pct > 0 ? "+" : "") + Number(twii.pct).toFixed(2) + "%）")
        : "—") + "</strong></div></div>";
    return {
      sorted: sorted,
      html: '<article class="card"><h3>' + esc(reportSortLabel(mode)) +
        " · " + days + " 日 · 前 " + Math.min(limit, sorted.length) + "／" + sorted.length + " 檔</h3>" +
        summary + reportTableHtml(sorted, limit, days) +
        '<p class="fine">來源：證交所 MI_INDEX、T86。區間漲跌＝迄日收盤相對區間首日收盤；買賣超／成交為區間加總（張＝千股）。</p></article>'
    };
  }

  function reportStandaloneHtml(pack, mode, only, limit) {
    const view = buildReportView(pack, mode, only, limit);
    return "<!DOCTYPE html><html lang=\"zh-Hant\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
      "<title>盤後報表 " + esc(pack.date) + " " + (pack.days || 1) + "日</title>" +
      "<style>body{font-family:\"Noto Sans TC\",\"Microsoft JhengHei\",sans-serif;background:#10151b;color:#e7eef6;margin:16px}" +
      "table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #2c3846;padding:6px 4px;text-align:left}" +
      "td.num{text-align:right}.up{color:#ff6b6b}.down{color:#3dbe7a}h1{font-size:20px}" +
      ".fine{color:#93a0b0;font-size:12px}.summary{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}" +
      ".summary div{background:#1a222c;border-radius:8px;padding:8px 10px}</style></head><body>" +
      "<h1>三生有杏 · 盤後排序報表</h1>" +
      "<p class=\"fine\">" + esc(reportSortLabel(mode)) + " · " + (pack.days || 1) + " 日 · 行情 " +
      esc(pack.startDate || pack.date) + "～" + esc(pack.date) +
      " · 法人 " + esc(pack.fundDate || "尚未公告") + "</p>" + view.html +
      "</body></html>";
  }

  async function runReport() {
    const dateVal = ($("report-date").value || "").replace(/-/g, "");
    const days = Number($("report-range").value) || 1;
    const mode = $("report-sort").value || "pctDown";
    const only = $("report-only").value || "stock";
    const limit = Math.max(20, Math.min(500, Number($("report-limit").value) || 50));
    $("report-run").disabled = true;
    $("report-html").hidden = true;
    $("report-status").textContent = days > 1
      ? "正在讀最近 " + days + " 個交易日（較久，請稍候）…"
      : "正在讀證交所收盤與法人買賣超…";
    $("report-out").innerHTML = "";
    try {
      const pack = await M.twseDailyReport({
        date: dateVal,
        days: days,
        onProgress: function (p) {
          if (!p) return;
          if (p.phase === "mi") {
            $("report-status").textContent = "讀收盤行情 " + (p.done || 0) + "／" + (p.need || days) +
              (p.date ? "（" + p.date + "）" : "");
          } else if (p.phase === "fund") {
            $("report-status").textContent = "讀法人買賣超 " + (p.done || 0) + "／" + (p.need || days);
          }
        }
      });
      lastReport = pack;
      const view = buildReportView(pack, mode, only, limit);
      $("report-out").innerHTML = view.html;
      $("report-status").textContent = "已產生 " + (pack.startDate || pack.date) + "～" + pack.date +
        "（" + pack.days + " 日）報表。";
      $("report-html").hidden = false;
    } catch (err) {
      $("report-status").textContent = err.message || "報表產生失敗";
    } finally {
      $("report-run").disabled = false;
    }
  }

  function downloadReportHtml() {
    if (!lastReport) return;
    const mode = $("report-sort").value || "pctDown";
    const only = $("report-only").value || "stock";
    const limit = Math.max(20, Math.min(500, Number($("report-limit").value) || 50));
    const blob = new Blob([reportStandaloneHtml(lastReport, mode, only, limit)], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "twse-report-" + lastReport.date + "-" + (lastReport.days || 1) + "d.html";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function onPick(btn) {
    const row = {
      secid: btn.getAttribute("data-secid"),
      code: btn.getAttribute("data-code"),
      name: twName(btn.getAttribute("data-name")),
      market: twName(btn.getAttribute("data-market"))
    };
    const key = btn.getAttribute("data-pick");
    if (key === "watch") {
      state.picks.watch = row;
      $("watch-pick").textContent = row.name + " " + row.code + " · 填好買價與股數後按加入";
      $("watch-hits").innerHTML = "";
      $("watch-q").value = row.code + " " + row.name;
      $("watch-cost").focus();
      return;
    }
    if (key === "risk") {
      if (!book.holdings.some(function (item) { return item.secid === row.secid; })) {
        book.holdings.push(Object.assign({ shares: 1, cost: "" }, row));
        scheduleSave();
      }
      renderHoldings();
      $("risk-hits").innerHTML = "";
      return;
    }
    state.picks[key] = row;
    const label = $({
      tech: "tech-pick",
      news: "news-pick",
      test: "test-pick",
      journal: "j-pick",
      predict: "predict-pick",
      advise: "advise-pick"
    }[key]);
    if (label) label.textContent = row.name + " " + row.code + " · " + row.market;
    const hits = {
      tech: "tech-hits",
      news: "news-hits",
      test: "test-hits",
      journal: "j-hits",
      predict: "predict-hits",
      advise: "advise-hits"
    }[key];
    if (hits) $(hits).innerHTML = "";
  }

  document.addEventListener("click", function (ev) {
    const t = ev.target.closest("button");
    if (!t) return;
    if (t.dataset.pick) onPick(t);
    else if (t.dataset.adviseWatch != null) {
      const item = book.watch[Number(t.dataset.adviseWatch)];
      if (!item) return;
      state.picks.advise = {
        secid: item.secid,
        code: item.code,
        name: item.name,
        market: item.market || "台股"
      };
      $("advise-pick").textContent = item.name + " " + item.code + " · 自選";
      $("advise-q").value = (item.code || "") + " " + (item.name || "");
      runAdvise();
    } else if (t.dataset.range) {
      state.range = t.dataset.range;
      state.custom = false;
      buildToggles();
      loadChart();
    }     else if (t.dataset.market) {
      state.on[t.dataset.market] = t.getAttribute("aria-pressed") !== "true";
      buildToggles();
      loadChart();
    } else if (t.dataset.chartStyle) {
      setChartStyle(t.dataset.chartStyle);
      loadChart();
    } else if (t.dataset.view) setView(t.dataset.view);
    else if (t.dataset.tool) openTool(t.dataset.tool);
    else if (t.dataset.openWatch != null) openSymbol(book.watch[Number(t.dataset.openWatch)]);
    else if (t.id === "watch-open-add") setWatchCompose(true);
    else if (t.id === "watch-compose-back") setWatchCompose(false);
    else if (t.id === "watch-add") addFromForm();
    else if (t.id === "watch-photo-btn") $("watch-photo").click();
    else if (t.id === "watch-json-btn") $("watch-json").click();
    else if (t.id === "import-ok") commitImport();
    else if (t.dataset.delWatch != null) {
      const removed = book.watch.splice(Number(t.dataset.delWatch), 1)[0];
      if (removed) book.holdings = book.holdings.filter(function (item) { return item.secid !== removed.secid; });
      scheduleSave();
      renderWatch(true);
    } else if (t.dataset.delHold != null) {
      book.holdings.splice(Number(t.dataset.delHold), 1);
      scheduleSave();
      renderHoldings();
    } else if (t.dataset.delJ) {
      book.journal = book.journal.filter(function (item) { return item.id !== t.dataset.delJ; });
      scheduleSave();
      renderJournal();
    }
  });

  $("range-from").addEventListener("change", applyCustomDates);
  $("range-to").addEventListener("change", applyCustomDates);
  $("enter").addEventListener("click", function () { showApp(); });
  $("gate-login").addEventListener("click", doLogin);
  $("login").addEventListener("click", doLogin);
  $("logout").addEventListener("click", function () {
    D.logout();
    book = normalizeBook(JSON.parse(sessionStorage.getItem("sj-book") || "null"));
    paintChrome();
    renderWatch(true);
  });
  $("focus-clear").addEventListener("click", function () {
    const backWatch = state.focusFrom === "watch";
    state.focus = null;
    state.focusFrom = null;
    renderStockDetail(null);
    paintFocus();
    if (backWatch) setView("watch");
    else loadChart();
  });
  $("idea-run").addEventListener("click", runIdeas);
  $("tech-run").addEventListener("click", runTech);
  $("advise-run").addEventListener("click", runAdvise);
  $("news-run").addEventListener("click", runNews);
  $("test-run").addEventListener("click", runTest);
  $("risk-run").addEventListener("click", runRisk);
  $("j-add").addEventListener("click", addJournal);
  $("j-run").addEventListener("click", runJournal);
  $("predict-run").addEventListener("click", runPredict);
  $("report-run").addEventListener("click", runReport);
  $("report-html").addEventListener("click", downloadReportHtml);
  $("report-sort").addEventListener("change", function () {
    if (!lastReport) return;
    const mode = $("report-sort").value || "pctDown";
    const only = $("report-only").value || "stock";
    const limit = Math.max(20, Math.min(500, Number($("report-limit").value) || 50));
    $("report-out").innerHTML = buildReportView(lastReport, mode, only, limit).html;
  });
  $("report-only").addEventListener("change", function () {
    if (!lastReport) return;
    $("report-sort").dispatchEvent(new Event("change"));
  });
  $("report-limit").addEventListener("change", function () {
    if (!lastReport) return;
    $("report-sort").dispatchEvent(new Event("change"));
  });
  $("predict-csv").addEventListener("click", downloadPredictCsv);
  $("predict-horizon").addEventListener("change", syncPredictStockBox);
  $("tool-back").addEventListener("click", function () { setView("tools"); });
  $("chart").addEventListener("pointermove", onChartPointer);
  $("chart").addEventListener("pointerleave", function () { $("hover").hidden = true; });
  function paintNotifyValChrome(idx) {
    const box = $("watch-list");
    if (!box || !book.watch[idx]) return;
    const mode = notifyModeOf(book.watch[idx]);
    const meta = NOTIFY_MODES[mode];
    const input = box.querySelector('label.watch-alert-val input[data-watch-notify-val="' + idx + '"]');
    if (!input) return;
    const wrap = input.parentElement;
    let prefix = wrap.querySelector("[data-alert-prefix]");
    let suffix = wrap.querySelector("[data-alert-suffix]");
    if (!prefix) {
      prefix = document.createElement("span");
      prefix.setAttribute("data-alert-prefix", "1");
      wrap.insertBefore(prefix, input);
    }
    if (!suffix) {
      suffix = document.createElement("span");
      suffix.setAttribute("data-alert-suffix", "1");
      wrap.appendChild(suffix);
    }
    prefix.textContent = meta.prefix;
    suffix.textContent = meta.suffix || "";
    input.placeholder = mode === "pct" ? "3" : "數值";
  }

  $("watch-list").addEventListener("input", function (ev) {
    const shares = ev.target.getAttribute("data-watch-shares");
    const cost = ev.target.getAttribute("data-watch-cost");
    const nval = ev.target.getAttribute("data-watch-notify-val");
    const idx = shares != null ? Number(shares)
      : cost != null ? Number(cost)
        : nval != null ? Number(nval) : -1;
    if (idx < 0 || !book.watch[idx]) return;
    if (shares != null) book.watch[idx].shares = ev.target.value;
    if (cost != null) book.watch[idx].cost = ev.target.value;
    if (nval != null) {
      const n = Number(ev.target.value);
      book.watch[idx].notifyVal = n > 0 && isFinite(n) ? n : null;
      if (notifyModeOf(book.watch[idx]) === "pct") {
        book.watch[idx].notifyPct = book.watch[idx].notifyVal || 3;
      }
      normalizeNotify(book.watch[idx]);
    }
    syncHolding(book.watch[idx]);
    if (shares != null || cost != null) {
      paintWatchPnl(idx);
      paintWatchTotal();
    }
    scheduleSave();
  });
  $("watch-list").addEventListener("change", async function (ev) {
    const modeEl = ev.target.getAttribute("data-watch-notify-mode");
    if (modeEl != null) {
      const idx = Number(modeEl);
      if (idx < 0 || !book.watch[idx]) return;
      const next = ev.target.value;
      book.watch[idx].notifyMode = NOTIFY_MODES[next] ? next : "pct";
      if (book.watch[idx].notifyMode === "pct" && !(Number(book.watch[idx].notifyVal) > 0)) {
        book.watch[idx].notifyVal = 3;
      }
      normalizeNotify(book.watch[idx]);
      paintNotifyValChrome(idx);
      const input = $("watch-list").querySelector('[data-watch-notify-val="' + idx + '"]');
      if (input && book.watch[idx].notifyVal != null) input.value = String(book.watch[idx].notifyVal);
      scheduleSave();
      if (book.watch[idx].notify) pollWatchAlerts();
      return;
    }
    const notify = ev.target.getAttribute("data-watch-notify");
    if (notify == null) return;
    const idx = Number(notify);
    if (idx < 0 || !book.watch[idx]) return;
    if (ev.target.checked) {
      const ok = await ensureNotifyPermission();
      if (!ok) {
        ev.target.checked = false;
        book.watch[idx].notify = false;
        scheduleSave();
        return;
      }
      book.watch[idx].notify = true;
      normalizeNotify(book.watch[idx]);
      scheduleSave();
      pollWatchAlerts();
      return;
    }
    book.watch[idx].notify = false;
    scheduleSave();
  });
  $("import-box").addEventListener("input", function (ev) {
    const shares = ev.target.getAttribute("data-import-shares");
    const cost = ev.target.getAttribute("data-import-cost");
    const idx = shares != null ? Number(shares) : cost != null ? Number(cost) : -1;
    if (idx < 0 || !importRows[idx]) return;
    if (shares != null) importRows[idx].shares = ev.target.value;
    if (cost != null) importRows[idx].cost = ev.target.value;
  });
  $("watch-photo").addEventListener("change", function () {
    const file = $("watch-photo").files && $("watch-photo").files[0];
    $("watch-photo").value = "";
    if (file) readInventoryPhoto(file);
  });
  $("watch-json").addEventListener("change", function () {
    const file = $("watch-json").files && $("watch-json").files[0];
    $("watch-json").value = "";
    if (file) readFubonHoldingsJson(file);
  });
  $("risk-list").addEventListener("change", function (ev) {
    const shares = ev.target.getAttribute("data-shares");
    const cost = ev.target.getAttribute("data-cost");
    if (shares != null) book.holdings[Number(shares)].shares = ev.target.value;
    if (cost != null) book.holdings[Number(cost)].cost = ev.target.value;
    scheduleSave();
  });
  window.addEventListener("resize", draw);

  bindSearch("watch-q", "watch-hits", "watch", "台股");
  bindSearch("tech-q", "tech-hits", "tech", "台股");
  bindSearch("news-q", "news-hits", "news", "台股");
  bindSearch("test-q", "test-hits", "test", "台股");
  bindSearch("risk-q", "risk-hits", "risk", "台股");
  bindSearch("j-q", "j-hits", "journal", "台股");
  bindSearch("predict-q", "predict-hits", "predict", "台股");
  bindSearch("advise-q", "advise-hits", "advise", "台股");

  const today = new Date();
  $("j-date").value = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  showVer();
  buildToggles();
  D.ready().catch(function () { /* 登入時再提示 */ });
  if (D.account()) {
    $("gate").hidden = true;
    $("app").hidden = false;
  }
  loadBook();
  paintChrome(true);
  paintTwii(true);
  startLiveClock();
})();
