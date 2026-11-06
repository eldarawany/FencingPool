/* FencingPool storage + actions. Two stores with the same API:
   LocalStore    - this phone/browser only (test mode, no setup)
   FirebaseStore - shared live database (many referees at once)  */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.FPStore = factory(root.FP);
})(typeof self !== 'undefined' ? self : this, function (FP) {
  'use strict';

  const clone = x => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  function setPath(obj, path, val) {
    const parts = path.split('/'); let o = obj;
    for (let i = 0; i < parts.length - 1; i++) { if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {}; o = o[parts[i]]; }
    if (val === null || val === undefined) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = clone(val);
  }
  const getPath = (obj, path) => path.split('/').reduce((o, k) => (o == null ? undefined : o[k]), obj);

  class LocalStore {
    constructor(code) {
      this.live = false; this.code = code; this.cbs = []; this.key = 'fp_local_' + code;
      try { this.data = JSON.parse(localStorage.getItem(this.key)) || {}; } catch (e) { this.data = {}; }
    }
    close() { this.cbs = []; }
    watch(cb) { this.cbs.push(cb); setTimeout(() => cb(clone(this.data)), 0); }
    _save() { try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {} this.cbs.forEach(cb => cb(clone(this.data))); }
    update(obj) { Object.keys(obj).forEach(k => setPath(this.data, k, obj[k])); this._save(); return Promise.resolve(); }
    transact(path, fn) {
      const cur = getPath(this.data, path), nv = fn(cur === undefined ? null : clone(cur));
      if (nv === undefined) return Promise.resolve({ committed: false });
      setPath(this.data, path, nv); this._save(); return Promise.resolve({ committed: true });
    }
  }

  class FirebaseStore {
    constructor(code, cfg) {
      this.live = true; this.code = code; this.data = {};
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      this.db = firebase.database(); this.ref = this.db.ref('t/' + code);
    }
    watch(cb, onConn) {
      this.ref.on('value', s => { this.data = s.val() || {}; cb(this.data); });
      if (onConn) this.db.ref('.info/connected').on('value', s => onConn(!!s.val()));
    }
    close() { this.ref.off(); }
    update(obj) { return this.ref.update(obj); }
    transact(path, fn) { return this.ref.child(path).transaction(fn).then(r => ({ committed: r.committed })); }
  }

  const keyOf = (prefix, n) => prefix + n;

  /** Everything the screen shows, computed from the raw database tree. */
  function derive(d) {
    d = d || {};
    const fencers = {};
    Object.keys(d.fencers || {}).forEach(k => { fencers[+k.slice(1)] = { n: d.fencers[k].n, r: d.fencers[k].r }; });
    const ids = Object.keys(fencers).map(Number);
    const pools = Object.keys(d.pools || {}).sort().map(k => d.pools[k].split(',').map(Number));
    const bouts = FP.poolBouts(pools), scores = d.pb || {};
    const stats = FP.computeStats(ids, bouts, scores);
    const live = ids.length ? FP.rank(fencers, stats) : [];
    const fin = d.final || null;
    const rankIds = fin ? fin.rank.split(',').map(Number) : live;
    const bracket = fin ? FP.buildBracket(rankIds.slice(0, fin.q), fin.table, d.de || {}) : null;
    const meta = d.meta || null;
    let phase = meta ? meta.phase : null;
    if (bracket && bracket.champion != null) phase = 'complete';
    return { meta, phase, fencers, ids, pools, bouts, scores, stats, rankIds, fin, bracket,
             done: bouts.filter(b => scores[b.id] && scores[b.id].sa != null).length,
             standings: fin ? FP.standings(fencers, bracket, rankIds, fin.q) : [] };
  }

  /** All actions. `store.data` is always the latest database tree. */
  class Service {
    constructor(store, refereeName) { this.store = store; this.refName = refereeName || (() => 'referee'); }
    get D() { return derive(this.store.data); }
    ref() { return String(this.refName() || 'referee').slice(0, 40); }
    static code() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }

    create(name) {
      return this.store.update({ meta: { name: String(name || 'FencingPool Open').slice(0, 60), phase: 'reg', cut: 20, table: 256, target: 7, draw: true, created: Date.now() } });
    }
    _need(phase) { const p = this.D.phase; if (p !== phase) return 'This needs the ' + phase + ' phase (now: ' + p + ').'; return null; }

    async addFencers(names) {
      const e = this._need('reg'); if (e) return { error: e };
      const D = this.D; names = names.map(s => String(s).trim()).filter(Boolean);
      if (!names.length) return { error: 'Type at least one name.' };
      if (names.some(n => n.length > 60)) return { error: 'Names can have at most 60 characters.' };
      if (D.ids.length + names.length > 265) return { error: 'Maximum is 265 fencers.' };
      let id = Math.max(0, ...D.ids), r = Math.max(0, ...D.ids.map(i => D.fencers[i].r)); const up = {};
      names.forEach(n => { id++; r++; up[keyOf('fencers/f', id)] = { n, r }; });
      await this.store.update(up); return { ok: true, added: names.length };
    }
    async clearFencers() { const e = this._need('reg'); if (e) return { error: e }; await this.store.update({ fencers: null }); return { ok: true }; }

    async startPools() {
      const e = this._need('reg'); if (e) return { error: e };
      const D = this.D; if (D.ids.length < 4) return { error: 'At least 4 fencers are needed.' };
      const seeded = D.ids.slice().sort((a, b) => D.fencers[a].r - D.fencers[b].r);
      const up = { 'meta/phase': 'pools' };
      FP.buildPools(seeded, D.meta.target).forEach((ids, i) => { up['pools/p' + String(i + 1).padStart(2, '0')] = ids.join(','); });
      await this.store.update(up); return { ok: true };
    }

    /** Saves a bout. `expV` = version the referee saw: if someone else saved first, nothing is overwritten. */
    async saveBout(kind, id, sa, sb, expV) {
      const D = this.D, pool = kind === 'pool';
      const e = this._need(pool ? 'pools' : 'de'); if (e) return { error: e };
      let a, b, err;
      if (pool) {
        const bo = D.bouts.find(x => x.id === id); if (!bo) return { error: 'Unknown bout.' };
        a = bo.a; b = bo.b; err = FP.poolScoreError(sa, sb, D.meta.draw);
      } else {
        const bo = D.bracket.byId[id]; if (!bo) return { error: 'Unknown bout.' };
        a = bo.a; b = bo.b; err = FP.deCorrectionError(D.bracket, bo, sa, sb);
      }
      if (err) return { error: err };
      const by = this.ref();
      const r = await this.store.transact((pool ? 'pb/' : 'de/') + id, cur => {
        if (((cur && cur.v) || 0) !== expV) return undefined;      // abort: stale
        return { sa, sb, v: expV + 1, by, at: Date.now(), a, b };
      });
      return r.committed ? { ok: true } : { conflict: true, error: 'Another referee changed this bout. Check the new score.' };
    }

    async finishPools(cutPct) {
      const e = this._need('pools'); if (e) return { error: e };
      const D = this.D; if (D.done < D.bouts.length) return { error: (D.bouts.length - D.done) + ' pool bouts are still to be fenced.' };
      let cut; try { cut = FP.splitCut(D.rankIds, cutPct); } catch (x) { return { error: x.message }; }
      if (cut.qualified.length > D.meta.table) return { error: 'Too many qualified fencers for the table.' };
      await this.store.update({ final: { rank: D.rankIds.join(','), q: cut.qualified.length, out: cut.eliminated.length, cut: cutPct, table: D.meta.table }, 'meta/phase': 'de', 'meta/cut': cutPct });
      return { ok: true, qualified: cut.qualified.length, eliminated: cut.eliminated.length, byes: D.meta.table - cut.qualified.length };
    }

    // ----- test tools -----
    async loadMock(n) { return this.addFencers(FP.mockNames(n, 1)); }
    async simulatePools() {
      const D = this.D; const res = FP.simulatePools(D.fencers, D.pools, 1), up = {};
      Object.keys(res).forEach(k => { if (!(D.scores[k] && D.scores[k].sa != null)) up['pb/' + k] = res[k]; });
      await this.store.update(up); return { ok: true };
    }
    async simulateDE() {
      const D = this.D; const res = FP.simulateDE(D.fencers, D.rankIds.slice(0, D.fin.q), D.fin.table, 1), up = {};
      Object.keys(res).forEach(k => { up['de/' + k] = res[k]; });
      await this.store.update(up); return { ok: true };
    }
  }

  return { LocalStore, FirebaseStore, Service, derive };
});
