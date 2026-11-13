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
    { symbol: "TXNIGHT", name: "台指期夜盤", key: "txnight", special: "txnight" },
    { symbol: "^IXIC", name: "那斯達克", key: "ixic" },
    { symbol: "AAPL", name: "蘋果", key: "aapl" },
    { symbol: "MARGIN", name: "融資", key: "margin", special: "margin" },
    { symbol: "FLOWSHORT", name: "空單", key: "flowshort", special: "flowshort" },
    { symbol: "FLOWBUY", name: "外資買超", key: "flowbuy", special: "flowbuy" },
    { symbol: "FLOWSELL", name: "外資賣超", key: "flowsell", special: "flowsell" },
    { symbol: "QQQ", name: "QQQ", key: "qqq" },
    { symbol: "SPY", name: "SPY", key: "spy" }
  ];

  let flowBoardPack = null;
  let flowBoardAt = 0;
  let flowBoardInflight = null;

  async function loadFlowBoardPack() {
    if (flowBoardPack && (Date.now() - flowBoardAt) < 45000) return flowBoardPack;
    if (flowBoardInflight) return flowBoardInflight;
    flowBoardInflight = (async function () {
      const M = global.SJMarket;
      const pack = { shortOi: null, buyYi: null, sellYi: null, shortDelta: null, date: "" };
      if (!M) return pack;
      try {
        const oi = M.txForeignOiLatest ? await M.txForeignOiLatest().catch(function () { return null; }) : null;
        const spot = M.foreignSpotDay ? await M.foreignSpotDay().catch(function () { return null; }) : null;
        if (oi && oi.shortOi != null) {
          pack.shortOi = oi.shortOi;
          pack.date = oi.date || pack.date;
          if (M.txForeignFutSeries) {
            const series = await M.txForeignFutSeries(8).catch(function () { return []; });
            if (series && series.length >= 2) {
              const last = series[series.length - 1];
              const prev = series[series.length - 2];
              if (last && prev && prev.shortOi > 0) {
                pack.shortDelta = (last.shortOi / prev.shortOi - 1) * 100;
              }
            }
          }
        }
        if (spot) {
          // 看板「買超／賣超」顯示淨額（與證交所／新聞一致），不是買進／賣出毛額
          const netYi = spot.netYi != null && isFinite(spot.netYi)
            ? spot.netYi
            : (spot.buyYi != null && spot.sellYi != null ? spot.buyYi - spot.sellYi : null);
          if (netYi != null && isFinite(netYi)) {
            pack.buyYi = netYi > 0 ? netYi : null;
            pack.sellYi = netYi < 0 ? Math.abs(netYi) : null;
            pack.netYi = netYi;
          }
          pack.date = spot.date || pack.date;
        }
      } catch (err) { /* ignore */ }
      flowBoardPack = pack;
      flowBoardAt = Date.now();
      return pack;
    })();
    try {
      return await flowBoardInflight;
    } finally {
      flowBoardInflight = null;
    }
  }

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

  async function usBoardOne(item) {
    const M = global.SJMarket;
    try {
      if (item.special === "margin") {
        const series = M && M.marginSeries
          ? await M.marginSeries(10).catch(function () { return []; })
          : [];
        const last = series && series.length ? series[series.length - 1] : null;
        const bal = last && last.balance != null ? last.balance : null;
        const chgPct = last && last.chg != null ? last.chg * 100 : null;
        return {
          symbol: item.symbol,
          name: item.name,
          key: item.key,
          core: !!item.core,
          price: bal != null ? bal / 1e8 : null,
          pct: chgPct,
          ok: bal != null && isFinite(bal),
          flow: "margin",
          flowUnit: "億股",
          meta: last || null
        };
      }
      if (item.special === "flowshort" || item.special === "flowbuy" || item.special === "flowsell") {
        const pack = await loadFlowBoardPack();
        if (item.special === "flowshort") {
          return {
            symbol: item.symbol,
            name: item.name,
            key: item.key,
            core: !!item.core,
            price: pack.shortOi,
            pct: pack.shortDelta,
            ok: pack.shortOi != null && isFinite(pack.shortOi),
            flow: "short",
            flowUnit: "口",
            meta: pack
          };
        }
        if (item.special === "flowbuy") {
          return {
            symbol: item.symbol,
            name: item.name,
            key: item.key,
            core: !!item.core,
            price: pack.buyYi,
            pct: null,
            ok: pack.buyYi != null && isFinite(pack.buyYi),
            flow: "buy",
            flowUnit: "億",
            meta: pack
          };
        }
        return {
          symbol: item.symbol,
          name: item.name,
          key: item.key,
          core: !!item.core,
          price: pack.sellYi,
          pct: null,
          ok: pack.sellYi != null && isFinite(pack.sellYi),
          flow: "sell",
          flowUnit: "億",
          meta: pack
        };
      }
      if (item.special === "txnight") {
        const night = M && typeof M.txNightLatest === "function"
          ? await M.txNightLatest().catch(function () { return null; })
          : null;
        return {
          symbol: item.symbol,
          name: night && night.isNight === false ? "台指期" : item.name,
          key: item.key,
          core: !!item.core,
          price: night && night.close,
          pct: night && night.pct,
          ok: !!(night && night.close > 0),
          meta: night || null
        };
      }
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
      return {
        symbol: item.symbol,
        name: item.name,
        key: item.key,
        core: !!item.core,
        price: q && q.price,
        pct: q && q.pct,
        ok: !!(q && q.price > 0)
      };
    } catch (err) {
      return { symbol: item.symbol, name: item.name, key: item.key, core: !!item.core, price: null, pct: null, ok: false };
    }
  }

  async function usBoard() {
    const out = new Array(US_BOARD.length);
    let cursor = 0;
    const workers = Math.min(4, US_BOARD.length);
    async function worker() {
      while (cursor < US_BOARD.length) {
        const i = cursor++;
        out[i] = await usBoardOne(US_BOARD[i]);
      }
    }
    await Promise.all(Array.from({ length: workers }, worker));
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
    const txnight = byKey.txnight || {};

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
    // 1 direction（費半／ADR＋台指期夜盤）
    let dir = "中性";
    let dirDetail = "費半／台積電 ADR／台指期夜盤資料暫時讀不到，方向先當未知。";
    const txPct = txnight.pct;
    if (sox.pct != null || tsm.pct != null || txPct != null) {
      const soxPct = sox.pct != null ? sox.pct : 0;
      const tsmPct = tsm.pct != null ? tsm.pct : soxPct;
      const nightNote = txPct != null
        ? ("台指期夜盤 " + (txPct > 0 ? "+" : "") + txPct.toFixed(2) + "%。")
        : "台指期夜盤暫無。";
      if (soxPct >= 2 || (txPct != null && txPct >= 0.8 && soxPct >= 0.5)) {
        dir = "偏多跳空";
        dirDetail = (soxPct >= 2
          ? "昨晚費半大漲超過 2%，科技股偏強，台股早盤 09:00 容易直接開高（跳空開高機率升）。"
          : "費半偏多且台指期夜盤明顯走高，早盤開高機率升。") + nightNote;
      } else if (soxPct <= -2 || (txPct != null && txPct <= -0.8 && soxPct <= -0.5)) {
        dir = "偏空提款";
        dirDetail = (soxPct <= -2
          ? "昨晚費半大跌超過 2%，賣壓偏重，台股早盤要小心開低被提款、別急著接刀。"
          : "費半偏弱且台指期夜盤明顯走低，早盤提款／開低機率升。") + nightNote;
      } else if (tsmPct >= 1.5 && soxPct < 0) {
        dir = "ADR撐盤";
        dirDetail = "費半偏弱，但台積電 ADR 相對強，權值股可能撐住加權，全面崩跌機率較低。" + nightNote;
      } else if (tsmPct <= -1.5) {
        dir = "ADR承壓";
        dirDetail = "台積電 ADR 偏弱，加權指數容易被權值股拖累，早盤宜保守。" + nightNote;
      } else if (txPct != null && txPct >= 0.45 && (soxPct + tsmPct) / 2 >= 0) {
        dir = "偏多";
        dirDetail = "台指期夜盤偏多，配合費半／ADR 不弱，台股偏向開平高或小開高。" + nightNote;
      } else if (txPct != null && txPct <= -0.45 && (soxPct + tsmPct) / 2 <= 0) {
        dir = "偏空";
        dirDetail = "台指期夜盤偏空，配合費半／ADR 不強，台股偏向開平低或小開低。" + nightNote;
      } else if ((soxPct + tsmPct) / 2 > 0.3) {
        dir = "偏多";
        dirDetail = "費半／ADR 小幅偏多，台股偏向開平高或小開高，還不到大跳空等級。" + nightNote;
      } else if ((soxPct + tsmPct) / 2 < -0.3) {
        dir = "偏空";
        dirDetail = "費半／ADR 小幅偏空，台股偏向開平低或小開低，先看能否守住昨收。" + nightNote;
      } else {
        dir = "中性";
        dirDetail = "費半／ADR／夜盤震盪不大，開盤方向不明顯，等前 30 分鐘再決定。" + nightNote;
      }
    }
    checks.push({
      q: "看方向（費半／ADR／夜盤）",
      a: dir,
      detail: dirDetail,
      cls: /多|撐/.test(dir) ? "up" : /空|壓|提款/.test(dir) ? "down" : ""
    });

    // 2 force VIX
    let force = "中性";
    let forceDetail = "VIX 資料暫時讀不到，力道先當未知。";
    if (vix.price != null) {
      if (vix.price >= 30) {
        force = "極度恐慌";
        forceDetail = "恐慌指數很高：市場情緒亂、容易大殺大砍，外資提款風險高，部位宜輕。";
      } else if (vix.price >= 20) {
        force = "避險升溫";
        forceDetail = "恐慌偏高：今天比較容易劇烈洗盤，開高也可能被洗下來。";
      } else if (vix.price <= 15) {
        force = "平靜樂觀";
        forceDetail = "恐慌偏低：市場比較敢買風險資產，短線氣氛偏穩。";
      } else {
        force = "溫和";
        forceDetail = "恐慌在正常區間，力道普通，沒有特別大漲大跌的情緒。";
      }
      if (vix.pct != null && vix.pct <= -8 && vix.price < 25) {
        force = "高檔回落";
        forceDetail = "恐慌情緒明顯降溫：亂砍股的壓力減輕，短線較容易出現跌深反彈氣氛。";
      }
    }
    checks.push({ q: "看力道（VIX）", a: force, detail: forceDetail, cls: /樂觀|回落|平靜/.test(force) ? "up" : /恐慌|避險/.test(force) ? "down" : "" });

    // 3 money TNX + DXY
    let money = "中性";
    let moneyDetail = "美債／美元資料暫時讀不到，資金面先當未知。";
    const tnxPx = tnx.price;
    // Yahoo ^TNX often already in percent units (e.g. 4.25)
    if (tnxPx != null || dxy.price != null) {
      const tnxHot = tnxPx != null && (tnxPx >= 4.3 || (tnx.pct != null && tnx.pct >= 3));
      const dxyHot = dxy.price != null && (dxy.price >= 105 || (dxy.pct != null && dxy.pct >= 0.4));
      const tnxCalm = tnxPx != null && tnxPx <= 4.0 && (tnx.pct == null || tnx.pct <= 0);
      const dxySoft = dxy.price != null && dxy.price <= 102 && (dxy.pct == null || dxy.pct <= 0);
      if (tnxHot || dxyHot) {
        money = "資金偏緊";
        moneyDetail = tnxHot && dxyHot
          ? "美債急升又碰上美元偏強：大資金偏保守，高本益比電子／科技股上方容易被壓。"
          : (tnxHot
            ? "美債殖利率偏高或急升：錢變貴，高本益比科技股（電子、PCB、網通）上方空間易被壓抑。"
            : "美元偏強：資金較易回流美國，外資對台股偏保守，反彈別追太兇。");
      } else if (tnxCalm || dxySoft) {
        money = "資金偏寬";
        moneyDetail = "美債／美元偏弱或穩定：大資金壓力較輕，風險資產與台股相對有利。";
      } else {
        money = "中性";
        moneyDetail = "美債與美元沒有特別極端，資金面中性，進出仍看個股支撐壓力。";
      }
    }
    checks.push({ q: "看資金（美債／美元）", a: money, detail: moneyDetail, cls: /寬/.test(money) ? "up" : /緊/.test(money) ? "down" : "" });

    const lines = [];
    const actions = [];
    const gapUp = dir === "偏多跳空";
    const gapDown = dir === "偏空提款";
    const tight = money === "資金偏緊";
    const underQ = soxMa.above60 === false;

    if (txPct != null) {
      if (txPct >= 0.6) lines.push("台指期夜盤偏多（" + (txPct > 0 ? "+" : "") + txPct.toFixed(2) + "%）：現貨開高機率升，仍防開高遇解套。");
      else if (txPct <= -0.6) lines.push("台指期夜盤偏空（" + txPct.toFixed(2) + "%）：現貨開低／提款機率升，早盤勿急接。");
      else lines.push("台指期夜盤震盪有限（" + (txPct > 0 ? "+" : "") + txPct.toFixed(2) + "%），開盤方向仍看費半／ADR 合力。");
    }
    if (gapUp && (tight || underQ)) {
      lines.push("白話總結：短線開盤偏多（易開高），但中線資金仍偏緊" +
        (underQ ? "，且費半還在季線下——比較像空頭架構下的強勢反彈，不是長多確認。" : "。"));
      lines.push("實戰最常見：開高走低。早盤跳空開高後，套牢賣壓容易倒貨，10:00 前後要分真假轉強。");
    } else if (gapUp) {
      lines.push("白話總結：費半／夜盤偏多帶動，台股早盤偏多、容易開高；仍要看開高後能不能站穩均價。");
    } else if (gapDown) {
      lines.push("白話總結：費半／夜盤偏空，台股早盤偏空、容易開低；別急著開盤接刀，等止跌再談。");
    } else if (sox.pct != null) {
      if (sox.pct >= 2) lines.push("費半大漲：台股易跳空開高，但要防開高遇解套賣壓。");
      else if (sox.pct <= -2) lines.push("費半大跌：早盤提款賣壓加重，空手勿急接。");
    }
    if (soxMa.above20 != null || soxMa.above60 != null) {
      if (soxMa.above20 && soxMa.above60) {
        lines.push("費半站上月線／季線：半導體中期偏多，拉回可偏多看待。");
      } else if (underQ) {
        lines.push("費半在季線下：即使大漲，也多半是「空頭裡的反彈」，還沒正式走回長多。");
      }
    }
    if (soxMa.wick && soxMa.intradayLowPct != null && soxMa.intradayLowPct <= -2) {
      lines.push("費半出現長下影（盤中深跌又收回）：留意台股開低走高、利空出盡的機會。");
    }
    if (tsm.pct != null && nvda.pct != null && Math.abs(tsm.pct - (sox.pct || 0)) >= 1.5) {
      lines.push("龍頭分化：台積電 ADR " + (tsm.pct > 0 ? "+" : "") + tsm.pct.toFixed(2) +
        "%、輝達 " + (nvda.pct > 0 ? "+" : "") + nvda.pct.toFixed(2) + "%，權值與題材可能不同步。");
    }

    if (gapUp && (tight || underQ)) {
      actions.push("絕不在早盤跳空開高的前 30 分鐘追買，避免買在當日最高。");
      actions.push("弱勢持股：開高反彈若 10:00 後站不穩均價／壓力，優先減碼逃命，不要幻想一次漲回成本。");
      actions.push("相對強勢股：開高後守穩開盤低點與均價可續抱；若跌破昨收回補缺口，當假突破先減碼。");
      actions.push("速查：費半大漲＋資金緊／季線下 → 不追高、弱勢股趁開高減；10:00 站穩均價才續抱強勢股。");
    } else if (gapUp) {
      actions.push("可偏多看待，但仍不追第一盤跳空；等回測站穩再考慮加碼。");
      actions.push("持股：開高後守均價續抱；破昨收則先減碼控風險。");
    } else if (gapDown) {
      actions.push("早盤不急著低接；等量縮止跌或長下影再談試單。");
      actions.push("持股：反彈先減碼，破關鍵防守執行停損，禁止攤平。");
    } else {
      actions.push("方向不明時不追價：用個股支撐壓力做區間，破防守停損。");
    }

    let bias = "中性觀望";
    let score = 0;
    if (/多|撐|樂觀|回落|寬/.test(dir + force + money)) score += 1;
    if (/空|壓|提款|恐慌|避險|緊/.test(dir + force + money)) score -= 1;
    if (/多|撐/.test(dir)) score += 1;
    if (/空|壓|提款/.test(dir)) score -= 1;
    if (txPct != null) {
      if (txPct >= 0.45) score += 1;
      else if (txPct <= -0.45) score -= 1;
    }
    if (gapUp && (tight || underQ)) bias = "短多中緊／易開高走低";
    else if (score >= 2) bias = "偏多開高";
    else if (score <= -2) bias = "偏空開低";
    else if (score > 0) bias = "偏多震盪";
    else if (score < 0) bias = "偏空震盪";

    return {
      bias: bias,
      summary: gapUp && (tight || underQ)
        ? "短線開盤偏多（易開高），但中線資金仍偏緊——常見開高走低。"
        : "",
      checks: checks,
      lines: lines,
      actions: actions,
      soxMa: soxMa,
      tip: "口訣：方向看費半＋ADR＋台指期夜盤 → 力道看 VIX → 資金看美債／美元。規則試算，非投資建議。"
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
