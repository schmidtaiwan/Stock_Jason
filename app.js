(function () {
  const PAGE_BUILD = 1;
  const PAGE_DATE = "2026-11-09";
  const $ = function (id) { return document.getElementById(id); };
  const M = window.SJMarket;
  const D = window.SJDrive;

  const state = {
    range: "20d",
    on: { dji: true, spx: true, ndx: true, tw: false, jp: false, kr: false },
    focus: null,
    view: "chart",
    tool: "",
    picks: {},
    plot: null,
    chartGen: 0
  };

  let book = emptyBook();
  let saveTimer = 0;

  function emptyBook() {
    return { watch: [], holdings: [], journal: [], capital: 1000000, riskPct: 1, profile: "穩健" };
  }

  function normalizeBook(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    return {
      watch: Array.isArray(src.watch) ? src.watch : [],
      holdings: Array.isArray(src.holdings) ? src.holdings : [],
      journal: Array.isArray(src.journal) ? src.journal : [],
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
    paintChrome();
    if (state.view === "chart") loadChart();
  }

  function paintChrome() {
    const account = D.account();
    $("who").textContent = account
      ? account.email + " · 自選存在雲端 " + D.bookName(account.email)
      : "尚未登入。自選與日誌先留在這次瀏覽，登入後改讀該 Gmail 的雲端檔。";
    $("login").hidden = !!account;
    $("logout").hidden = !account;
    $("watch-note").textContent = account
      ? "現在讀的是 " + account.email + " 的自選股。"
      : "登入後才會依 Gmail 讀寫 jason660803 雲端硬碟裡的自選股。";
    $("prefer").textContent = (window.GOOGLE_CONFIG.editors || []).join(" 或 ");
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
    if (name === "watch") renderWatch();
  }

  function openTool(id) {
    const titles = {
      ideas: "交易點子產生器",
      tech: "自動化技術分析師",
      news: "新聞轉交易策略",
      test: "交易策略回測分析師",
      risk: "投資組合風險管理",
      journal: "交易日誌分析師"
    };
    state.tool = id;
    $("tool-title").textContent = titles[id] || "";
    ["ideas", "tech", "news", "test", "risk", "journal"].forEach(function (key) {
      $("panel-" + key).hidden = key !== id;
    });
    setView("tool");
    if (id === "risk") renderHoldings();
    if (id === "journal") renderJournal();
    syncMoney();
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
    $("gate-msg").textContent = "正在登入…";
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
      showApp();
      await loadBook();
      paintChrome();
    } catch (err) {
      $("gate-msg").textContent = D.friendly(err);
    }
  }

  function buildToggles() {
    $("ranges").innerHTML = Object.keys(M.RANGES).map(function (id) {
      const spec = M.RANGES[id];
      return '<button type="button" class="chip" data-range="' + id + '" aria-pressed="' + (state.range === id) + '">' + spec.label + "</button>";
    }).join("");
    $("markets").innerHTML = M.MARKETS.map(function (m) {
      return '<button type="button" class="chip" data-market="' + m.id + '" aria-pressed="' + !!state.on[m.id] + '">' + m.name + "</button>";
    }).join("");
  }

  function paintFocus() {
    const on = !!state.focus;
    $("focus-bar").hidden = !on;
    $("market-box").hidden = on;
    if (on) $("focus-name").textContent = state.focus.name + " " + state.focus.code + " · " + (state.focus.market || "");
  }

  async function loadChart() {
    const gen = ++state.chartGen;
    $("chart-status").textContent = "正在讀行情…";
    paintFocus();
    try {
      let items = [];
      const align = (M.RANGES[state.range] || {}).align || "date";
      if (state.focus) {
        const series = await M.bars(state.focus.secid, state.range);
        items = [{ name: state.focus.name, color: "#e0a100", bars: series }];
      } else {
        const picked = M.MARKETS.filter(function (m) { return state.on[m.id]; });
        if (!picked.length) {
          $("chart-status").textContent = "至少選擇一個市場。";
          return;
        }
        const got = await Promise.all(picked.map(async function (m) {
          try { return { name: m.name, color: m.color, bars: await M.bars(m.secid, state.range) }; }
          catch (err) { return { name: m.name, error: err.message || "失敗" }; }
        }));
        if (gen !== state.chartGen) return;
        items = got.filter(function (row) { return row.bars && row.bars.length; });
        const bad = got.filter(function (row) { return !row.bars; }).map(function (row) { return row.name; });
        if (!items.length) throw new Error("行情暫時讀不到");
        $("chart-status").textContent = bad.length ? bad.join("、") + " 這次沒讀到。" : "";
      }
      if (gen !== state.chartGen) return;
      const mode = items.length > 1 ? "pct" : "price";
      state.plot = buildPlot(items, mode, align);
      draw();
      renderLegend(items, mode);
      if (state.focus) $("chart-status").textContent = "";
    } catch (err) {
      if (gen === state.chartGen) $("chart-status").textContent = err.message || "讀取失敗";
    }
  }

  function buildPlot(items, mode, align) {
    const series = items.map(function (item) {
      const first = item.bars[0].c;
      const last = item.bars[item.bars.length - 1].c;
      return {
        name: item.name,
        color: item.color,
        bars: item.bars,
        change: first ? last / first - 1 : 0,
        last: last,
        map: new Map(item.bars.map(function (b) {
          const y = mode === "pct" ? (b.c / first - 1) * 100 : b.c;
          return [b.t.slice(0, 10), y];
        }))
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
        s.values = days.map(function (d) {
          if (d > end) return null;
          if (s.map.has(d)) carry = s.map.get(d);
          return carry;
        });
      });
      return { axis: days, series: series, mode: mode };
    }
    const max = Math.max.apply(null, series.map(function (s) { return s.bars.length; }));
    const longest = series.slice().sort(function (a, b) { return b.bars.length - a.bars.length; })[0];
    series.forEach(function (s) {
      const pad = max - s.bars.length;
      const values = new Array(max).fill(null);
      s.bars.forEach(function (b, i) {
        const y = mode === "pct" ? (b.c / s.bars[0].c - 1) * 100 : b.c;
        values[pad + i] = y;
      });
      s.values = values;
    });
    const axis = new Array(max).fill("");
    longest.bars.forEach(function (b, i) {
      axis[(max - longest.bars.length) + i] = b.t.slice(0, 16);
    });
    return { axis: axis, series: series, mode: mode };
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
    const right = 12;
    const top = 16;
    const bottom = 28;
    const iw = width - left - right;
    const ih = height - top - bottom;
    let min = Infinity;
    let max = -Infinity;
    plot.series.forEach(function (s) {
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
    ctx.strokeStyle = "#2c3846";
    ctx.fillStyle = "#93a0b0";
    ctx.font = "12px sans-serif";
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
    plot.series.forEach(function (s) {
      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      let open = false;
      s.values.forEach(function (v, i) {
        if (v == null) { open = false; return; }
        const x = xOf(i);
        const y = yOf(v);
        if (!open) { ctx.moveTo(x, y); open = true; }
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
    ctx.fillStyle = "#93a0b0";
    const marks = [0, Math.floor((plot.axis.length - 1) / 2), plot.axis.length - 1];
    marks.forEach(function (i) {
      const text = String(plot.axis[i] || "").slice(5, 16);
      ctx.fillText(text, xOf(i) - 18, height - 8);
    });
    canvas._layout = { left: left, width: iw, axis: plot.axis, series: plot.series, mode: plot.mode };
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
      $("legend").insertAdjacentHTML("beforeend", '<p class="fine">數字是區間漲跌幅，起點對齊各市場自己的第一根。</p>');
    }
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
      const v = s.values[i];
      if (v == null) return "";
      const shown = layout.mode === "pct" ? (v >= 0 ? "+" : "") + v.toFixed(2) + "%" : fmt(v);
      return s.name + " " + shown;
    }).filter(Boolean);
    if (!parts.length) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.textContent = (layout.axis[i] || "") + "  " + parts.join(" · ");
  }

  function renderWatch() {
    const box = $("watch-list");
    if (!book.watch.length) {
      box.innerHTML = '<p class="note">自選股還是空的。搜尋後點名稱加入。</p>';
      return;
    }
    box.innerHTML = book.watch.map(function (item, idx) {
      return '<div class="item"><button type="button" class="hit" data-open-watch="' + idx + '"><strong>' +
        esc(item.name) + "</strong> " + esc(item.code) + "<small>" + esc(item.market || "") + "</small></button>" +
        '<button type="button" class="danger" data-del-watch="' + idx + '">移除</button></div>';
    }).join("");
    const ids = book.watch.map(function (item) { return item.secid; });
    M.quoteMap(ids).then(function (map) {
      box.querySelectorAll("[data-open-watch]").forEach(function (btn) {
        const item = book.watch[Number(btn.getAttribute("data-open-watch"))];
        const q = map[item.secid];
        if (!q || q.price == null) return;
        const span = document.createElement("small");
        span.className = pctClass((q.pct || 0) / 100);
        span.textContent = fmt(q.price) + "  " + (q.pct > 0 ? "+" : "") + Number(q.pct).toFixed(2) + "%";
        btn.appendChild(span);
      });
    }).catch(function () {});
  }

  function bindSearch(inputId, hitId, key) {
    let timer = 0;
    $(inputId).addEventListener("input", function () {
      clearTimeout(timer);
      const q = $(inputId).value.trim();
      timer = setTimeout(async function () {
        if (q.length < 1) { $(hitId).innerHTML = ""; return; }
        try {
          const rows = await M.search(q);
          $(hitId).innerHTML = rows.map(function (row) {
            return '<button type="button" class="hit" data-pick="' + key + '" data-secid="' + esc(row.secid) +
              '" data-code="' + esc(row.code) + '" data-name="' + esc(row.name) + '" data-market="' + esc(row.market) +
              '"><strong>' + esc(row.name) + "</strong> " + esc(row.code) + "<small>" + esc(row.market) + "</small></button>";
          }).join("") || '<p class="note">找不到美股、台股、日股或韓股。</p>';
        } catch (err) {
          $(hitId).innerHTML = '<p class="note">' + esc(err.message || "搜尋失敗") + "</p>";
        }
      }, 250);
    });
  }

  function addWatch(row) {
    if (book.watch.some(function (item) { return item.secid === row.secid; })) return;
    book.watch.push(row);
    scheduleSave();
    renderWatch();
  }

  function openSymbol(row) {
    state.focus = row;
    setView("chart");
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

  async function runIdeas() {
    const money = moneyFrom("idea");
    $("idea-run").disabled = true;
    $("idea-status").textContent = "開始掃描…";
    $("idea-out").innerHTML = "";
    try {
      const report = await M.scan({
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

  function onPick(btn) {
    const row = {
      secid: btn.getAttribute("data-secid"),
      code: btn.getAttribute("data-code"),
      name: btn.getAttribute("data-name"),
      market: btn.getAttribute("data-market")
    };
    const key = btn.getAttribute("data-pick");
    if (key === "watch") {
      addWatch(row);
      $("watch-hits").innerHTML = "";
      $("watch-q").value = "";
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
    const label = $(key === "tech" ? "tech-pick" : key === "news" ? "news-pick" : key === "test" ? "test-pick" : "j-pick");
    if (label) label.textContent = row.name + " " + row.code + " · " + row.market;
    const hits = { tech: "tech-hits", news: "news-hits", test: "test-hits", journal: "j-hits" }[key];
    if (hits) $(hits).innerHTML = "";
  }

  document.addEventListener("click", function (ev) {
    const t = ev.target.closest("button");
    if (!t) return;
    if (t.dataset.pick) onPick(t);
    else if (t.dataset.range) {
      state.range = t.dataset.range;
      buildToggles();
      loadChart();
    } else if (t.dataset.market) {
      state.on[t.dataset.market] = t.getAttribute("aria-pressed") !== "true";
      buildToggles();
      loadChart();
    } else if (t.dataset.view) setView(t.dataset.view);
    else if (t.dataset.tool) openTool(t.dataset.tool);
    else if (t.dataset.openWatch != null) openSymbol(book.watch[Number(t.dataset.openWatch)]);
    else if (t.dataset.delWatch != null) {
      book.watch.splice(Number(t.dataset.delWatch), 1);
      scheduleSave();
      renderWatch();
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

  $("ranges").addEventListener("click", function () {});
  $("enter").addEventListener("click", function () { showApp(); });
  $("gate-login").addEventListener("click", doLogin);
  $("login").addEventListener("click", doLogin);
  $("logout").addEventListener("click", function () {
    D.logout();
    book = normalizeBook(JSON.parse(sessionStorage.getItem("sj-book") || "null"));
    paintChrome();
    renderWatch();
  });
  $("focus-clear").addEventListener("click", function () {
    state.focus = null;
    loadChart();
  });
  $("idea-run").addEventListener("click", runIdeas);
  $("tech-run").addEventListener("click", runTech);
  $("news-run").addEventListener("click", runNews);
  $("test-run").addEventListener("click", runTest);
  $("risk-run").addEventListener("click", runRisk);
  $("j-add").addEventListener("click", addJournal);
  $("j-run").addEventListener("click", runJournal);
  $("tool-back").addEventListener("click", function () { setView("tools"); });
  $("chart").addEventListener("pointermove", onChartPointer);
  $("chart").addEventListener("pointerleave", function () { $("hover").hidden = true; });
  $("risk-list").addEventListener("change", function (ev) {
    const shares = ev.target.getAttribute("data-shares");
    const cost = ev.target.getAttribute("data-cost");
    if (shares != null) book.holdings[Number(shares)].shares = ev.target.value;
    if (cost != null) book.holdings[Number(cost)].cost = ev.target.value;
    scheduleSave();
  });
  window.addEventListener("resize", draw);

  bindSearch("watch-q", "watch-hits", "watch");
  bindSearch("tech-q", "tech-hits", "tech");
  bindSearch("news-q", "news-hits", "news");
  bindSearch("test-q", "test-hits", "test");
  bindSearch("risk-q", "risk-hits", "risk");
  bindSearch("j-q", "j-hits", "journal");

  const today = new Date();
  $("j-date").value = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  showVer();
  buildToggles();
  loadBook();
  paintChrome();
})();
