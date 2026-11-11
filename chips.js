/* 籌碼分析／選股／日報／美股看板。分點需 FinMind 付費 token；無 token 時用法人＋融資近似。 */
(function (global) {
  const TOKEN_KEY = "sj-finmind-token";
  const US_BOARD = [
    { symbol: "^DJI", name: "道瓊" },
    { symbol: "^GSPC", name: "標普" },
    { symbol: "^IXIC", name: "那斯達克" },
    { symbol: "^SOX", name: "費半" },
    { symbol: "AAPL", name: "蘋果" },
    { symbol: "MSFT", name: "微軟" },
    { symbol: "NVDA", name: "輝達" },
    { symbol: "TSLA", name: "特斯拉" },
    { symbol: "AMD", name: "超微" },
    { symbol: "META", name: "Meta" },
    { symbol: "GOOGL", name: "Google" },
    { symbol: "AMZN", name: "亞馬遜" },
    { symbol: "QQQ", name: "QQQ" },
    { symbol: "SPY", name: "SPY" }
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

  async function usBoard() {
    const M = global.SJMarket;
    const out = [];
    for (let i = 0; i < US_BOARD.length; i++) {
      const item = US_BOARD[i];
      try {
        let price = null;
        let prev = null;
        let pct = null;
        let name = item.name;
        if (M && M.quoteMap) {
          // yahoo via market helper using synthetic secid
        }
        const path = "https://query1.finance.yahoo.com/v8/finance/chart/" +
          encodeURIComponent(item.symbol) + "?interval=1m&range=1d";
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
        const result = json && json.chart && json.chart.result && json.chart.result[0];
        if (result) {
          const meta = result.meta || {};
          const closes = ((((result.indicators || {}).quote || [])[0] || {}).close || [])
            .filter(function (v) { return v != null && isFinite(Number(v)); })
            .map(Number);
          price = closes.length ? closes[closes.length - 1] : num(meta.regularMarketPrice);
          prev = num(meta.previousClose) || num(meta.chartPreviousClose);
          if (price > 0 && prev > 0) pct = (price / prev - 1) * 100;
          else pct = num(meta.regularMarketChangePercent);
        }
        out.push({ symbol: item.symbol, name: name, price: price, pct: pct, ok: price > 0 });
      } catch (err) {
        out.push({ symbol: item.symbol, name: item.name, price: null, pct: null, ok: false });
      }
    }
    return { ok: true, updatedAt: Date.now(), rows: out };
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
