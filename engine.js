/* FencingPool engine - pure rules, no screen code. Works in browser and Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const POOL_TOUCHES = 5, DE_TOUCHES = 15;
  const pad = n => String(n).padStart(2, '0');

  // ---------- pools ----------
  // Every pair fences exactly once (checked by tests). Compare with the current
  // FIE rulebook table before an official event and edit here if different.
  const POOL_ORDERS = {
    3: [[1,2],[3,1],[2,3]],
    4: [[1,4],[2,3],[1,3],[2,4],[3,4],[1,2]],
    5: [[1,2],[3,4],[5,1],[2,3],[5,4],[1,3],[2,5],[4,1],[3,5],[4,2]],
    6: [[1,2],[4,5],[2,3],[5,6],[3,1],[6,4],[2,5],[1,4],[5,3],[1,6],[4,2],[3,6],[5,1],[3,4],[6,2]],
    7: [[1,4],[2,5],[3,6],[7,1],[5,4],[2,3],[6,7],[5,1],[4,2],[3,5],[5,7],[1,6],[2,7],[3,4],[1,2],[5,6],[7,3],[4,6],[1,3],[2,6],[7,4]]
  };

  function boutOrder(size) {
    if (POOL_ORDERS[size]) return POOL_ORDERS[size].map(p => p.slice());
    const pl = []; for (let i = 1; i <= size; i++) pl.push(i);
    if (size % 2) pl.push(0);
    const n = pl.length, out = []; let p = pl;
    for (let r = 0; r < n - 1; r++) {
      for (let i = 0; i < n / 2; i++) { const a = p[i], b = p[n - 1 - i]; if (a && b) out.push([a, b]); }
      p = [p[0], p[p.length - 1]].concat(p.slice(1, -1));
    }
    return out;
  }

  /** 265 fencers -> 37 pools of 7 + 1 of 6. Sizes differ by at most 1. */
  function poolSizes(n, target) {
    target = target || 7;
    if (n < 3) throw new Error('At least 3 fencers are needed for a pool.');
    const pools = Math.ceil(n / target), base = Math.floor(n / pools), extra = n % pools;
    return Array(extra).fill(base + 1).concat(Array(pools - extra).fill(base));
  }

  /** Serpentine / zig-zag by seed: row 1 left->right, row 2 right->left ... */
  function serpentine(ids, nPools) {
    const pools = Array.from({ length: nPools }, () => []);
    ids.forEach((id, i) => {
      const row = Math.floor(i / nPools), col = i % nPools;
      pools[row % 2 === 0 ? col : nPools - 1 - col].push(id);
    });
    return pools;
  }
  const buildPools = (seededIds, target) => serpentine(seededIds, poolSizes(seededIds.length, target).length);

  function poolBouts(pools) {
    const out = [];
    pools.forEach((ids, pi) => boutOrder(ids.length).forEach(([a, b], k) =>
      out.push({ id: 'P' + pad(pi + 1) + '-' + pad(k + 1), pool: pi + 1, index: k, a: ids[a - 1], b: ids[b - 1] })));
    return out;
  }

  function poolScoreError(sa, sb, allowDraw) {
    const ok = s => Number.isInteger(s) && s >= 0 && s <= POOL_TOUCHES;
    if (!ok(sa) || !ok(sb)) return 'Pool scores must be whole numbers 0-5.';
    if (sa === sb && allowDraw === false) return 'Draws are not allowed here.';
    return null;
  }
  function deScoreError(sa, sb) {
    const ok = s => Number.isInteger(s) && s >= 0 && s <= DE_TOUCHES;
    if (!ok(sa) || !ok(sb)) return 'DE scores must be whole numbers 0-15.';
    if (sa === sb) return 'No ties in direct elimination: enter the final score after priority (e.g. 10-9).';
    return null;
  }

  // ---------- ranking ----------
  function computeStats(ids, bouts, scores) {
    const st = {}; ids.forEach(id => st[id] = { w: 0, m: 0, tg: 0, tr: 0 });
    bouts.forEach(b => {
      const s = scores[b.id]; if (!s || s.sa == null) return;
      const A = st[b.a], B = st[b.b];
      A.m++; B.m++; A.tg += s.sa; A.tr += s.sb; B.tg += s.sb; B.tr += s.sa;
      if (s.sa > s.sb) A.w++; else if (s.sb > s.sa) B.w++;
    });
    return st;
  }
  const vm = s => (s.m ? s.w / s.m : 0);
  const indicator = s => s.tg - s.tr;

  /** FIE order: V/M, then Indicator (TG-TR), then Touches Scored; ties -> better seed. */
  function rank(fencers, stats) {
    return Object.keys(fencers).map(Number).sort((x, y) => {
      const a = stats[x], b = stats[y];
      const l = a.w * (b.m || 1), r = b.w * (a.m || 1);       // exact V/M compare
      if (l !== r) return r - l;
      if (indicator(a) !== indicator(b)) return indicator(b) - indicator(a);
      if (a.tg !== b.tg) return b.tg - a.tg;
      return fencers[x].r - fencers[y].r;
    });
  }

  /** Bottom cutPct % (20-30, rounded down) is eliminated. */
  function splitCut(rankedIds, cutPct) {
    if (!Number.isInteger(cutPct) || cutPct < 20 || cutPct > 30) throw new Error('Cut must be a whole number from 20 to 30 (%).');
    const out = Math.floor(rankedIds.length * cutPct / 100);
    return { qualified: rankedIds.slice(0, rankedIds.length - out), eliminated: rankedIds.slice(rankedIds.length - out) };
  }

  // ---------- bracket ----------
  const roundName = t => ({ 2: 'Final', 4: 'Semifinals', 8: 'Quarterfinals' }[t] || 'Table of ' + t);

  /** Standard matrix: neighbours fence each other. size 8 -> 1,8,4,5,2,7,3,6 */
  function seedOrder(size) {
    let o = [1, 2];
    while (o.length < size) { const m = o.length * 2; o = o.flatMap(s => [s, m + 1 - s]); }
    return o;
  }

  /** Builds the whole bracket from seeds + saved results (results[boutId] = {sa,sb,v,by,a,b}). */
  function buildBracket(seeded, tableSize, results) {
    results = results || {};
    if (tableSize < 2 || (tableSize & (tableSize - 1))) throw new Error('Table size must be a power of two.');
    if (seeded.length < 2 || seeded.length > tableSize) throw new Error('Qualified fencers do not fit the table.');
    const tables = []; for (let t = tableSize; t >= 2; t /= 2) tables.push(t);
    const order = seedOrder(tableSize), n = seeded.length, rounds = {}, byId = {};
    tables.forEach((t, r) => {
      rounds[t] = [];
      for (let i = 0; i < t / 2; i++) {
        const b = { id: 'DE' + t + '-' + (i + 1), table: t, index: i, a: null, b: null, status: 'pending',
                    winner: null, sa: null, sb: null, v: 0, by: '' };
        let known;
        if (r === 0) {
          const x = order[2 * i], y = order[2 * i + 1];
          b.a = x <= n ? seeded[x - 1] : null; b.b = y <= n ? seeded[y - 1] : null; known = true;
        } else {
          const prev = rounds[tables[r - 1]], fa = prev[2 * i], fb = prev[2 * i + 1];
          if (fa.finished) b.a = fa.winner; if (fb.finished) b.b = fb.winner;
          known = fa.finished && fb.finished;
        }
        if (!known) b.status = 'pending';
        else if (b.a == null && b.b == null) b.status = 'empty';
        else if (b.a == null || b.b == null) { b.status = 'bye'; b.winner = b.a == null ? b.b : b.a; }
        else {
          b.status = 'ready';
          const res = results[b.id];
          if (res && res.sa != null && res.a === b.a && res.b === b.b) {
            b.sa = res.sa; b.sb = res.sb; b.v = res.v || 0; b.by = res.by || '';
            b.winner = res.sa > res.sb ? b.a : b.b; b.status = 'done';
          } else if (res && res.a === b.a && res.b === b.b) b.v = res.v || 0;
        }
        b.finished = b.status === 'done' || b.status === 'bye' || b.status === 'empty';
        rounds[t].push(b); byId[b.id] = b;
      }
    });
    const final = byId['DE2-1'];
    const current = tables.find(t => rounds[t].some(b => !b.finished)) || null;
    return { tables, rounds, byId, current, champion: final.status === 'done' ? final.winner : null,
             entrants: t => new Set(rounds[t].flatMap(b => [b.a, b.b]).filter(x => x != null)).size };
  }

  function nextBout(br, b) { return b.table === 2 ? null : br.rounds[b.table / 2][Math.floor(b.index / 2)]; }

  /** Returns an error text if this correction is not allowed, else null. */
  function deCorrectionError(br, b, sa, sb) {
    const err = deScoreError(sa, sb); if (err) return err;
    if (b.status !== 'ready' && b.status !== 'done') return 'This bout is not ready yet.';
    const nw = sa > sb ? b.a : b.b, nx = nextBout(br, b);
    if (b.status === 'done' && nw !== b.winner && nx && nx.status === 'done')
      return 'Cannot change the winner: the next bout was already fenced.';
    return null;
  }

  /** Final classification: DE places (losers of table T = T/2+1, shared), then pool-eliminated in pool order. */
  function standings(fencers, br, rankIds, qualifiedCount) {
    const rows = [];
    if (br) {
      Object.values(br.byId).forEach(b => {
        if (b.status !== 'done') return;
        rows.push({ place: b.table / 2 + 1, tied: b.table > 2, id: b.a === b.winner ? b.b : b.a });
      });
      if (br.champion != null) rows.push({ place: 1, tied: false, id: br.champion });
      rankIds.slice(qualifiedCount).forEach((id, i) => rows.push({ place: qualifiedCount + 1 + i, tied: false, id }));
    }
    const pos = {}; rankIds.forEach((id, i) => pos[id] = i);
    rows.sort((x, y) => x.place - y.place || pos[x.id] - pos[y.id]);
    return rows.map(r => ({ place: r.place, tied: r.tied, id: r.id, name: fencers[r.id].n }));
  }

  // ---------- mock data & simulation ----------
  const FIRST = ['Ahmed','Omar','Layla','Sara','Yusuf','Nora','Karim','Mina','Hana','Tariq','Lucas','Emma','Marco','Chloe','Ivan','Anna','Kenji','Mei','Diego','Zoe'];
  const LAST = ['Haddad','Nasser','Rossi','Martin','Ivanov','Tanaka','Silva','Novak','Khan','Berg','Costa','Young','Farouk','Weber','Lopez','Sato','Mansour','Kim','Reyes','Hall'];
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function mockNames(n, seed) {
    const r = rng(seed || 1), pick = a => a[Math.floor(r() * a.length)];
    return Array.from({ length: n }, () => pick(FIRST) + ' ' + pick(LAST));
  }
  function strength(id, rankNo, seed) {            // better seed = stronger, plus fixed noise
    const r = rng((seed || 1) * 100003 + id), g = Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
    return -rankNo + 40 * g;
  }
  const winProb = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 150));
  function play(r, ra, rb, limit) {
    let a = 0, b = 0; const p = winProb(ra, rb);
    while (a < limit && b < limit) {
      const x = r();
      if (x < 0.10) { a++; b++; } else if (x < 0.10 + 0.90 * p) a++; else b++;
    }
    return [a, b, p];
  }
  function simulatePools(fencers, pools, seed) {
    const r = rng(seed || 1), res = {};
    poolBouts(pools).forEach(b => {
      const [sa, sb] = play(r, strength(b.a, fencers[b.a].r, seed), strength(b.b, fencers[b.b].r, seed), POOL_TOUCHES);
      res[b.id] = { sa, sb, v: 1, by: 'demo', at: 0 };
    });
    return res;
  }
  function simulateDE(fencers, seeded, tableSize, seed) {
    const r = rng((seed || 1) + 7), results = {};
    for (;;) {
      const br = buildBracket(seeded, tableSize, results);
      if (br.champion != null || br.current == null) return results;
      br.rounds[br.current].filter(b => b.status === 'ready').forEach(b => {
        const ra = strength(b.a, fencers[b.a].r, seed), rb = strength(b.b, fencers[b.b].r, seed);
        let [sa, sb, p] = play(r, ra, rb, DE_TOUCHES);
        if (sa === sb) { if (r() < p) sb = sa - 1; else sa = sb - 1; }
        results[b.id] = { sa, sb, v: 1, by: 'demo', a: b.a, b: b.b };
      });
    }
  }

  return { POOL_TOUCHES, DE_TOUCHES, boutOrder, poolSizes, serpentine, buildPools, poolBouts,
           poolScoreError, deScoreError, computeStats, vm, indicator, rank, splitCut, roundName,
           seedOrder, buildBracket, nextBout, deCorrectionError, standings, mockNames, simulatePools, simulateDE };
});
