/* 籌碼分析／選股／日報／美股看板。分點需 FinMind 付費 token；無 token 時用法人＋融資近似。 */
(function (global) {
  const TOKEN_KEY = "sj-finmind-token";
  const US_BOARD = [
    { symbol: "^SOX", name: "費半", key: "sox", core: true },
    { symbol: "TSM", name: "台積電ADR", key: "tsm", core: true },
    { symbol: "NVDA", name: "輝達", key: "nvda", core: true },
    { symbol: "^VIX", name: "VIX恐慌", key: "vix", core: true },
    { symbol: "^TNX", name: "美債10年", key: "tnx", core: true },
    { symbol: "DX-Y.NYB", name: "美元指數", key: "dxy", core: true },
    { symbol: "^DJI", name: "道瓊", key: "dji" },
    { symbol: "^GSPC", name: "標普", key: "spx" },
    { symbol: "^IXIC", name: "那斯達克", key: "ixic" },
    { symbol: "AAPL", name: "蘋果", key: "aapl" },
    { symbol: "MSFT", name: "微軟", key: "msft" },
    { symbol: "AMD", name: "超微", key: "amd" },
    { symbol: "META", name: "Meta", key: "meta" },
    { symbol: "GOOGL", name: "Google", key: "googl" },
    { symbol: "AMZN", name: "亞馬遜", key: "amzn" },
    { symbol: "QQQ", name: "QQQ", key: "qqq" },
    { symbol: "SPY", name: "SPY", key: "spy" }
  ];

  function num(v) {
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/,/g, ""));
    return isFinite(n) ? n : null;
  }

  function getToken() {
    try {
      const local = localStorage.getItem(TOKEN_KEY);
      if (local) return local.trim();
    } catch (err) { /* ignore */ }
    const cfg = global.GOOGLE_CONFIG || {};
    return String(cfg.finmindToken || "").trim();
  }

  function setToken(token) {
    const t = String(token || "").trim();
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (err) { /* ignore */ }
    return t;
  }

  function isoDaysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  async function finMind(dataset, stockId, start, end) {
    let url = "https://api.finmindtrade.com/api/v4/data?dataset=" + encodeURIComponent(dataset) +
      "&start_date=" + encodeURIComponent(start);
    if (stockId) url += "&data_id=" + encodeURIComponent(stockId);
    if (end) url += "&end_date=" + encodeURIComponent(end);
    const tok = getToken();
    if (tok) url += "&token=" + encodeURIComponent(tok);
    const res = await fetch(url);
    if (!res.ok) throw new Error(dataset + " 讀取失敗");
    const json = await res.json();
    if (json && json.status === 400) {
      const err = new Error(json.msg || "FinMind 權限不足");
      err.code = "FINMIND_LEVEL";
      throw err;
    }
    return Array.isArray(json.data) ? json.data : [];
  }

  function chipTone(net, vol) {
    const r = vol > 0 ? net / vol : 0;
    if (r >= 0.08) return { label: "大買", cls: "up", rank: 2 };
    if (r >= 0.02) return { label: "小買", cls: "up", rank: 1 };
    if (r > -0.02) return { label: "中立", cls: "", rank: 0 };
    if (r > -0.08) return { label: "小賣", cls: "down", rank: -1 };
    return { label: "大賣", cls: "down", rank: -2 };
  }

  function sessionLamp(pct, volRatio) {
    const p = Number(pct) || 0;
    const v = Number(volRatio) || 1;
    if (p >= 2 && v >= 1.2) return { label: "大買", cls: "up" };
    if (p >= 0.6) return { label: "小買", cls: "up" };
    if (p <= -2 && v >= 1.2) return { label: "大賣", cls: "down" };
    if (p <= -0.6) return { label: "小賣", cls: "down" };
    return { label: "中立", cls: "" };
  }

  function aggregateInst(rows) {
    const byDay = {};
    (rows || []).forEach(function (row) {
      if (!byDay[row.date]) byDay[row.date] = { date: row.date, foreign: 0, trust: 0, dealer: 0 };
      const net = (num(row.buy) || 0) - (num(row.sell) || 0);
      if (row.name === "Foreign_Investor" || row.name === "Foreign_Dealer_Self") byDay[row.date].foreign += net;
      else if (row.name === "Investment_Trust") byDay[row.date].trust += net;
      else if (row.name === "Dealer" || row.name === "Dealer_self" || row.name === "Dealer_Hedging") byDay[row.date].dealer += net;
    });
    return Object.keys(byDay).sort().map(function (d) {
      const row = byDay[d];
      row.total = row.foreign + row.trust + row.dealer;
      return row;
    });
  }

  function sumField(days, key) {
    return days.reduce(function (a, r) { return a + (Number(r[key]) || 0); }, 0);
  }

  function flowWindows(chipDays) {
    const out = {};
    [1, 5, 10, 20].forEach(function (n) {
      const slice = chipDays.slice(-n);
      out[n] = {
        foreign: sumField(slice, "foreign"),
        trust: sumField(slice, "trust"),
        dealer: sumField(slice, "dealer"),
        total: sumField(slice, "total")
      };
    });
    return out;
  }

  function mainCost(chipDays, priceByDate, days) {
    const slice = chipDays.slice(-days);
    let w = 0;
    let sum = 0;
    slice.forEach(function (row) {
      const buy = Math.max(0, Number(row.total) || 0);
      const px = priceByDate[row.date];
      const c = px && (num(px.close) || num(px.c));
      if (buy > 0 && c > 0) {
        w += buy;
        sum += buy * c;
      }
    });
    return w > 0 ? sum / w : null;
  }

  function concProxy(chipDays, priceByDate, days) {
    const slice = chipDays.slice(-days);
    let absNet = 0;
    let vol = 0;
    slice.forEach(function (row) {
      absNet += Math.abs(Number(row.total) || 0);
      const px = priceByDate[row.date];
      vol += num(px && px.Trading_Volume) || 0;
    });
    return vol > 0 ? absNet / vol : null;
  }

  function streak(chipDays, key, positive) {
    let n = 0;
    for (let i = chipDays.length - 1; i >= 0; i--) {
      const v = Number(chipDays[i][key]) || 0;
      if (positive ? v > 0 : v < 0) n++;
      else break;
    }
    return n;
  }

  function summarizeBrokers(rows) {
    const map = {};
    (rows || []).forEach(function (row) {
      const name = String(row.securities_trader || row.name || "").trim();
      if (!name) return;
      if (!map[name]) map[name] = { name: name, buy: 0, sell: 0, buyAmt: 0, sellAmt: 0 };
      const buy = num(row.buy) || 0;
      const sell = num(row.sell) || 0;
      const bp = num(row.buy_price) || 0;
      const sp = num(row.sell_price) || 0;
      map[name].buy += buy;
      map[name].sell += sell;
      map[name].buyAmt += buy * bp;
      map[name].sellAmt += sell * sp;
    });
    const list = Object.keys(map).map(function (k) {
      const r = map[k];
      r.net = r.buy - r.sell;
      r.buyAvg = r.buy > 0 ? r.buyAmt / r.buy : null;
      r.sellAvg = r.sell > 0 ? r.sellAmt / r.sell : null;
      return r;
    });
    const buyers = list.slice().sort(function (a, b) { return b.net - a.net; });
    const sellers = list.slice().sort(function (a, b) { return a.net - b.net; });
    const topBuy = buyers.filter(function (r) { return r.net > 0; }).slice(0, 15);
    const topSell = sellers.filter(function (r) { return r.net < 0; }).slice(0, 15);
    const buySum = topBuy.reduce(function (a, r) { return a + r.net; }, 0);
    const sellSum = topSell.reduce(function (a, r) { return a + Math.abs(r.net); }, 0);
    const buyNames = list.filter(function (r) { return r.net > 0; }).length;
    const sellNames = list.filter(function (r) { return r.net < 0; }).length;
    const dayTrade = list.filter(function (r) {
      return r.buy > 0 && r.sell > 0 && Math.min(r.buy, r.sell) / Math.max(r.buy, r.sell) > 0.35;
    }).sort(function (a, b) {
      return Math.min(b.buy, b.sell) - Math.min(a.buy, a.sell);
    }).slice(0, 8);
    const hoard = topBuy.filter(function (r) {
      return r.sell === 0 || r.buy > r.sell * 3;
    }).slice(0, 8);
    const winners = topBuy.filter(function (r) {
      return r.buyAvg != null && r.sellAvg != null && r.sellAvg > r.buyAvg;
    }).concat(topBuy.filter(function (r) {
      return r.sell === 0 && r.buy > 0;
    })).slice(0, 8);
    return {
      topBuy: topBuy,
      topSell: topSell,
      buySum: buySum,
      sellSum: sellSum,
      brokerDiff: buyNames - sellNames,
      concentration: (buySum + sellSum) > 0 ? (buySum - sellSum) / (buySum + sellSum) : null,
      dayTrade: dayTrade,
      hoard: hoard,
      winners: winners,
      all: list
    };
  }

  async function brokerPack(stockId, start, end) {
    if (!getToken()) {
      return { ok: false, reason: "尚未設定 FinMind token（分點屬付費資料）。" };
    }
    try {
      const rows = await finMind("TaiwanStockTradingDailyReport", stockId, start, end);
      if (!rows.length) return { ok: false, reason: "這段日期沒有分點資料（或權限不足）。" };
      const byDate = {};
      rows.forEach(function (row) {
        const d = row.date;
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(row);
      });
      const dates = Object.keys(byDate).sort();
      const latest = dates[dates.length - 1];
      const windows = {};
      [1, 5, 10, 20].forEach(function (n) {
        const use = dates.slice(-n);
        const merged = [];
        use.forEach(function (d) { merged.push.apply(merged, byDate[d]); });
        windows[n] = summarizeBrokers(merged);
      });
      return { ok: true, date: latest, windows: windows, latest: windows[1] };
    } catch (err) {
      return { ok: false, reason: err.message || "分點讀取失敗" };
    }
  }

  async function analyzeChip(stockId) {
    const id = String(stockId || "").trim().toUpperCase();
    if (!id) throw new Error("請輸入台股代號");
    const start = isoDaysAgo(90);
    const got = await Promise.all([
      finMind("TaiwanStockInstitutionalInvestorsBuySell", id, start).catch(function () { return []; }),
      finMind("TaiwanStockPrice", id, start).catch(function () { return []; }),
      finMind("TaiwanStockMarginPurchaseShortSale", id, start).catch(function () { return []; }),
      finMind("TaiwanStockShareholding", id, isoDaysAgo(400)).catch(function () { return []; }),
      brokerPack(id, isoDaysAgo(25), isoDaysAgo(0))
    ]);
    const chipDays = aggregateInst(got[0]);
    const prices = got[1] || [];
    const margins = got[2] || [];
    const shares = got[3] || [];
    const broker = got[4] || { ok: false };
    const priceByDate = {};
    prices.forEach(function (row) { priceByDate[row.date] = row; });
    const flows = flowWindows(chipDays);
    const latest = chipDays.length ? chipDays[chipDays.length - 1] : null;
    const lastPx = prices.length ? prices[prices.length - 1] : null;
    const vol = lastPx ? (num(lastPx.Trading_Volume) || 0) : 0;
    const tone = latest ? chipTone(latest.total, vol) : { label: "—", cls: "" };
    const cost20 = mainCost(chipDays, priceByDate, 20);
    const cost60 = mainCost(chipDays, priceByDate, 60);
    const lastMargin = margins.length ? margins[margins.length - 1] : null;
    const prevMargin = margins.length > 5 ? margins[margins.length - 6] : null;
    const marginDelta = lastMargin && prevMargin
      ? (num(lastMargin.MarginPurchaseTodayBalance) || 0) - (num(prevMargin.MarginPurchaseTodayBalance) || 0)
      : null;
    const foreignPct = shares.length ? num(shares[shares.length - 1].ForeignInvestmentSharesRatio) : null;

    const lights = [];
    function pushLight(name, ok, detail) {
      lights.push({ name: name, ok: ok, detail: detail || "" });
    }
    pushLight("法人近5日", flows[5].total > 0, "合計 " + Math.round(flows[5].total / 1000) + " 張");
    pushLight("外資連買", streak(chipDays, "foreign", true) >= 2, "連買 " + streak(chipDays, "foreign", true) + " 日");
    pushLight("投信近5日", flows[5].trust > 0, "合計 " + Math.round(flows[5].trust / 1000) + " 張");
    pushLight("融資未暴增", !(marginDelta > 0 && flows[5].total < 0),
      marginDelta == null ? "融資資料不足" : ("五日變化 " + marginDelta + " 張"));
    pushLight("外資持股", foreignPct == null ? null : foreignPct >= 5, foreignPct == null ? "—" : (foreignPct.toFixed(1) + "%"));
    if (broker.ok && broker.latest) {
      pushLight("買賣家數差", broker.latest.brokerDiff < 0, "家數差 " + broker.latest.brokerDiff);
      pushLight("籌碼集中", broker.latest.concentration != null && broker.latest.concentration > 0.15,
        broker.latest.concentration == null ? "—" : ("集中度 " + (broker.latest.concentration * 100).toFixed(1) + "%"));
    }

    const score = lights.reduce(function (a, L) {
      if (L.ok === true) return a + 1;
      if (L.ok === false) return a - 1;
      return a;
    }, 0);

    return {
      ok: true,
      stockId: id,
      date: latest ? latest.date : "",
      tone: tone,
      flows: flows,
      conc: {
        d1: concProxy(chipDays, priceByDate, 1),
        d5: concProxy(chipDays, priceByDate, 5),
        d10: concProxy(chipDays, priceByDate, 10),
        d20: concProxy(chipDays, priceByDate, 20)
      },
      cost20: cost20,
      cost60: cost60,
      marginDelta: marginDelta,
      foreignPct: foreignPct,
      broker: broker,
      lights: lights,
      score: score,
      bias: score >= 2 ? "偏多" : score <= -2 ? "偏空" : "中性",
      note: broker.ok
        ? "分點來自 FinMind TaiwanStockTradingDailyReport。"
        : "免費版無法讀券商分點；主力成本／集中度改以三大法人＋成交量近似。" +
          (broker.reason ? "（" + broker.reason + "）" : "")
    };
  }

  function normT86Row(row) {
    return {
      code: String(row.code || "").trim(),
      name: String(row.name || "").trim(),
      foreign: num(row.foreignNet) || 0,
      trust: num(row.trustNet) || 0,
      dealer: num(row.dealerNet) || 0,
      total: num(row.instNet) != null ? num(row.instNet) : ((num(row.foreignNet) || 0) + (num(row.trustNet) || 0) + (num(row.dealerNet) || 0))
    };
  }

  async function latestT86(maxBack) {
    const M = global.SJMarket;
    if (M && typeof M.latestTwseT86 === "function") {
      const pack = await M.latestTwseT86(maxBack || 14);
      if (!pack || !pack.ok) return { ok: false, date: "", rows: [] };
      return {
        ok: true,
        date: pack.date,
        rows: (pack.rows || []).map(normT86Row).filter(function (r) { return /^\d{4}/.test(r.code); })
      };
    }
    return { ok: false, date: "", rows: [] };
  }

  async function t86History(days) {
    const M = global.SJMarket;
    const n = Math.max(1, Math.min(20, Number(days) || 5));
    if (!M || typeof M.twseT86Days !== "function") {
      const one = await latestT86(14);
      return one.ok ? [one] : [];
    }
    return M.twseT86Days(n);
  }

  async function chipDaily() {
    const pack = await latestT86(14);
    if (!pack.ok) throw new Error("證交所 T86 法人買賣超讀不到（約 17:00 後才齊）。");
    const buy = pack.rows.slice().sort(function (a, b) { return b.total - a.total; }).slice(0, 30);
    const sell = pack.rows.slice().sort(function (a, b) { return a.total - b.total; }).slice(0, 30);
    const foreignBuy = pack.rows.slice().sort(function (a, b) { return b.foreign - a.foreign; }).slice(0, 20);
    const trustBuy = pack.rows.slice().sort(function (a, b) { return b.trust - a.trust; }).slice(0, 20);
    return {
      ok: true,
      date: pack.date,
      buy: buy,
      sell: sell,
      foreignBuy: foreignBuy,
      trustBuy: trustBuy,
      note: "依證交所 T86 三大法人合計排序。真正券商分點異常需 FinMind 付費資料。"
    };
  }

  async function screenChips(strategy, days) {
    const packsRaw = await t86History(days || 5);
    const packs = (packsRaw || []).map(function (pack) {
      return {
        ok: !!pack.ok,
        date: pack.date,
        rows: (pack.rows || []).map(normT86Row).filter(function (r) { return /^\d{4}/.test(r.code); })
      };
    }).filter(function (p) { return p.ok && p.rows.length; });
    if (!packs.length) throw new Error("法人買賣超讀不到");
    const byCode = {};
    packs.forEach(function (pack, di) {
      pack.rows.forEach(function (row) {
        if (!byCode[row.code]) {
          byCode[row.code] = { code: row.code, name: row.name, days: [] };
        }
        byCode[row.code].name = row.name || byCode[row.code].name;
        byCode[row.code].days[di] = row;
      });
    });
    const list = Object.keys(byCode).map(function (code) {
      const item = byCode[code];
      const daysArr = [];
      for (let i = 0; i < packs.length; i++) daysArr.push(item.days[i] || null);
      item.series = daysArr;
      const last = daysArr[daysArr.length - 1];
      item.last = last;
      let foreignStreak = 0;
      for (let i = daysArr.length - 1; i >= 0; i--) {
        if (daysArr[i] && daysArr[i].foreign > 0) foreignStreak++;
        else break;
      }
      item.foreignStreak = foreignStreak;
      const prev = daysArr.length > 1 ? daysArr[daysArr.length - 2] : null;
      item.trustFirst = !!(last && last.trust > 0 && (!prev || prev.trust <= 0));
      item.mainForce = last ? last.total : 0;
      item.foreignSum = daysArr.reduce(function (a, r) { return a + (r ? r.foreign : 0); }, 0);
      item.trustSum = daysArr.reduce(function (a, r) { return a + (r ? r.trust : 0); }, 0);
      item.totalSum = daysArr.reduce(function (a, r) { return a + (r ? r.total : 0); }, 0);
      return item;
    });

    let filtered = list;
    const sid = String(strategy || "foreignBuy");
    if (sid === "foreignBuy") filtered = list.filter(function (x) { return x.foreignStreak >= 3; })
      .sort(function (a, b) { return b.foreignStreak - a.foreignStreak || b.foreignSum - a.foreignSum; });
    else if (sid === "trustFirst") filtered = list.filter(function (x) { return x.trustFirst; })
      .sort(function (a, b) { return b.last.trust - a.last.trust; });
    else if (sid === "mainForce") filtered = list.filter(function (x) { return x.mainForce > 0; })
      .sort(function (a, b) { return b.mainForce - a.mainForce; });
    else if (sid === "foreignTrust") filtered = list.filter(function (x) {
      return x.foreignSum > 0 && x.trustSum > 0;
    }).sort(function (a, b) { return (b.foreignSum + b.trustSum) - (a.foreignSum + a.trustSum); });
    else filtered = list.filter(function (x) { return x.totalSum > 0; })
      .sort(function (a, b) { return b.totalSum - a.totalSum; });

    return {
      ok: true,
      strategy: sid,
      days: packs.length,
      dateFrom: packs[0].date,
      dateTo: packs[packs.length - 1].date,
      rows: filtered.slice(0, 40),
      note: "官方精選以證交所 T86 法人資料篩選；「千張大戶」需股東分散表／付費資料，此版暫以法人急買近似。"
    };
  }

  async function fetchYahooChart(symbol, query) {
    const path = "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(symbol) + "?" + (query || "interval=1d&range=1d");
    let json = null;
    try {
      const res = await fetch(path);
      if (res.ok) json = await res.json();
    } catch (err) { /* relay */ }
    if (!json) {
      const relay = await fetch("https://r.jina.ai/" + path);
      const text = await relay.text();
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) json = JSON.parse(text.slice(start, end + 1));
    }
    return json;
  }

  function quoteFromYahooJson(json) {
    const result = json && json.chart && json.chart.result && json.chart.result[0];
    if (!result) return null;
    const meta = result.meta || {};
    const q = ((result.indicators || {}).quote || [])[0] || {};
    const closes = (q.close || []).filter(function (v) { return v != null && isFinite(Number(v)); }).map(Number);
    const highs = (q.high || []).map(num);
    const lows = (q.low || []).map(num);
    const opens = (q.open || []).map(num);
    const price = closes.length ? closes[closes.length - 1] : num(meta.regularMarketPrice);
    const prev = num(meta.previousClose) || num(meta.chartPreviousClose) ||
      (closes.length > 1 ? closes[closes.length - 2] : null);
    if (!(price > 0)) return null;
    const pct = prev > 0 ? (price / prev - 1) * 100 : num(meta.regularMarketChangePercent);
    const i = closes.length - 1;
    return {
      price: price,
      prev: prev,
      pct: pct,
      open: opens[i] != null ? opens[i] : null,
      high: highs[i] != null ? highs[i] : null,
      low: lows[i] != null ? lows[i] : null,
      closes: closes
    };
  }

  async function usBoard() {
    const M = global.SJMarket;
    const out = [];
    for (let i = 0; i < US_BOARD.length; i++) {
      const item = US_BOARD[i];
      try {
        let q = null;
        if (M && typeof M.yahooSymbolQuote === "function") {
          const hit = await M.yahooSymbolQuote(item.symbol).catch(function () { return null; });
          if (hit) q = { price: hit.price, pct: hit.pct, prev: null, open: null, high: null, low: null, closes: [] };
        }
        if (!q) {
          const json = await fetchYahooChart(item.symbol, "interval=1m&range=1d");
          q = quoteFromYahooJson(json);
        }
        if (!q) {
          const json2 = await fetchYahooChart(item.symbol, "interval=1d&range=5d");
          q = quoteFromYahooJson(json2);
        }
        out.push({
          symbol: item.symbol,
          name: item.name,
          key: item.key,
          core: !!item.core,
          price: q && q.price,
          pct: q && q.pct,
          ok: !!(q && q.price > 0)
        });
      } catch (err) {
        out.push({ symbol: item.symbol, name: item.name, key: item.key, core: !!item.core, price: null, pct: null, ok: false });
      }
    }
    const brief = await buildUsBrief(out);
    return { ok: true, updatedAt: Date.now(), rows: out, brief: brief };
  }

  function maOf(closes, n) {
    if (!closes || closes.length < n) return null;
    let s = 0;
    for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
    return s / n;
  }

  async function buildUsBrief(rows) {
    const byKey = {};
    (rows || []).forEach(function (r) { if (r.key) byKey[r.key] = r; });
    const sox = byKey.sox || {};
    const tsm = byKey.tsm || {};
    const nvda = byKey.nvda || {};
    const vix = byKey.vix || {};
    const tnx = byKey.tnx || {};
    const dxy = byKey.dxy || {};

    let soxMa = { ma20: null, ma60: null, above20: null, above60: null, wick: null, intradayLowPct: null };
    try {
      const json = await fetchYahooChart("^SOX", "interval=1d&range=6mo");
      const q = quoteFromYahooJson(json);
      if (q && q.closes && q.closes.length) {
        const ma20 = maOf(q.closes, 20);
        const ma60 = maOf(q.closes, 60);
        const last = q.closes[q.closes.length - 1];
        soxMa.ma20 = ma20;
        soxMa.ma60 = ma60;
        soxMa.above20 = ma20 != null ? last >= ma20 : null;
        soxMa.above60 = ma60 != null ? last >= ma60 : null;
        if (q.high != null && q.low != null && q.open != null && last != null && q.high > q.low) {
          const lower = Math.min(q.open, last) - q.low;
          const body = Math.abs(last - q.open);
          const range = q.high - q.low;
          soxMa.wick = range > 0 && lower / range >= 0.45 && body / range <= 0.4;
          if (q.prev > 0) soxMa.intradayLowPct = (q.low / q.prev - 1) * 100;
        }
      }
    } catch (err) { /* ignore */ }

    const checks = [];
    // 1 direction
    let dir = "中性";
    let dirDetail = "費半／ADR 資料不足";
    if (sox.pct != null || tsm.pct != null) {
      const soxPct = sox.pct != null ? sox.pct : 0;
      const tsmPct = tsm.pct != null ? tsm.pct : soxPct;
      if (soxPct >= 2) { dir = "偏多跳空"; dirDetail = "費半大漲 ≥2%，台股早盤易開高"; }
      else if (soxPct <= -2) { dir = "偏空提款"; dirDetail = "費半大跌 ≤-2%，慎防開盤接刀"; }
      else if (tsmPct >= 1.5 && soxPct < 0) { dir = "ADR撐盤"; dirDetail = "費半弱但台積電 ADR 強，權值仍可能撐盤"; }
      else if (tsmPct <= -1.5) { dir = "ADR承壓"; dirDetail = "台積電 ADR 弱，加權易承壓"; }
      else if ((soxPct + tsmPct) / 2 > 0.3) { dir = "偏多"; dirDetail = "費半／ADR 小幅偏多"; }
      else if ((soxPct + tsmPct) / 2 < -0.3) { dir = "偏空"; dirDetail = "費半／ADR 小幅偏空"; }
      else { dir = "中性"; dirDetail = "費半／ADR 震盪不大"; }
    }
    checks.push({ q: "看方向（費半／ADR）", a: dir, detail: dirDetail, cls: /多|撐/.test(dir) ? "up" : /空|壓|提款/.test(dir) ? "down" : "" });

    // 2 force VIX
    let force = "中性";
    let forceDetail = "VIX 資料不足";
    if (vix.price != null) {
      if (vix.price >= 30) { force = "極度恐慌"; forceDetail = "VIX≥30，波動劇烈、外資提款風險高"; }
      else if (vix.price >= 20) { force = "避險升溫"; forceDetail = "VIX≥20，今天易劇烈洗盤"; }
      else if (vix.price <= 15) { force = "平靜樂觀"; forceDetail = "VIX≤15，風險偏好偏佳"; }
      else { force = "溫和"; forceDetail = "VIX 在 15～20，波動一般"; }
      if (vix.pct != null && vix.pct <= -8 && vix.price < 25) {
        force = "高檔回落";
        forceDetail = "VIX 快速回落，恐慌緩解偏多";
      }
    }
    checks.push({ q: "看力道（VIX）", a: force, detail: forceDetail, cls: /樂觀|回落|平靜/.test(force) ? "up" : /恐慌|避險/.test(force) ? "down" : "" });

    // 3 money TNX + DXY
    let money = "中性";
    let moneyDetail = "美債／美元資料不足";
    const tnxPx = tnx.price;
    // Yahoo ^TNX often already in percent units (e.g. 4.25)
    if (tnxPx != null || dxy.price != null) {
      const tnxHot = tnxPx != null && (tnxPx >= 4.3 || (tnx.pct != null && tnx.pct >= 3));
      const dxyHot = dxy.price != null && (dxy.price >= 105 || (dxy.pct != null && dxy.pct >= 0.4));
      const tnxCalm = tnxPx != null && tnxPx <= 4.0 && (tnx.pct == null || tnx.pct <= 0);
      const dxySoft = dxy.price != null && dxy.price <= 102 && (dxy.pct == null || dxy.pct <= 0);
      if (tnxHot || dxyHot) {
        money = "資金偏緊";
        moneyDetail = tnxHot && dxyHot ? "美債急升＋美元強，科技估值與匯出壓力同現"
          : (tnxHot ? "美債殖利率偏高／急升，壓縮高本益比科技股" : "美元偏強，資金易回流美、外資偏撤");
      } else if (tnxCalm || dxySoft) {
        money = "資金偏寬";
        moneyDetail = "美債／美元偏弱或穩定，利好風險資產與台股";
      } else {
        money = "中性";
        moneyDetail = "美債與美元尚無明顯極端訊號";
      }
    }
    checks.push({ q: "看資金（美債／美元）", a: money, detail: moneyDetail, cls: /寬/.test(money) ? "up" : /緊/.test(money) ? "down" : "" });

    const lines = [];
    if (sox.pct != null) {
      if (sox.pct >= 2) lines.push("費半大漲 ≥2%：強勢多頭，台股易跳空開高");
      else if (sox.pct <= -2) lines.push("費半大跌 ≤-2%：轉弱，早盤提款賣壓加重");
    }
    if (soxMa.above20 != null || soxMa.above60 != null) {
      if (soxMa.above20 && soxMa.above60) lines.push("費半站上月線／季線：科技上升趨勢，拉回可偏多");
      else if (soxMa.above60 === false) lines.push("費半在季線下：半導體波段修正風險");
    }
    if (soxMa.wick && soxMa.intradayLowPct != null && soxMa.intradayLowPct <= -2) {
      lines.push("費半長下影（盤中深跌後收回）：留意台股開低走高／利空出盡");
    }
    if (tsm.pct != null && nvda.pct != null && Math.abs(tsm.pct - (sox.pct || 0)) >= 1.5) {
      lines.push("龍頭分化：請同時對照台積電 ADR " + (tsm.pct > 0 ? "+" : "") + tsm.pct.toFixed(2) +
        "%、輝達 " + (nvda.pct > 0 ? "+" : "") + nvda.pct.toFixed(2) + "%");
    }

    let bias = "中性觀望";
    let score = 0;
    if (/多|撐|樂觀|回落|寬/.test(dir + force + money)) score += 1;
    if (/空|壓|提款|恐慌|避險|緊/.test(dir + force + money)) score -= 1;
    if (/多|撐/.test(dir)) score += 1;
    if (/空|壓|提款/.test(dir)) score -= 1;
    if (score >= 2) bias = "偏多開高";
    else if (score <= -2) bias = "偏空開低";
    else if (score > 0) bias = "偏多震盪";
    else if (score < 0) bias = "偏空震盪";

    return {
      bias: bias,
      checks: checks,
      lines: lines,
      soxMa: soxMa,
      tip: "口訣：方向看費半＋ADR → 力道看 VIX → 資金看美債／美元。規則試算，非投資建議。"
    };
  }

  global.SJChips = {
    getToken: getToken,
    setToken: setToken,
    analyzeChip: analyzeChip,
    chipDaily: chipDaily,
    screenChips: screenChips,
    usBoard: usBoard,
    sessionLamp: sessionLamp,
    chipTone: chipTone,
    US_BOARD: US_BOARD
  };
})(window);
