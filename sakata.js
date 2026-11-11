/* 酒田戰法 78 式（圖型戰法目錄，台股紅漲綠跌）。規則試算用，非投資建議。 */
(function (global) {
  const CATALOG = [
    { id: 1, name: "大陽線", bias: "多", kind: "單K" },
    { id: 2, name: "大陰線", bias: "空", kind: "單K" },
    { id: 3, name: "覆蓋線", bias: "空", kind: "雙K" },
    { id: 4, name: "十字星", bias: "中", kind: "單K" },
    { id: 5, name: "極短線", bias: "中", kind: "單K" },
    { id: 6, name: "連續線", bias: "中", kind: "多K" },
    { id: 7, name: "切入線", bias: "中", kind: "雙K" },
    { id: 8, name: "探底線", bias: "多", kind: "單K" },
    { id: 9, name: "三連線", bias: "中", kind: "三K" },
    { id: 10, name: "懷抱線", bias: "中", kind: "雙K" },
    { id: 11, name: "跳空", bias: "中", kind: "雙K" },
    { id: 12, name: "孕出線", bias: "中", kind: "雙K" },
    { id: 13, name: "迫切線", bias: "空", kind: "三K" },
    { id: 14, name: "入首線", bias: "空", kind: "三K" },
    { id: 15, name: "黑三兵", bias: "空", kind: "三K" },
    { id: 16, name: "二星", bias: "中", kind: "雙K" },
    { id: 17, name: "三星", bias: "中", kind: "三K" },
    { id: 18, name: "反打前三", bias: "空", kind: "多K" },
    { id: 19, name: "反拖線", bias: "中", kind: "多K" },
    { id: 20, name: "吊首線", bias: "空", kind: "單K" },
    { id: 21, name: "下阻線", bias: "多", kind: "單K" },
    { id: 22, name: "交錯線", bias: "中", kind: "雙K" },
    { id: 23, name: "外孕十字星", bias: "中", kind: "雙K" },
    { id: 24, name: "跳空連雙陰", bias: "空", kind: "三K" },
    { id: 25, name: "浪高線", bias: "空", kind: "多K" },
    { id: 26, name: "陽包陽", bias: "多", kind: "雙K" },
    { id: 27, name: "陰包陰", bias: "空", kind: "雙K" },
    { id: 28, name: "破檔上跳空", bias: "多", kind: "雙K" },
    { id: 29, name: "破檔下跳空", bias: "空", kind: "雙K" },
    { id: 30, name: "破前覆蓋線", bias: "空", kind: "雙K" },
    { id: 31, name: "低檔五連陽", bias: "多", kind: "多K" },
    { id: 32, name: "高檔五連陰", bias: "空", kind: "多K" },
    { id: 33, name: "低檔轉化線", bias: "多", kind: "雙K" },
    { id: 34, name: "插入線", bias: "多", kind: "雙K" },
    { id: 35, name: "低檔小跳空", bias: "多", kind: "雙K" },
    { id: 36, name: "回落覆蓋線", bias: "空", kind: "雙K" },
    { id: 37, name: "大陽前阻線", bias: "空", kind: "雙K" },
    { id: 38, name: "破檔三陽收十字", bias: "中", kind: "多K" },
    { id: 39, name: "牛皮破檔並列紅", bias: "多", kind: "雙K" },
    { id: 40, name: "下落跳雙陰", bias: "空", kind: "三K" },
    { id: 41, name: "紅三兵", bias: "多", kind: "三K" },
    { id: 42, name: "三兵前阻形", bias: "空", kind: "多K" },
    { id: 43, name: "川字三黑", bias: "空", kind: "三K" },
    { id: 44, name: "倒川字三黑", bias: "空", kind: "三K" },
    { id: 45, name: "夜星", bias: "空", kind: "三K" },
    { id: 46, name: "上空黑二兵", bias: "空", kind: "三K" },
    { id: 47, name: "晨星", bias: "多", kind: "三K" },
    { id: 48, name: "十字夜明星", bias: "空", kind: "三K" },
    { id: 49, name: "長黑回補形", bias: "多", kind: "雙K" },
    { id: 50, name: "落底無力形", bias: "空", kind: "多K" },
    { id: 51, name: "下落二星", bias: "空", kind: "雙K" },
    { id: 52, name: "下落三星", bias: "空", kind: "三K" },
    { id: 53, name: "逆襲線", bias: "多", kind: "雙K" },
    { id: 54, name: "回落再漲形", bias: "多", kind: "三K" },
    { id: 55, name: "上升前阻形", bias: "空", kind: "雙K" },
    { id: 56, name: "上升最後懷抱線", bias: "空", kind: "雙K" },
    { id: 57, name: "下降最後懷抱線", bias: "多", kind: "雙K" },
    { id: 58, name: "上舍子線", bias: "空", kind: "三K" },
    { id: 59, name: "下舍子線", bias: "多", kind: "三K" },
    { id: 60, name: "上升三法", bias: "多", kind: "多K" },
    { id: 61, name: "下降三法", bias: "空", kind: "多K" },
    { id: 62, name: "U字線", bias: "多", kind: "多K" },
    { id: 63, name: "擎天一柱底", bias: "多", kind: "多K" },
    { id: 64, name: "下落變化底", bias: "多", kind: "多K" },
    { id: 65, name: "鍋底", bias: "多", kind: "長週期" },
    { id: 66, name: "半圓天井", bias: "空", kind: "長週期" },
    { id: 67, name: "三山", bias: "空", kind: "長週期" },
    { id: 68, name: "三川", bias: "多", kind: "長週期" },
    { id: 69, name: "三兵", bias: "中", kind: "三K" },
    { id: 70, name: "三空", bias: "中", kind: "多K" },
    { id: 71, name: "曙光初現", bias: "多", kind: "雙K" },
    { id: 72, name: "烏雲蓋頂", bias: "空", kind: "雙K" },
    { id: 73, name: "好友反攻", bias: "多", kind: "雙K" },
    { id: 74, name: "淡友反攻", bias: "空", kind: "雙K" },
    { id: 75, name: "待入線", bias: "多", kind: "雙K" },
    { id: 76, name: "並列陽線", bias: "多", kind: "雙K" },
    { id: 77, name: "並列陰線", bias: "空", kind: "雙K" },
    { id: 78, name: "捉腰帶線", bias: "中", kind: "單K" }
  ];

  function bodyOf(b) { return Math.abs(b.c - b.o); }
  function mid(b) { return (b.o + b.c) / 2; }
  function top(b) { return Math.max(b.o, b.c); }
  function bot(b) { return Math.min(b.o, b.c); }
  function up(b) { return b.c > b.o; }
  function down(b) { return b.c < b.o; }
  function flat(b) { return b.c === b.o || Math.abs(b.c - b.o) <= Math.max(Math.abs(b.c) * 0.001, 0.01); }
  function rangeOf(b) { return Math.max(b.h - b.l, 1e-9); }
  function upper(b) { return b.h - top(b); }
  function lower(b) { return bot(b) - b.l; }
  function gapUp(a, b) { return b.l > a.h; }
  function gapDown(a, b) { return b.h < a.l; }
  function inside(a, b) { return b.h <= a.h && b.l >= a.l; }
  function engulfs(a, b) { return top(b) >= top(a) && bot(b) <= bot(a) && bodyOf(b) > bodyOf(a); }

  function avgBody(rows, i, n) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - n); j < i; j++) {
      s += bodyOf(rows[j]);
      c += 1;
    }
    return c ? s / c : bodyOf(rows[i]) || 0;
  }

  function rose(rows, i, n) {
    const a = Math.max(0, i - n);
    return rows[i].c > rows[a].c;
  }
  function fell(rows, i, n) {
    const a = Math.max(0, i - n);
    return rows[i].c < rows[a].c;
  }

  function isTiny(b, ab) {
    const body = bodyOf(b);
    const rng = rangeOf(b);
    return body <= Math.max(ab * 0.35, Math.abs(b.c) * 0.004) && rng <= Math.max(ab * 0.8, Math.abs(b.c) * 0.01);
  }

  function isDoji(b) {
    return bodyOf(b) / rangeOf(b) <= 0.1 || flat(b);
  }

  function isLong(b, ab) {
    const body = bodyOf(b);
    return body >= Math.max(ab * 1.5, rangeOf(b) * 0.5);
  }

  function detectSakata(bars) {
    const rows = (bars || []).filter(function (b) {
      return b && isFinite(b.o) && isFinite(b.h) && isFinite(b.l) && isFinite(b.c);
    });
    if (rows.length < 2) return [];
    const out = [];
    const hit = {};
    function push(i, id, detail, biasOverride) {
      const meta = CATALOG[id - 1];
      if (!meta) return;
      const key = id + "@" + i;
      if (hit[key]) return;
      hit[key] = true;
      out.push({
        i: i,
        id: id,
        date: String(rows[i].t || "").slice(0, 10),
        name: meta.name,
        bias: biasOverride || meta.bias,
        detail: detail || meta.name,
        kind: meta.kind
      });
    }

    for (let i = 0; i < rows.length; i++) {
      const b = rows[i];
      const ab = avgBody(rows, i, 14) || bodyOf(b);
      const body = bodyOf(b);
      const rng = rangeOf(b);
      const u = upper(b);
      const l = lower(b);
      const noU = u <= rng * 0.08;
      const noL = l <= rng * 0.08;

      // 1 大陽 / 2 大陰
      if (up(b) && isLong(b, ab) && body / rng >= 0.55) {
        push(i, 1, noU && noL ? "光頭光腳大陽，買方一路主導。" : "長紅實體，買盤偏強。");
      }
      if (down(b) && isLong(b, ab) && body / rng >= 0.55) {
        push(i, 2, noU && noL ? "光頭光腳大陰，賣方一路主導。" : "長黑實體，賣壓偏重。");
      }

      // 4 十字星 / 5 極短線 / 78 捉腰帶 / 8 探底 / 20 吊首 / 21 下阻
      if (rng <= Math.max(Math.abs(b.c) * 0.0015, 0.02) && body <= Math.max(Math.abs(b.c) * 0.001, 0.01)) {
        push(i, 5, "開高低收幾乎重疊，極短／一字，多空膠著或鎖死。");
      } else if (isDoji(b)) {
        if (noU && l > body * 1.5) push(i, 4, "T字／蜻蜓十字，低檔較偏多。", fell(rows, i, 5) ? "多" : "中");
        else if (noL && u > body * 1.5) push(i, 4, "倒T／墓碑十字，高檔較偏空。", rose(rows, i, 5) ? "空" : "中");
        else push(i, 4, "十字星，多空暫時均衡，視位置作轉換。");
      } else if (isTiny(b, ab)) {
        push(i, 5, "極短線，力道弱、方向不明。");
      }
      if (up(b) && noL && body >= ab * 0.8) {
        push(i, 78, "陽線捉腰帶（開盤≒最低），偏多開局。", "多");
      }
      if (down(b) && noU && body >= ab * 0.8) {
        push(i, 78, "陰線捉腰帶（開盤≒最高），偏空開局。", "空");
      }
      if (l >= Math.max(body * 2, rng * 0.4) && u <= body * 0.6) {
        if (fell(rows, i, 5)) push(i, 8, "探底線：長下影試底，偏止跌。", "多");
        if (rose(rows, i, 5) && down(b)) push(i, 20, "吊首線：高檔長下影，買勢受挫。", "空");
        if (down(b) && noU) push(i, 21, "下阻線：黑K長下影，低檔有抵抗。", "多");
      }

      if (i < 1) continue;
      const p = rows[i - 1];
      const pb = bodyOf(p);

      // 3 覆蓋線 / 72 烏雲蓋頂 / 71 曙光初現
      if (up(p) && down(b) && b.o >= p.c && b.c < mid(p) && b.c > p.o) {
        push(i, 3, "覆蓋線：黑K覆蓋前紅K過半，賣壓轉強。", "空");
        push(i, 72, "烏雲蓋頂：高開後收進前紅中段以下。", "空");
      }
      if (down(p) && up(b) && b.o <= p.c && b.c > mid(p) && b.c < p.o) {
        push(i, 71, "曙光初現：低開後收過前黑中段，偏多。", "多");
      }

      // 7 切入線
      if (up(b) && Math.abs(b.o - p.l) <= Math.max(Math.abs(p.c) * 0.003, 0.05) && b.c > p.c) {
        push(i, 7, "上切入線：開在前日低點附近後上攻。", "多");
      }
      if (down(b) && Math.abs(b.o - p.h) <= Math.max(Math.abs(p.c) * 0.003, 0.05) && b.c < p.c) {
        push(i, 7, "下切入線：開在前日高點附近後下殺。", "空");
      }

      // 10 懷抱線（吞沒）/ 56 57
      if (engulfs(p, b)) {
        if (down(p) && up(b)) {
          push(i, 10, "懷抱線（紅吞沒黑），低檔偏多。", "多");
          if (fell(rows, i, 8)) push(i, 57, "下降最後懷抱線，止跌轉多訊號。", "多");
        }
        if (up(p) && down(b)) {
          push(i, 10, "懷抱線（黑吞沒紅），高檔偏空。", "空");
          if (rose(rows, i, 8)) push(i, 56, "上升最後懷抱線，漲勢末端轉弱。", "空");
        }
      }

      // 11 跳空 / 28 29 35
      if (gapUp(p, b)) {
        push(i, 11, "向上跳空，追漲力道。", "多");
        if (rose(rows, i, 10)) push(i, 28, "破檔上跳空，突破後續漲意味。", "多");
        if (fell(rows, i, 8) && body < ab) push(i, 35, "低檔小跳空，止跌試探。", "多");
      }
      if (gapDown(p, b)) {
        push(i, 11, "向下跳空，追跌力道。", "空");
        if (fell(rows, i, 10)) push(i, 29, "破檔下跳空，破位續跌意味。", "空");
      }

      // 12 孕出線 / 23 外孕十字
      if (inside(p, b) && body < pb * 0.7) {
        push(i, 12, "孕出線：後K收在前K體內，力道收斂。", rose(rows, i, 5) ? "空" : "中");
        if (isDoji(b) && engulfs(b, p) === false && bodyOf(p) > ab) {
          /* 外孕：大K包小十字 — 用前大後十字且後在體內 */
          push(i, 23, "外孕十字星：大實體孕出十字，轉換警訊。", "中");
        }
      }
      if (isDoji(b) && bodyOf(p) >= ab * 1.2 && inside(p, b)) {
        push(i, 23, "外孕十字星，多空分歧。", "中");
      }

      // 16 二星 / 51 下落二星
      if (isTiny(p, ab) && isTiny(b, ab)) {
        push(i, 16, "二星相連，轉換徵兆。", "中");
        if (fell(rows, i, 6)) push(i, 51, "下落二星，偏空轉換。", "空");
      }

      // 22 交錯線
      if (((up(p) && down(b)) || (down(p) && up(b))) && Math.abs(b.c - p.c) <= Math.max(ab * 0.25, Math.abs(b.c) * 0.005)) {
        push(i, 22, "交錯線：陰陽收盤接近，方向待確認。", "中");
      }

      // 26 陽包陽 / 27 陰包陰
      if (up(p) && up(b) && engulfs(p, b)) push(i, 26, "陽包陽，多頭加碼。", "多");
      if (down(p) && down(b) && engulfs(p, b)) push(i, 27, "陰包陰，空頭加碼。", "空");

      // 30 破前覆蓋 / 36 回落覆蓋
      if (up(p) && down(b) && b.c <= p.o && b.o > p.c) {
        push(i, 30, "破前覆蓋線：幾乎蓋盡前紅。", "空");
        push(i, 36, "回落覆蓋線，回檔轉弱。", "空");
      }

      // 33 低檔轉化 / 34 插入 / 53 逆襲 / 73 74 75
      if (down(p) && up(b) && fell(rows, i, 6)) {
        if (b.c > mid(p)) push(i, 33, "低檔轉化線，空翻多試探。", "多");
        if (b.o < p.c && b.c > p.c && b.c < mid(p)) push(i, 34, "插入線，深入前黑但未過半。", "多");
        if (Math.abs(b.c - p.c) <= Math.max(ab * 0.15, 0.05) && b.o < p.l) {
          push(i, 73, "好友反攻：低開後收回前收附近。", "多");
        }
        if (b.c < p.c && b.c > p.l) push(i, 75, "待入線：收在前黑下半，偏多試探。", "多");
        if (b.o < p.l && up(b)) push(i, 53, "逆襲線：跳低後翻紅反擊。", "多");
      }
      if (up(p) && down(b) && rose(rows, i, 6)) {
        if (Math.abs(b.c - p.c) <= Math.max(ab * 0.15, 0.05) && b.o > p.h) {
          push(i, 74, "淡友反攻：跳高後收回前收附近。", "空");
        }
        if (noL && u > body) push(i, 37, "大陽前阻線：紅後遇上檔壓力。", "空");
        if (u >= body * 1.2 && noL) push(i, 55, "上升前阻形，漲勢受阻。", "空");
      }

      // 39 並列紅 / 76 77 並列
      if (up(p) && up(b) && Math.abs(b.o - p.o) <= Math.max(ab * 0.2, 0.05) && Math.abs(b.c - p.c) <= Math.max(ab * 0.25, 0.05)) {
        push(i, 39, "牛皮破檔並列紅，盤整偏多。", "多");
        push(i, 76, "並列陽線。", "多");
      }
      if (down(p) && down(b) && Math.abs(b.o - p.o) <= Math.max(ab * 0.2, 0.05) && Math.abs(b.c - p.c) <= Math.max(ab * 0.25, 0.05)) {
        push(i, 77, "並列陰線。", "空");
      }

      // 49 長黑回補
      if (gapDown(p, b) === false && down(p) && up(b) && b.c >= p.o && gapDown(rows[Math.max(0, i - 2)], p)) {
        push(i, 49, "長黑回補形：跳空長黑後回補，偏多。", "多");
      }

      if (i < 2) continue;
      const a = rows[i - 2];
      const m = rows[i - 1];
      const ab3 = avgBody(rows, i, 14) || body;

      // 9 三連線 / 15 黑三兵 / 41 紅三兵 / 43 44 / 69 三兵
      if (up(a) && up(m) && up(b) && m.c > a.c && b.c > m.c) {
        push(i, 9, "上升三連線。", "多");
        if (bodyOf(a) > ab3 * 0.5 && bodyOf(m) > ab3 * 0.5 && body > ab3 * 0.5) {
          push(i, 41, "紅三兵，多頭主導。", "多");
          push(i, 69, "三兵（紅），大漲訊號之一。", "多");
        }
      }
      if (down(a) && down(m) && down(b) && m.c < a.c && b.c < m.c) {
        push(i, 9, "下降三連線。", "空");
        if (bodyOf(a) > ab3 * 0.5 && bodyOf(m) > ab3 * 0.5 && body > ab3 * 0.5) {
          push(i, 15, "黑三兵，崩落前兆之一。", "空");
          push(i, 43, "川字三黑，空頭排列。", "空");
          push(i, 69, "三兵（黑），大跌訊號之一。", "空");
        }
        if (a.o > m.o && m.o > b.o && a.c > m.c && m.c > b.c) {
          push(i, 44, "倒川字三黑，加速下跌。", "空");
        }
      }

      // 13 迫切 / 14 入首
      if (down(m) && up(b) && b.o < m.l && b.c <= m.l + (m.h - m.l) * 0.15) {
        push(i, 13, "迫切線：收在前陰影線下緣，偏空。", "空");
      }
      if (down(m) && up(b) && b.o < m.c && b.c > m.c && b.c < mid(m)) {
        push(i, 14, "入首線：反彈深入前陰但力道不足。", "空");
      }

      // 17 三星 / 52 下落三星
      if (isTiny(a, ab3) && isTiny(m, ab3) && isTiny(b, ab3)) {
        push(i, 17, "三星串連，多空分歧。", "中");
        if (fell(rows, i, 8)) push(i, 52, "下落三星，偏空。", "空");
      }

      // 24 跳空連雙陰 / 40 46
      if (gapUp(a, m) && down(m) && down(b)) {
        push(i, 24, "跳空連雙陰，高檔轉弱。", "空");
        push(i, 46, "上空黑二兵。", "空");
      }
      if (gapDown(a, m) && down(m) && down(b)) {
        push(i, 40, "下落跳雙陰，續跌。", "空");
      }

      // 45 夜星 / 47 晨星 / 48 十字夜明星 / 58 59 舍子
      const aBody = bodyOf(a);
      const mBody = bodyOf(m);
      if (up(a) && aBody > ab3 * 0.85 && mBody <= Math.max(aBody * 0.5, ab3 * 0.55) && down(b) && body > ab3 * 0.65 && b.c < mid(a)) {
        push(i, 45, "夜星（黃昏之星），上漲末端轉弱。", "空");
        if (isDoji(m)) push(i, 48, "十字夜明星，轉弱更明確。", "空");
        if (gapUp(a, m) && gapDown(m, b)) push(i, 58, "上舍子線（棄嬰頂）。", "空");
      }
      if (down(a) && aBody > ab3 * 0.85 && mBody <= Math.max(aBody * 0.5, ab3 * 0.55) && up(b) && body > ab3 * 0.65 && b.c > mid(a)) {
        push(i, 47, "晨星，下跌末端轉強。", "多");
        if (gapDown(a, m) && gapUp(m, b)) push(i, 59, "下舍子線（棄嬰底）。", "多");
      }

      // 54 回落再漲
      if (up(a) && down(m) && up(b) && b.c >= a.c) {
        push(i, 54, "回落再漲形，回檔後再攻。", "多");
      }

      // 42 三兵前阻：紅三兵後遇長上影或覆蓋
      if (i >= 3) {
        const x0 = rows[i - 3];
        if (up(x0) && up(a) && up(m) && (down(b) || (up(b) && u > body * 1.5))) {
          push(i, 42, "三兵前阻形：紅三兵後受阻。", "空");
        }
      }
    }

    // 多K／長週期：6 連續、18 反打前三、19 反拖、25 浪高、31 32、38、50、60 61、62-68、70
    for (let i = 4; i < rows.length; i++) {
      const ab = avgBody(rows, i, 14) || bodyOf(rows[i]);
      // 6 連續線：近5根彼此實體重疊、無大跳空
      let cont = true;
      for (let j = i - 3; j <= i; j++) {
        const x = rows[j - 1];
        const y = rows[j];
        if (gapUp(x, y) || gapDown(x, y)) cont = false;
        if (!(y.h >= bot(x) && y.l <= top(x))) cont = false;
      }
      if (cont) push(i, 6, "連續線：穩步推進、少跳空。", "中");

      // 18 反打前三：一根陽線包住前三根
      if (i >= 3 && up(rows[i]) && top(rows[i]) >= Math.max(top(rows[i - 1]), top(rows[i - 2]), top(rows[i - 3])) &&
          bot(rows[i]) <= Math.min(bot(rows[i - 1]), bot(rows[i - 2]), bot(rows[i - 3])) &&
          fell(rows, i - 1, 4)) {
        push(i, 18, "反打前三：看似翻多，酒田視為轉賣警訊。", "空");
      }

      // 19 反拖線
      if (i >= 2 && rose(rows, i - 1, 4) && down(rows[i - 1]) && up(rows[i]) && rows[i].c > rows[i - 1].o) {
        push(i, 19, "上反拖：回檔陰線後再拉紅，偏續漲。", "多");
      }
      if (i >= 2 && fell(rows, i - 1, 4) && up(rows[i - 1]) && down(rows[i]) && rows[i].c < rows[i - 1].o) {
        push(i, 19, "下反拖：反彈陽線後再拉黑，偏續跌。", "空");
      }

      // 25 浪高線：創新高後長上影或轉黑
      if (i >= 5) {
        let maxH = -Infinity;
        for (let j = i - 5; j < i; j++) maxH = Math.max(maxH, rows[j].h);
        if (rows[i].h > maxH && (upper(rows[i]) > bodyOf(rows[i]) || down(rows[i]))) {
          push(i, 25, "浪高線：創新高但上檔受阻。", "空");
        }
      }

      // 31 低檔五連陽 / 32 高檔五連陰
      if (i >= 4) {
        let fiveUp = true;
        let fiveDn = true;
        for (let j = i - 4; j <= i; j++) {
          if (!up(rows[j])) fiveUp = false;
          if (!down(rows[j])) fiveDn = false;
        }
        if (fiveUp && fell(rows, i - 4, 12)) push(i, 31, "低檔五連陽，反攻訊號。", "多");
        if (fiveDn && rose(rows, i - 4, 12)) push(i, 32, "高檔五連陰，轉弱訊號。", "空");
      }

      // 38 破檔三陽收十字
      if (i >= 3 && up(rows[i - 3]) && up(rows[i - 2]) && up(rows[i - 1]) && isDoji(rows[i]) && rose(rows, i, 8)) {
        push(i, 38, "破檔三陽收十字，攻勢猶豫。", "中");
      }

      // 50 落底無力：連跌後小陽無力創新高
      if (i >= 3 && fell(rows, i, 6) && up(rows[i]) && bodyOf(rows[i]) < ab * 0.6 && rows[i].c < rows[i - 2].c) {
        push(i, 50, "落底無力形，反彈弱。", "空");
      }

      // 60 上升三法：大陽 + 三根回檔小K仍在體內 + 再大陽
      if (i >= 4) {
        const b0 = rows[i - 4];
        const b1 = rows[i - 3];
        const b2 = rows[i - 2];
        const b3 = rows[i - 1];
        const b4 = rows[i];
        if (up(b0) && isLong(b0, ab) && bodyOf(b1) < bodyOf(b0) && bodyOf(b2) < bodyOf(b0) && bodyOf(b3) < bodyOf(b0) &&
            bot(b1) >= bot(b0) && bot(b2) >= bot(b0) && bot(b3) >= bot(b0) &&
            top(b1) <= top(b0) && top(b2) <= top(b0) && top(b3) <= top(b0) &&
            up(b4) && b4.c > b0.c) {
          push(i, 60, "上升三法：大陽後回檔再攻，偏多續漲。", "多");
        }
        if (down(b0) && isLong(b0, ab) && bodyOf(b1) < bodyOf(b0) && bodyOf(b2) < bodyOf(b0) && bodyOf(b3) < bodyOf(b0) &&
            top(b1) <= top(b0) && top(b2) <= top(b0) && top(b3) <= top(b0) &&
            bot(b1) >= bot(b0) && bot(b2) >= bot(b0) && bot(b3) >= bot(b0) &&
            down(b4) && b4.c < b0.c) {
          push(i, 61, "下降三法：大陰後反彈再殺，偏空續跌。", "空");
        }
      }

      // 70 三空：近段累計三個同向跳空
      if (i >= 6) {
        let gu = 0;
        let gd = 0;
        for (let j = i - 5; j <= i; j++) {
          if (gapUp(rows[j - 1], rows[j])) gu += 1;
          if (gapDown(rows[j - 1], rows[j])) gd += 1;
        }
        if (gu >= 3) push(i, 70, "三空（上跳三空），強勢漲升訊號。", "多");
        if (gd >= 3) push(i, 70, "三空（下跳三空），強勢下跌訊號。", "空");
      }
    }

    // 長週期 62-68：用收盤擺動近似
    if (rows.length >= 30) {
      const closes = rows.map(function (r) { return r.c; });
      const n = closes.length - 1;
      function localMax(idx, w) {
        for (let k = idx - w; k <= idx + w; k++) {
          if (k < 0 || k >= closes.length) continue;
          if (closes[k] > closes[idx]) return false;
        }
        return true;
      }
      function localMin(idx, w) {
        for (let k = idx - w; k <= idx + w; k++) {
          if (k < 0 || k >= closes.length) continue;
          if (closes[k] < closes[idx]) return false;
        }
        return true;
      }
      const peaks = [];
      const troughs = [];
      const w = 3;
      for (let i = w; i < closes.length - w; i++) {
        if (localMax(i, w)) peaks.push(i);
        if (localMin(i, w)) troughs.push(i);
      }
      if (peaks.length >= 3) {
        const p1 = peaks[peaks.length - 3];
        const p2 = peaks[peaks.length - 2];
        const p3 = peaks[peaks.length - 1];
        const avg = (closes[p1] + closes[p2] + closes[p3]) / 3;
        if (Math.abs(closes[p1] - avg) / avg < 0.08 && Math.abs(closes[p2] - avg) / avg < 0.08 &&
            Math.abs(closes[p3] - avg) / avg < 0.08 && p3 > n - 8) {
          push(p3, 67, "三山（三重頂／三尊頭近似），偏空。", "空");
        }
        if (closes[p2] >= closes[p1] && closes[p2] >= closes[p3] && p3 > n - 8) {
          push(p3, 67, "三山／頭肩頂近似，偏空。", "空");
        }
      }
      if (troughs.length >= 3) {
        const t1 = troughs[troughs.length - 3];
        const t2 = troughs[troughs.length - 2];
        const t3 = troughs[troughs.length - 1];
        const avg = (closes[t1] + closes[t2] + closes[t3]) / 3;
        if (Math.abs(closes[t1] - avg) / avg < 0.08 && Math.abs(closes[t2] - avg) / avg < 0.08 &&
            Math.abs(closes[t3] - avg) / avg < 0.08 && t3 > n - 8) {
          push(t3, 68, "三川（三重底／倒三尊近似），偏多。", "多");
        }
      }
      // 62 U字：近15根先跌後大陽收復
      if (n >= 14) {
        const slice = rows.slice(n - 14, n + 1);
        const midI = 7;
        const lo = Math.min.apply(null, slice.map(function (r) { return r.l; }));
        if (slice[0].c > lo * 1.04 && slice[slice.length - 1].c > lo * 1.04 &&
            slice[midI].l <= lo * 1.01 && up(slice[slice.length - 1]) && isLong(slice[slice.length - 1], ab || bodyOf(slice[0]))) {
          push(n, 62, "U字線：急跌後V／U翻升。", "多");
        }
      }
      // 63 擎天一柱底：連跌後長黑
      if (n >= 5 && fell(rows, n, 5) && down(rows[n]) && isLong(rows[n], avgBody(rows, n, 14))) {
        push(n, 63, "擎天一柱底：急殺長黑，或近末端拋售。", "多");
      }
      // 64 下落變化底：底部小K後大陽
      if (n >= 6 && fell(rows, n - 1, 8) && up(rows[n]) && isLong(rows[n], avgBody(rows, n, 14))) {
        let small = 0;
        for (let j = n - 5; j < n; j++) if (isTiny(rows[j], avgBody(rows, n, 14))) small += 1;
        if (small >= 2) push(n, 64, "下落變化底：底部盤整後大陽。", "多");
      }
      // 65 鍋底 / 66 半圓天井：簡化曲率
      if (n >= 40) {
        const win = rows.slice(n - 39, n + 1);
        const first = win[0].c;
        const last = win[win.length - 1].c;
        const midC = win[20].c;
        const minC = Math.min.apply(null, win.map(function (r) { return r.c; }));
        const maxC = Math.max.apply(null, win.map(function (r) { return r.c; }));
        if (midC <= minC * 1.02 && last > first && last > midC * 1.03) {
          push(n, 65, "鍋底（碟形底近似），長線偏多。", "多");
        }
        if (midC >= maxC * 0.98 && last < first && last < midC * 0.97) {
          push(n, 66, "半圓天井（圓弧頂近似），長線偏空。", "空");
        }
      }
    }

    out.sort(function (a, b) {
      if (a.i !== b.i) return b.i - a.i;
      return a.id - b.id;
    });
    return out;
  }

  global.SJSakata = {
    CATALOG: CATALOG,
    detect: detectSakata
  };
})(window);
