/* 行情、指標與六項交易分析。計算在瀏覽器完成，不把價格寫進 Git。 */
(function (global) {
  const RANGES = {
    "1d": { label: "今", klt: 1, lmt: 420, session: "last", align: "index" },
    "5d": { label: "五日", klt: 15, lmt: 240, days: 5, align: "index" },
    "20d": { label: "20日", klt: 101, lmt: 20, align: "date" },
    "180d": { label: "180日", klt: 101, lmt: 180, align: "date" },
    "1y": { label: "年", klt: 101, lmt: 250, align: "date" },
    "3y": { label: "三年", klt: 102, lmt: 160, align: "index" },
    "5y": { label: "五年", klt: 102, lmt: 270, align: "index" }
  };

  const MARKETS = [
    { id: "dji", name: "道瓊", region: "美股", secid: "100.DJIA", color: "#e0a100" },
    { id: "spx", name: "標普", region: "美股", secid: "100.SPX", color: "#6cb6ff" },
    { id: "ndx", name: "那斯達克", region: "美股", secid: "100.NDX", color: "#d38bff" },
    { id: "tw", name: "台股", region: "台股", secid: "100.TWII", color: "#3dbe7a" },
    { id: "jp", name: "日股", region: "日股", secid: "100.N225", color: "#ff7a8a" },
    { id: "kr", name: "韓股", region: "韓股", secid: "100.KS11", color: "#4fd2e0" }
  ];

  const UNIVERSE = [
    { secid: "105.AAPL", code: "AAPL", name: "蘋果", market: "美股" },
    { secid: "105.MSFT", code: "MSFT", name: "微軟", market: "美股" },
    { secid: "105.NVDA", code: "NVDA", name: "輝達", market: "美股" },
    { secid: "105.AMZN", code: "AMZN", name: "亞馬遜", market: "美股" },
    { secid: "105.GOOGL", code: "GOOGL", name: "Alphabet", market: "美股" },
    { secid: "105.META", code: "META", name: "Meta", market: "美股" },
    { secid: "105.TSLA", code: "TSLA", name: "特斯拉", market: "美股" },
    { secid: "105.AVGO", code: "AVGO", name: "博通", market: "美股" },
    { secid: "105.AMD", code: "AMD", name: "超微", market: "美股" },
    { secid: "106.JPM", code: "JPM", name: "摩根大通", market: "美股" },
    { secid: "178.2330", code: "2330", name: "台積電", market: "台股" },
    { secid: "178.2317", code: "2317", name: "鴻海", market: "台股" },
    { secid: "178.2454", code: "2454", name: "聯發科", market: "台股" },
    { secid: "176.7203", code: "7203", name: "豐田", market: "日股" },
    { secid: "176.6758", code: "6758", name: "索尼", market: "日股" },
    { secid: "177.005930", code: "005930", name: "三星電子", market: "韓股" },
    { secid: "177.000660", code: "000660", name: "SK海力士", market: "韓股" }
  ];

  const cache = new Map();

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function num(v) {
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function copyBars(src) {
    const out = src.map(function (b) { return Object.assign({}, b); });
    out.symbolName = src.symbolName || "";
    return out;
  }

  function parseBars(klines) {
    return (klines || []).map(function (line) {
      const p = String(line).split(",");
      return {
        t: p[0],
        o: num(p[1]),
        c: num(p[2]),
        h: num(p[3]),
        l: num(p[4]),
        v: num(p[5]) || 0
      };
    }).filter(function (b) { return b.c != null && b.c > 0; });
  }

  function trimBars(bars, spec) {
    let out = bars.slice();
    if (spec.session === "last" && out.length) {
      const day = out[out.length - 1].t.slice(0, 10);
      out = out.filter(function (b) { return b.t.slice(0, 10) === day; });
    }
    if (spec.days) {
      const seen = [];
      for (let i = out.length - 1; i >= 0; i--) {
        const d = out[i].t.slice(0, 10);
        if (seen.indexOf(d) < 0) seen.push(d);
        if (seen.length >= spec.days) break;
      }
      const keep = {};
      seen.forEach(function (d) { keep[d] = true; });
      out = out.filter(function (b) { return keep[b.t.slice(0, 10)]; });
    }
    return out;
  }

  async function kline(secid, klt, lmt) {
    const key = secid + "|" + klt + "|" + lmt;
    if (cache.has(key)) return copyBars(cache.get(key));
    const url = "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=" + encodeURIComponent(secid) +
      "&klt=" + klt + "&fqt=1&lmt=" + lmt + "&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56";
    let last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("行情站回應 " + res.status);
        const json = await res.json();
        const bars = parseBars(json.data && json.data.klines);
        if (!bars.length) throw new Error("沒有這段行情");
        bars.symbolName = (json.data && json.data.name) || "";
        cache.set(key, bars);
        return copyBars(bars);
      } catch (err) {
        last = err;
        await sleep(350 * (attempt + 1));
      }
    }
    throw last || new Error("行情讀取失敗");
  }

  async function bars(secid, rangeId) {
    const spec = RANGES[rangeId] || RANGES["20d"];
    const raw = await kline(secid, spec.klt, spec.lmt);
    return trimBars(raw, spec);
  }

  async function mapPool(items, limit, fn) {
    const ret = new Array(items.length);
    let cursor = 0;
    async function worker() {
      while (cursor < items.length) {
        const idx = cursor++;
        ret[idx] = await fn(items[idx], idx);
      }
    }
    const n = Math.min(limit, items.length);
    const jobs = [];
    for (let i = 0; i < n; i++) jobs.push(worker());
    await Promise.all(jobs);
    return ret;
  }

  function search(q) {
    const query = String(q || "").trim();
    if (!query) return Promise.resolve([]);
    return new Promise(function (resolve, reject) {
      const cb = "sjcb_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      const script = document.createElement("script");
      let done = false;
      const timer = setTimeout(function () { finish(new Error("搜尋逾時")); }, 8000);
      function finish(err, rows) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { delete global[cb]; } catch (e) { global[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        if (err) reject(err);
        else resolve(rows || []);
      }
      global[cb] = function (data) {
        const list = (((data || {}).QuotationCodeTable || {}).Data) || [];
        const allow = { "美股": 1, "台股": 1, "日股": 1, "韓股": 1, "指数": 1 };
        const rows = [];
        list.forEach(function (item) {
          const kind = item.SecurityTypeName || "";
          if (!allow[kind]) return;
          if (/Notes|票据|债券|基金/.test(item.Name || "")) return;
          if (/ETF/i.test(item.Name || "") && String(item.Code || "").toUpperCase() !== query.toUpperCase()) return;
          const code = item.Code || "";
          const market = kind === "指数" ? indexRegion(code) : kind;
          rows.push({
            secid: item.QuoteID,
            code: code,
            name: item.Name || code,
            market: market
          });
        });
        rows.sort(function (a, b) {
          function rank(row) {
            const exact = row.code.toUpperCase() === query.toUpperCase() ? 0 : 5;
            const local = (/^\d{4}$/.test(query) && row.market === "台股") || (/^\d{6}$/.test(query) && row.market === "韓股") ? -1 : 0;
            return exact + local;
          }
          return rank(a) - rank(b);
        });
        finish(null, rows.slice(0, 8));
      };
      script.onerror = function () { finish(new Error("搜尋失敗")); };
      script.src = "https://searchapi.eastmoney.com/api/suggest/get?cb=" + cb +
        "&input=" + encodeURIComponent(query) + "&type=14&count=8";
      document.head.appendChild(script);
    });
  }

  function indexRegion(code) {
    const map = { DJIA: "美股", SPX: "美股", NDX: "美股", TWII: "台股", N225: "日股", KS11: "韓股" };
    return map[code] || "指數";
  }

  async function quoteMap(secids) {
    const ids = (secids || []).filter(Boolean);
    const out = {};
    if (!ids.length) return out;
    const url = "https://push2delay.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=" +
      encodeURIComponent(ids.join(",")) + "&fields=f12,f13,f14,f2,f3,f9,f20,f23";
    const res = await fetch(url);
    if (!res.ok) throw new Error("報價讀取失敗");
    const json = await res.json();
    const rows = (json.data && json.data.diff) || [];
    rows.forEach(function (row) {
      const secid = row.f13 + "." + row.f12;
      out[secid] = {
        secid: secid,
        code: row.f12,
        name: row.f14,
        price: num(row.f2),
        pct: num(row.f3),
        pe: num(row.f9),
        cap: num(row.f20),
        pb: num(row.f23)
      };
    });
    return out;
  }

  function sma(values, n) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= n) sum -= values[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  function ema(values, n) {
    const out = new Array(values.length).fill(null);
    const k = 2 / (n + 1);
    let prev = null;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i === n - 1) {
        prev = sum / n;
        out[i] = prev;
      } else if (i >= n) {
        prev = values[i] * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  }

  function rsi(values, n) {
    const out = new Array(values.length).fill(null);
    if (values.length <= n) return out;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= n; i++) {
      const d = values[i] - values[i - 1];
      if (d >= 0) gain += d;
      else loss -= d;
    }
    gain /= n;
    loss /= n;
    out[n] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    for (let i = n + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      const g = d > 0 ? d : 0;
      const l = d < 0 ? -d : 0;
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
  }

  function macd(values) {
    const e12 = ema(values, 12);
    const e26 = ema(values, 26);
    const line = values.map(function (_, i) {
      return e12[i] == null || e26[i] == null ? null : e12[i] - e26[i];
    });
    const compact = [];
    const index = [];
    line.forEach(function (v, i) {
      if (v != null) {
        compact.push(v);
        index.push(i);
      }
    });
    const signalCompact = ema(compact, 9);
    const signal = new Array(values.length).fill(null);
    const hist = new Array(values.length).fill(null);
    signalCompact.forEach(function (v, j) {
      if (v == null) return;
      const i = index[j];
      signal[i] = v;
      hist[i] = line[i] - v;
    });
    return { line: line, signal: signal, hist: hist };
  }

  function atr(bars, n) {
    const tr = bars.map(function (b, i) {
      if (i === 0) return (b.h != null && b.l != null) ? b.h - b.l : 0;
      const prev = bars[i - 1].c;
      return Math.max(b.h - b.l, Math.abs(b.h - prev), Math.abs(b.l - prev));
    });
    return sma(tr, n);
  }

  function closesOf(bars) {
    return bars.map(function (b) { return b.c; });
  }

  function lastValid(arr) {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
    return null;
  }

  function swings(bars, span) {
    const highs = [];
    const lows = [];
    for (let i = span; i < bars.length - span; i++) {
      let isH = true;
      let isL = true;
      for (let j = i - span; j <= i + span; j++) {
        if (bars[j].h > bars[i].h) isH = false;
        if (bars[j].l < bars[i].l) isL = false;
      }
      if (isH) highs.push(bars[i].h);
      if (isL) lows.push(bars[i].l);
    }
    return { highs: highs, lows: lows };
  }

  function slopeText(values) {
    const n = values.length;
    if (n < 10) return "樣本太短，看不出趨勢線。";
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      sx += i; sy += values[i]; sxx += i * i; sxy += i * values[i];
    }
    const den = n * sxx - sx * sx;
    const slope = den ? (n * sxy - sx * sy) / den : 0;
    const pct = values[0] ? (slope / values[0]) * 100 : 0;
    if (pct > 0.08) return "近 " + n + " 根收盤的回歸線向上，每根約 " + pct.toFixed(2) + "%。";
    if (pct < -0.08) return "近 " + n + " 根收盤的回歸線向下，每根約 " + pct.toFixed(2) + "%。";
    return "近 " + n + " 根收盤的回歸線接近走平，每根約 " + pct.toFixed(2) + "%。";
  }

  function roundPx(n) {
    if (!isFinite(n)) return null;
    if (Math.abs(n) >= 1000) return Math.round(n * 100) / 100;
    if (Math.abs(n) >= 100) return Math.round(n * 100) / 100;
    return Math.round(n * 1000) / 1000;
  }

  function capText(cap) {
    if (!isFinite(cap) || cap <= 0) return "";
    if (cap >= 1e12) return "市值約 " + (cap / 1e12).toFixed(2) + " 兆";
    if (cap >= 1e8) return "市值約 " + (cap / 1e8).toFixed(0) + " 億";
    return "市值約 " + Math.round(cap).toLocaleString("zh-Hant");
  }

  function fundLine(q) {
    if (!q) return "報價站沒有本益比或市值，這次只看技術面。";
    const bits = [];
    if (isFinite(q.pe) && q.pe > 0) {
      let tone = "本益比 " + q.pe.toFixed(1);
      if (q.pe < 12) tone += "，獲利收益率偏高";
      else if (q.pe > 40) tone += "，評價偏貴，部位應以技術結構為主";
      else tone += "，評價落在常見區間";
      bits.push(tone);
    } else bits.push("沒有可用本益比");
    if (isFinite(q.pb) && q.pb > 0) bits.push("股價淨值 " + q.pb.toFixed(2));
    const cap = capText(q.cap);
    if (cap) bits.push(cap);
    return bits.join("，") + "。";
  }

  function scoreOne(meta, bars) {
    const c = closesOf(bars);
    const i = c.length - 1;
    if (i < 60) return null;
    const s20 = sma(c, 20);
    const s60 = sma(c, 60);
    const s120 = sma(c, Math.min(120, c.length));
    const rv = rsi(c, 14);
    const md = macd(c);
    const at = atr(bars, 14);
    const close = c[i];
    const rsiNow = rv[i];
    const atrNow = at[i] || close * 0.02;
    let hh = -Infinity;
    let volSum = 0;
    let volN = 0;
    for (let k = i - 20; k < i; k++) {
      if (k < 0) continue;
      hh = Math.max(hh, bars[k].h);
      volSum += bars[k].v || 0;
      volN++;
    }
    const avgVol = volN ? volSum / volN : 0;
    const vol = bars[i].v || 0;
    let swing = close;
    for (let k = Math.max(0, i - 7); k <= i; k++) swing = Math.min(swing, bars[k].l);
    let stop = Math.min(swing, close - 1.5 * atrNow);
    if (!(stop < close * 0.995)) stop = close - 1.5 * atrNow;
    if (!(stop < close)) stop = close * 0.97;
    const risk = close - stop;
    const target = close + 2 * risk;
    const dist = s20[i] ? Math.abs(close - s20[i]) / s20[i] : 1;
    let score = 48;
    const upTrend = s20[i] != null && s60[i] != null && close > s60[i] && s20[i] > s60[i];
    const breakout = isFinite(hh) && close > hh && close > (s60[i] || 0) && avgVol > 0 && vol > avgVol * 1.35;
    const pullback = upTrend && dist < 0.025 && rsiNow >= 38 && rsiNow <= 62;
    const bounce = rsiNow != null && rsiNow < 35 && s120[i] != null && close > s120[i] && md.hist[i] != null && md.hist[i - 1] != null && md.hist[i] > md.hist[i - 1];
    if (close > (s60[i] || close)) score += 8; else score -= 12;
    if (s20[i] != null && s60[i] != null && s20[i] > s60[i]) score += 8; else score -= 8;
    if (rsiNow >= 40 && rsiNow <= 62) score += 8;
    if (rsiNow != null && rsiNow < 30) score -= 4;
    if (breakout) score += 14;
    if (pullback) score += 12;
    if (bounce) score += 6;
    let setup = "沒有明確結構";
    if (breakout) setup = "區間突破";
    else if (pullback) setup = "均線回檔";
    else if (bounce) setup = "超賣反彈";
    const tradable = score >= 68 && (breakout || pullback);
    const reasons = [];
    reasons.push(upTrend ? "日線收在 60 日均線上，20 日均線也在 60 日之上，趨勢仍偏多。" : "日線還沒有 20 日與 60 日均線同時向上的多頭排列。");
    if (breakout) reasons.push("收盤突破前 20 根高點，量能高於 20 日均量，屬於突破結構。");
    else if (pullback) reasons.push("價格回到 20 日均線附近（距離 " + (dist * 100).toFixed(1) + "%），RSI " + rsiNow.toFixed(0) + "，是順勢回檔而不是追高。");
    else if (bounce) reasons.push("RSI " + rsiNow.toFixed(0) + " 進入超賣，MACD 柱狀轉強，但仍要等站回短均線。");
    else reasons.push("RSI " + (rsiNow == null ? "—" : rsiNow.toFixed(0)) + "，與 20 日均線距離 " + (dist * 100).toFixed(1) + "%，沒有同時滿足突破或回檔。");
    reasons.push("停損放在近 8 根低點與 1.5 倍 ATR 的較低者，停利先以 2 倍風險計算。");
    return {
      secid: meta.secid,
      code: meta.code,
      name: meta.name,
      market: meta.market,
      badge: tradable ? "可進場" : "僅觀察",
      setup: setup,
      score: score,
      entry: roundPx(close),
      stop: roundPx(stop),
      target: roundPx(target),
      rr: risk > 0 ? 2 : null,
      atr: atrNow,
      reasons: reasons
    };
  }

  async function scan(opts) {
    opts = opts || {};
    const capital = Number(opts.capital) > 0 ? Number(opts.capital) : 1000000;
    const riskPct = Number(opts.riskPct) > 0 ? Number(opts.riskPct) : 1;
    let done = 0;
    const rows = await mapPool(UNIVERSE, 3, async function (meta) {
      try {
        const raw = await kline(meta.secid, 101, 180);
        const idea = scoreOne(meta, raw);
        done++;
        if (opts.onProgress) opts.onProgress(done, UNIVERSE.length, meta.name);
        return idea;
      } catch (err) {
        done++;
        if (opts.onProgress) opts.onProgress(done, UNIVERSE.length, meta.name);
        return null;
      }
    });
    const ideas = rows.filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, 5);
    let quotes = {};
    try { quotes = await quoteMap(ideas.map(function (item) { return item.secid; })); } catch (e) { quotes = {}; }
    ideas.forEach(function (item, idx) {
      item.rank = idx + 1;
      const risk = item.entry - item.stop;
      item.shares = risk > 0 ? Math.floor(capital * (riskPct / 100) / risk) : 0;
      item.fundamental = fundLine(quotes[item.secid]);
      item.riskCash = capital * (riskPct / 100);
    });
    return {
      scanned: UNIVERSE.length,
      kept: ideas.length,
      tradable: ideas.filter(function (item) { return item.badge === "可進場"; }).length,
      ideas: ideas
    };
  }

  async function technical(secid) {
    const daily = await kline(secid, 101, 260);
    const weekly = await kline(secid, 102, 80);
    const name = daily.symbolName || secid;
    const c = closesOf(daily);
    const i = c.length - 1;
    const close = c[i];
    const s5 = sma(c, 5);
    const s20 = sma(c, 20);
    const s60 = sma(c, 60);
    const s120 = sma(c, 120);
    const rv = rsi(c, 14);
    const md = macd(c);
    const sw = swings(daily, 3);
    const wc = closesOf(weekly);
    const w20 = sma(wc, 20);
    const wClose = wc[wc.length - 1];
    const wMa = lastValid(w20);
    const weeklyUp = wMa != null && wClose > wMa;
    const maUp = s20[i] != null && s60[i] != null && close > s20[i] && s20[i] > s60[i];
    const macdUp = md.hist[i] != null && md.hist[i] > 0;
    const rsiOk = rv[i] != null && rv[i] >= 45 && rv[i] <= 70;
    const rsiWeak = rv[i] != null && rv[i] < 45;
    const maDown = s20[i] != null && s60[i] != null && close < s20[i] && s20[i] < s60[i];
    const macdDown = md.hist[i] != null && md.hist[i] < 0;
    let verdict = "觀望";
    if (maUp && macdUp && rsiOk && weeklyUp) verdict = "買進";
    else if (maDown && macdDown && rsiWeak && !weeklyUp) verdict = "賣出";
    const steps = [
      { name: "週線方向", pass: weeklyUp, detail: weeklyUp ? "週線收在 20 週均線上。" : "週線還沒站上 20 週均線。" },
      { name: "日線均線", pass: maUp, detail: maUp ? "收盤 > 20 日 > 60 日。" : "日線沒有多頭排列。" },
      { name: "MACD", pass: macdUp, detail: macdUp ? "MACD 柱狀在零軸上。" : "MACD 柱狀還在零軸下或剛走平。" },
      { name: "RSI", pass: rsiOk, detail: "RSI(14) 為 " + (rv[i] == null ? "—" : rv[i].toFixed(1)) + "。買進區看 45 到 70。" }
    ];
    if (verdict === "賣出") {
      steps.push({ name: "空頭確認", pass: true, detail: "均線空頭、MACD 為負、RSI 低於 45，週線也沒有轉強。" });
    }
    const supports = sw.lows.filter(function (p) { return p < close; }).slice(-3);
    const resistances = sw.highs.filter(function (p) { return p > close; }).slice(-3);
    const mas = [
      { name: "5 日", value: s5[i], above: s5[i] != null && close >= s5[i] },
      { name: "20 日", value: s20[i], above: s20[i] != null && close >= s20[i] },
      { name: "60 日", value: s60[i], above: s60[i] != null && close >= s60[i] },
      { name: "120 日", value: s120[i], above: s120[i] != null && close >= s120[i] }
    ];
    const histNow = md.hist[i];
    const histPrev = md.hist[i - 1];
    let momentum = "RSI " + (rv[i] == null ? "—" : rv[i].toFixed(1)) + "。";
    if (histNow != null) {
      momentum += " MACD 柱 " + histNow.toFixed(2);
      if (histPrev != null) momentum += histNow > histPrev ? "，柱狀放大。" : "，柱狀縮小。";
      else momentum += "。";
    }
    return {
      secid: secid,
      name: name,
      close: roundPx(close),
      verdict: verdict,
      steps: steps,
      supports: supports.map(roundPx),
      resistances: resistances.map(roundPx),
      trend: slopeText(c.slice(-60)),
      mas: mas.map(function (m) { return { name: m.name, value: roundPx(m.value), above: m.above }; }),
      momentum: momentum,
      weekly: weeklyUp ? "週線偏多，日線信號可以順著做。" : "週線尚未轉多，日線反彈先當反彈看。"
    };
  }

  function splitNews(text) {
    return String(text || "").split(/[\n。！？!?；;]+/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 8);
  }

  async function newsPlan(opts) {
    opts = opts || {};
    const daily = await kline(opts.secid, 101, 180);
    const c = closesOf(daily);
    const i = c.length - 1;
    const close = c[i];
    const at = atr(daily, 14);
    const atrNow = at[i] || close * 0.02;
    const back5 = c[Math.max(0, i - 5)];
    const back20 = c[Math.max(0, i - 20)];
    const ret5 = back5 ? close / back5 - 1 : 0;
    const ret20 = back20 ? close / back20 - 1 : 0;
    const atrPct = close ? atrNow / close : 0;
    const priced = Math.abs(ret5) > atrPct * 2;
    const sentences = splitNews(opts.text);
    const seen = [];
    const unseen = [];
    sentences.forEach(function (line) {
      if (/將|預計|下季|明年|計畫|計劃|預期|將於/.test(line)) unseen.push(line);
      else if (/已|公布|公告|昨日|今天|本日|上季|去年/.test(line)) seen.push(line);
    });
    const posWords = (opts.text || "").match(/成長|上修|優於|買回|增產|利多|超預期|beat|raise|訂單/ig) || [];
    const negWords = (opts.text || "").match(/下修|衰退|調查|裁員|不如|利空|虧損|miss|延遲|禁令/ig) || [];
    let bias = "中性";
    if (posWords.length > negWords.length) bias = "偏多";
    else if (negWords.length > posWords.length) bias = "偏空";
    const capital = Number(opts.capital) > 0 ? Number(opts.capital) : 1000000;
    const riskPct = Number(opts.riskPct) > 0 ? Number(opts.riskPct) : 1;
    const stop = close - 1.5 * atrNow;
    const shares = stop < close ? Math.floor(capital * (riskPct / 100) / (close - stop)) : 0;
    let quotes = {};
    try { quotes = await quoteMap([opts.secid]); } catch (e) { quotes = {}; }
    return {
      name: daily.symbolName || opts.secid,
      close: roundPx(close),
      bias: bias,
      shortRange: [roundPx(close - 1.2 * atrNow), roundPx(close + 1.2 * atrNow)],
      longRange: [roundPx(close - 3 * atrNow), roundPx(close + 3 * atrNow)],
      ret5: ret5,
      ret20: ret20,
      priced: priced,
      pricedText: priced
        ? "近 5 日漲跌 " + (ret5 * 100).toFixed(1) + "%，已超過兩倍單日 ATR，短線消息有一部分可能已經反映在價格裡。"
        : "近 5 日漲跌 " + (ret5 * 100).toFixed(1) + "%，還在約一個 ATR 的平常波動裡，價格還沒有明顯消化這則消息。",
      seen: seen,
      unseen: unseen,
      noTime: !seen.length && !unseen.length,
      shares: shares,
      stop: roundPx(stop),
      riskCash: capital * (riskPct / 100),
      fundamental: fundLine(quotes[opts.secid]),
      weeklyNote: "20 日漲跌 " + (ret20 * 100).toFixed(1) + "%。長期區間用 3 倍 ATR，約一個月的平常擺動，不是目標價。"
    };
  }

  function tradeMetrics(bars, kind) {
    const c = closesOf(bars);
    const s5 = sma(c, 5);
    const s20 = sma(c, 20);
    const s60 = sma(c, 60);
    const rv = rsi(c, 14);
    const trades = [];
    let inPos = false;
    let entry = 0;
    let entryEquity = 1;
    let equity = 1;
    let peak = 1;
    let maxDD = 0;
    function mark(px) {
      const mtm = inPos ? entryEquity * (px / entry) : equity;
      peak = Math.max(peak, mtm);
      maxDD = Math.min(maxDD, mtm / peak - 1);
    }
    for (let i = 60; i < bars.length; i++) {
      let enter = false;
      let exit = false;
      if (kind === "cross") {
        enter = s5[i - 1] != null && s20[i - 1] != null && s5[i] != null && s20[i] != null && s5[i - 1] <= s20[i - 1] && s5[i] > s20[i];
        exit = s5[i - 1] != null && s20[i - 1] != null && s5[i] != null && s20[i] != null && s5[i - 1] >= s20[i - 1] && s5[i] < s20[i];
      } else if (kind === "rsi") {
        enter = rv[i - 1] != null && rv[i] != null && rv[i - 1] < 30 && rv[i] >= 30;
        exit = rv[i] != null && rv[i] > 70;
      } else {
        let hh = -Infinity;
        let ll = Infinity;
        for (let j = i - 20; j < i; j++) hh = Math.max(hh, bars[j].h);
        for (let j = i - 10; j < i; j++) ll = Math.min(ll, bars[j].l);
        enter = c[i] > hh && s60[i] != null && c[i] > s60[i];
        exit = c[i] < ll;
      }
      if (inPos && exit) {
        const ret = c[i] / entry - 1;
        trades.push(ret);
        equity = entryEquity * (1 + ret);
        inPos = false;
        mark(c[i]);
      } else if (!inPos && enter) {
        inPos = true;
        entry = c[i];
        entryEquity = equity;
        mark(c[i]);
      } else mark(c[i]);
    }
    const wins = trades.filter(function (r) { return r > 0; });
    const losses = trades.filter(function (r) { return r <= 0; });
    const grossWin = wins.reduce(function (s, r) { return s + r; }, 0);
    const grossLoss = losses.reduce(function (s, r) { return s + r; }, 0);
    const avg = trades.length ? trades.reduce(function (s, r) { return s + r; }, 0) / trades.length : 0;
    return {
      trades: trades.length,
      open: inPos,
      winRate: trades.length ? wins.length / trades.length : null,
      profitFactor: grossLoss < 0 ? grossWin / Math.abs(grossLoss) : (grossWin > 0 ? null : 0),
      maxDD: maxDD,
      avg: avg,
      equity: equity
    };
  }

  async function backtest(opts) {
    opts = opts || {};
    const lmt = opts.range === "5y" ? 1300 : opts.range === "3y" ? 780 : 260;
    const daily = await kline(opts.secid, 101, lmt);
    const kind = opts.strategy || "cross";
    const m = tradeMetrics(daily, kind);
    const names = { cross: "5 日與 20 日均線交叉", rsi: "RSI 跌破 30 回升、70 出場", breakout: "突破 20 日高、跌破 10 日低出場" };
    const tips = [];
    if (m.trades < 8) tips.push("完成的交易不到 8 筆，勝率還不穩。拉長到三年或五年，或改看突破策略。");
    if (m.profitFactor != null && m.profitFactor < 1) tips.push("獲利因子小於 1。只在收盤站上 60 日均線時允許進場，並把停損收在 1.5 倍 ATR。");
    if (m.winRate != null && m.winRate >= 0.6 && m.profitFactor != null && m.profitFactor < 1.3) tips.push("勝率不低，但賺的單太小。停利至少放到 2 倍停損，不要一有利潤就平倉。");
    if (m.maxDD < -0.25) tips.push("最大回撤超過 25%。同樣信號把部位減半，或加一條「週線在 20 週均線下不做多」。");
    if (m.winRate != null && m.winRate < 0.4 && m.trades >= 8) tips.push("勝率低於四成。進場改成只做突破，並要求量能高於 20 日均量。");
    if (!tips.length) tips.push("這組數字還站得住。下一步用另一個市場的同類股票再跑一次，確認不是單一標的的巧合。");
    return {
      name: daily.symbolName || opts.secid,
      strategy: names[kind] || kind,
      rangeLabel: opts.range === "5y" ? "五年" : opts.range === "3y" ? "三年" : "一年",
      bars: daily.length,
      metrics: m,
      tips: tips
    };
  }

  function returnsMap(bars) {
    const map = new Map();
    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1].c;
      if (prev) map.set(bars[i].t.slice(0, 10), bars[i].c / prev - 1);
    }
    return map;
  }

  function aligned(a, b) {
    const xs = [];
    const ys = [];
    a.forEach(function (v, day) {
      if (b.has(day)) {
        xs.push(v);
        ys.push(b.get(day));
      }
    });
    return { xs: xs, ys: ys };
  }

  function betaOf(xs, ys) {
    const n = xs.length;
    if (n < 30) return null;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (ys[i] - my) * (ys[i] - my);
    }
    if (!den) return null;
    return num / den;
  }

  function pearson(xs, ys) {
    const n = xs.length;
    if (n < 30) return null;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const a = xs[i] - mx;
      const b = ys[i] - my;
      num += a * b; dx += a * a; dy += b * b;
    }
    if (!dx || !dy) return null;
    return num / Math.sqrt(dx * dy);
  }

  async function riskReport(opts) {
    opts = opts || {};
    const holdings = (opts.holdings || []).filter(function (h) { return h.secid && Number(h.shares) > 0; });
    if (holdings.length < 1) throw new Error("先加入至少一檔持股");
    const cap = { "保守": 0.15, "穩健": 0.25, "積極": 0.4 }[opts.profile] || 0.25;
    const loaded = await mapPool(holdings, 3, async function (h) {
      const series = await kline(h.secid, 101, 180);
      return { holding: h, bars: series, name: series.symbolName || h.name || h.code };
    });
    const market = await kline("100.SPX", 101, 180);
    const mkt = returnsMap(market);
    const priced = loaded.map(function (row) {
      const qBars = row.bars;
      const last = qBars[qBars.length - 1].c;
      const shares = Number(row.holding.shares);
      const value = last * shares;
      const cost = Number(row.holding.cost);
      const pack = aligned(returnsMap(qBars), mkt);
      return {
        secid: row.holding.secid,
        code: row.holding.code,
        name: row.name,
        shares: shares,
        cost: isFinite(cost) ? cost : null,
        price: last,
        value: value,
        pnl: isFinite(cost) ? (last - cost) * shares : null,
        beta: betaOf(pack.xs, pack.ys),
        rets: returnsMap(qBars)
      };
    });
    const total = priced.reduce(function (s, row) { return s + row.value; }, 0);
    priced.forEach(function (row) { row.weight = total ? row.value / total : 0; });
    const portBeta = priced.reduce(function (s, row) { return s + row.weight * (row.beta || 1); }, 0);
    const pairs = [];
    for (let a = 0; a < priced.length; a++) {
      for (let b = a + 1; b < priced.length; b++) {
        const pack = aligned(priced[a].rets, priced[b].rets);
        const rho = pearson(pack.xs, pack.ys);
        if (rho != null && rho >= 0.75) {
          pairs.push({ a: priced[a].code, b: priced[b].code, rho: rho });
        }
      }
    }
    const heavy = priced.filter(function (row) { return row.weight > cap; });
    const weak = [];
    if (heavy.length) weak.push("單一帶超過「" + (opts.profile || "穩健") + "」上限 " + Math.round(cap * 100) + "%：" + heavy.map(function (row) { return row.code; }).join("、") + "。");
    if (pairs.length) weak.push("這些組合走勢幾乎綁在一起，分散效果有限：" + pairs.map(function (p) { return p.a + "/" + p.b; }).join("、") + "。");
    const oneMarket = {};
    holdings.forEach(function (h) { oneMarket[h.market || "未標"] = (oneMarket[h.market || "未標"] || 0) + 1; });
    const regions = Object.keys(oneMarket);
    if (regions.length === 1) weak.push("持股都在" + regions[0] + "，地區風險沒有分開。");
    if (!weak.length) weak.push("權重沒有明顯超過上限，也沒有相關係數高於 0.75 的配對。");
    const weights = priced.map(function (row) { return row.weight; });
    let room = weights.map(function (w) { return Math.min(w, cap); });
    let leftover = 1 - room.reduce(function (s, w) { return s + w; }, 0);
    const under = room.map(function (w) { return Math.max(0, cap - w); });
    const underSum = under.reduce(function (s, w) { return s + w; }, 0);
    if (leftover > 0.001 && underSum > 0) {
      room = room.map(function (w, i) { return w + leftover * (under[i] / underSum); });
      leftover = 0;
    }
    const plan = priced.map(function (row, i) {
      return { code: row.code, from: row.weight, to: room[i] };
    });
    const drop = portBeta * 0.2;
    let cashFrac = null;
    if (portBeta > 0.5) cashFrac = Math.max(0, Math.min(0.9, 1 - 0.5 / portBeta));
    return {
      profile: opts.profile || "穩健",
      cap: cap,
      total: total,
      beta: portBeta,
      drop: drop,
      cashFrac: cashFrac,
      rows: priced,
      pairs: pairs,
      weak: weak,
      plan: plan,
      cashLeft: leftover
    };
  }

  function reviewJournal(trades) {
    const rows = (trades || []).slice().sort(function (a, b) {
      return String(b.date || "").localeCompare(String(a.date || "")) || String(b.id || "").localeCompare(String(a.id || ""));
    }).slice(0, 20);
    const filled = rows.filter(function (t) { return !t.missed && isFinite(Number(t.entry)) && isFinite(Number(t.exit)); });
    const missed = rows.filter(function (t) { return t.missed || /錯過/.test(t.note || ""); });
    const pnls = filled.map(function (t) {
      const qty = Number(t.qty) > 0 ? Number(t.qty) : 1;
      const diff = String(t.side) === "放空" ? Number(t.entry) - Number(t.exit) : Number(t.exit) - Number(t.entry);
      return { trade: t, pnl: diff * qty, ret: Number(t.entry) ? diff / Number(t.entry) : 0 };
    });
    const wins = pnls.filter(function (p) { return p.pnl > 0; });
    const losses = pnls.filter(function (p) { return p.pnl <= 0; });
    const avgWin = wins.length ? wins.reduce(function (s, p) { return s + p.ret; }, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce(function (s, p) { return s + p.ret; }, 0) / losses.length : 0;
    const noStop = filled.filter(function (t) { return !(Number(t.stop) > 0); }).length;
    const chase = rows.filter(function (t) { return t.emotion === "追價"; }).length;
    const fear = rows.filter(function (t) { return t.emotion === "恐懼提早出"; }).length;
    const revenge = rows.filter(function (t) { return t.emotion === "不甘心加碼"; }).length;
    const hesitate = rows.filter(function (t) { return t.emotion === "猶豫沒下"; }).length;
    const byCode = {};
    losses.forEach(function (p) {
      const code = p.trade.code || p.trade.symbol || "未命名";
      byCode[code] = (byCode[code] || 0) + 1;
    });
    let repeatCode = "";
    let repeatN = 0;
    Object.keys(byCode).forEach(function (code) {
      if (byCode[code] > repeatN) { repeatN = byCode[code]; repeatCode = code; }
    });
    const biases = [];
    if (chase >= 3 || (rows.length && chase / rows.length >= 0.3)) biases.push("追價出現 " + chase + " 次，進場常常發生在價格已經離開計畫之後。");
    if (fear >= 2) biases.push("有 " + fear + " 筆因為恐懼提早出場，獲利單容易留不住。");
    if (revenge >= 2) biases.push("不甘心加碼出現 " + revenge + " 次，虧損後擴大部位。");
    if (hesitate >= 2 || missed.length >= 3) biases.push("猶豫或明確記成錯過的有 " + (hesitate + missed.length) + " 筆，條件到了卻沒有執行。");
    if (!biases.length) biases.push(rows.length < 5 ? "最近樣本還少，行為偏誤還不明顯。" : "這 20 筆裡沒有單一情緒反覆超過門檻。");
    const rules = [];
    if (chase >= 2) rules.push("下單前先寫進場價。現價偏離那個價格超過 1%，這筆就放棄。");
    if (noStop >= Math.max(2, Math.ceil(filled.length / 2))) rules.push("沒有寫停損價之前，不送出委託。");
    if (avgLoss && avgWin && Math.abs(avgLoss) > avgWin) rules.push("停損固定用 1 倍 ATR，停利至少放到 2 倍停損，避免虧損單大於獲利單。");
    if (repeatN >= 3) rules.push(repeatCode + " 已連續虧損 " + repeatN + " 筆。這檔先休息 5 個交易日，期間不開新倉。");
    if (missed.length >= 2 || hesitate >= 2) rules.push("條件符合時先掛限價單，不把「再看看」留到收盤。每週檢討一次錯過清單。");
    if (fear >= 2) rules.push("進場當下寫好停利價。碰到停利之前，不因為盤中來回而手動平倉。");
    const fillers = [
      "每一筆先寫進場、停損、停利，三個價格齊了才下單。",
      "同一天虧損兩筆之後，當天不再開新倉。",
      "只做自選股裡週線仍在 20 週均線上的標的。"
    ];
    fillers.forEach(function (line) {
      if (rules.length < 3 && rules.indexOf(line) < 0) rules.push(line);
    });
    return {
      sample: rows.length,
      filled: filled.length,
      missed: missed.length,
      winRate: pnls.length ? wins.length / pnls.length : null,
      avgWin: avgWin,
      avgLoss: avgLoss,
      noStop: noStop,
      biases: biases,
      rules: rules.slice(0, 3),
      small: rows.length < 5
    };
  }

  global.SJMarket = {
    RANGES: RANGES,
    MARKETS: MARKETS,
    bars: bars,
    search: search,
    quoteMap: quoteMap,
    scan: scan,
    technical: technical,
    newsPlan: newsPlan,
    backtest: backtest,
    riskReport: riskReport,
    reviewJournal: reviewJournal
  };
})(window);
