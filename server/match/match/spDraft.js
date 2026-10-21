// server/match/match/spDraft.js — Match methods: the 机变 draft (SP_DRAFT: turn order, timers, AI picks, the card applied
// by choices.js applyCard), the personal bounty choice of the Art 教鞭 (offerBountyChoice / pickPersonalChoice /
// autoPickPersonalChoice: held by the player inside PREP — no phase, no timer of its own) and the rolls the meta effects
// ask for — bounties (addBounty), item ids (rollItemId) and choices.json pools (rollPool).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { generateDraft, applyCard, bountyBattles, isMultiRoundBounty, bountyCard } from '../choices.js';
import { onPickCard } from '../botEmotes.js';
import { weightedPick } from '../waves.js';
import { botPickCard } from '../bot.js';
import { OK, fail, DELAYS } from './common.js';
import { SQUAD_SIZE } from '../unite100.mjs';

/** Cards of the personal choice (PRTS 卫戍协议：盟约 下半 §法术 教鞭: "于3个战术特训的悬赏任务中选择一项"). */
const PERSONAL_OFFER_SIZE = 3;

export class MatchSpDraft {
  enterSpDraft() {
    // 机变按小队 (the > MAX_SEATS participants variant, [local-patch 2026-10-21]): each squad (the seats' floor(seat/4)
    // groups, unite100's SQUAD_SIZE) drafts its OWN six cards in parallel; every player sees only its squad's draft
    // (m.private.sp via MatchViews.spViewFor — no m.public.sp in this mode; one screen is still the official 3×2 of six).
    if (this.variant) { this._enterSpSquads(); return; }
    const draft = generateDraft(this.gd, this.rngDraft, this.round, { stageId: this.stageId, bondAvailable: (bondId) => this.bondLive(bondId), itemAvailable: id => this.itemPool.canGain(id) });
    const alive = this.alivePlayers();
    if (!draft || !alive.length) { this.beforePrepOffers(); return; }
    this.phase = PHASE.SP_DRAFT;
    let order = alive.map((p) => p.playerId);
    if (!this.isSolo) this.rngDraft.shuffle(order);
    // 「AI 队友最后选择」 (GitHub #338): humans before AI seats, after the same shuffle (MatchPhases.humansFirst)
    order = this.humansFirst(order);
    // untimed: solo and any single-human match (soloUntimed); the co-op order / 6 cards stay
    const untimed = this.soloUntimed;
    this.sp = { ...draft, order, idx: 0, picks: {}, taken: {}, untimed, turnDeadline: 0 };
    this.setDeadline(0);
    this.startSpTurn();
    this.markPublic();
  }

  spTurn() {
    const s = this.sp;
    if (!s) return null;
    return s.order[s.idx] ?? null;
  }

  spCardAvailable(card) { return !!card && this.sp?.taken[card.idx] == null && (card.kind !== 'item' || this.itemPool.canGain(card.id)); }

  startSpTurn() {
    const s = this.sp;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    while (s.idx < s.order.length) { // loop-cap: draft order
      const ps = this.players.get(s.order[s.idx]);
      if (ps && ps.alive && s.picks[ps.playerId] == null) break;
      s.idx++;
    }
    const available = s.cards.filter(c => this.spCardAvailable(c)).map(c => c.idx);
    if (s.idx >= s.order.length || !available.length) { this.setDeadline(0); this.later(0, () => this.finishSpDraft()); return; }
    const token = ++this._turnToken;
    if (!s.untimed) {
      const first = s.idx === 0;
      const secs = first ? this.gd.timer('spFirst') : this.gd.timer('spTurn');
      this.setDeadline(secs, () => {
        if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken) return;
        const ps = this.players.get(this.spTurn());
        if (!ps) return;
        const avail = s.cards.filter(c => this.spCardAvailable(c)).map(c => c.idx);
        if (!avail.length) { this.finishSpDraft(); return; }
        this._applyCard(ps, avail[Math.floor(this.rngDraft() * avail.length)]);
      });
      s.turnDeadline = this.deadline;
    } else {
      this.setDeadline(0);
    }
    const cur = this.players.get(this.spTurn());
    if (cur && cur.botControlled) this.scheduleSpBot();
    this.markPublic();
  }

  scheduleSpBot() {
    const token = this._turnToken;
    this.later(this.scaled(DELAYS.BOT_ACTION), () => {
      if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken || !this.sp) return;
      const ps = this.players.get(this.spTurn());
      if (!ps || !ps.botControlled) return;
      const avail = this.sp.cards.filter(c => this.spCardAvailable(c)).map(c => c.idx);
      if (!avail.length) return;
      this._applyCard(ps, botPickCard(this, ps, this.sp.cards, avail));
    });
  }

  pickCard(ps, idx) {
    if (this.phase !== PHASE.SP_DRAFT || (!this.sp && !this.spSquads)) return fail(ERR.WRONG_PHASE);
    if (Array.isArray(this.spSquads)) { // the variant: the pick lands in the player's own squad's draft only
      const sq = this.spSquadOf(ps);
      if (!sq) return fail(ERR.WRONG_PHASE);
      if (!ps.alive) return fail(ERR.ELIMINATED);
      if (sq.picks[ps.playerId] != null) return fail(ERR.ALREADY);
      if (sq.order[sq.idx] !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
      if (!Number.isInteger(idx) || idx < 0 || idx >= sq.cards.length) return fail(ERR.BAD_TARGET);
      if (!this._spAvail(sq, sq.cards[idx])) return fail(ERR.SOLD_OUT);
      this._applySpPick(ps, sq, idx);
      return OK;
    }
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.sp.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    if (this.spTurn() !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.sp.cards.length) return fail(ERR.BAD_TARGET);
    if (!this.spCardAvailable(this.sp.cards[idx])) return fail(ERR.SOLD_OUT);
    this._applyCard(ps, idx);
    return OK;
  }

  _applyCard(ps, idx) {
    const s = this.sp;
    if (!s || s.picks[ps.playerId] != null || !this.spCardAvailable(s.cards[idx])) return;
    const card = s.cards[idx];
    if (!card) return;
    s.picks[ps.playerId] = idx;
    s.taken[idx] = ps.playerId;
    try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
    this.markPrivate(ps);
    this.markPublic();
    onPickCard(this, ps, card); // AI bots say "思考" when they take a bounty (enabled by default; SP_BOT_EMOTES=0 silences it)
    this.startSpTurn();
  }

  finishSpDraft() {
    if (this.phase !== PHASE.SP_DRAFT) return;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    if (Array.isArray(this.spSquads)) for (const sq of this.spSquads) this.cancel(sq._timer);
    this.beforePrepOffers();
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // 机变按小队 (the > MAX_SEATS participants variant, [local-patch 2026-10-21]; the design item B of
  // docs/PS100-MIGRATION.md §10-C, scoped to squads of SQUAD_SIZE seats): per-squad six-card drafts run in
  // parallel, one FieldRunner-style turn chain each; a card is gone only within its own squad. The viewer's
  // squad draft reaches it as m.private.sp (MatchViews.spViewFor) — m.public carries none, so no frame can
  // leak another squad's cards. Turn countdowns are per squad: the state carries `turnDeadline` and the
  // client reads it from the private frame (m.public.deadline stays 0; the phase cannot be paused here —
  // g.pause is a solo-only offer and a variant match has ≥ 5 participants by definition).

  /** A card of the squad's draft still pickable: untaken within the squad and (an item card) gainable. */
  _spAvail(s, card) { return !!card && s?.taken[card.idx] == null && (card.kind !== 'item' || this.itemPool.canGain(card.id)); }

  /** The viewer's own squad's draft state (the variant; null in the shared draft or outside the phase). */
  spSquadOf(ps) {
    if (this.phase !== PHASE.SP_DRAFT || !Array.isArray(this.spSquads)) return null;
    const k = Number.isInteger(ps && ps.seat) && ps.seat >= 0 ? Math.floor(ps.seat / SQUAD_SIZE) : -1;
    return this.spSquads.find((sq) => sq.squad === k) || null;
  }

  _enterSpSquads() {
    this.phase = PHASE.SP_DRAFT;
    const groups = new Map();
    for (const ps of [...this.order].sort((a, b) => a.seat - b.seat)) {
      const k = Number.isInteger(ps.seat) && ps.seat >= 0 ? Math.floor(ps.seat / SQUAD_SIZE) : -1;
      if (k < 0) continue;
      const list = groups.get(k);
      if (list) list.push(ps); else groups.set(k, [ps]);
    }
    const list = [];
    for (const [squad, members] of groups) {
      const draft = generateDraft(this.gd, this.rngDraft, this.round, { stageId: this.stageId, bondAvailable: (bondId) => this.bondLive(bondId), itemAvailable: (id) => this.itemPool.canGain(id) });
      if (!draft || !members.some((p) => p.alive)) continue;
      let order = members.filter((p) => p.alive).map((p) => p.playerId);
      if (!this.isSolo) this.rngDraft.shuffle(order);
      // 「AI 队友最后选择」 (GitHub #338), per squad
      order = this.humansFirst(order);
      list.push({ squad, ...draft, order, idx: 0, picks: {}, taken: {}, untimed: !!this.soloUntimed, turnDeadline: 0, done: false, _timer: null, _token: 0 });
    }
    this.spSquads = list;
    if (!list.length) { this.beforePrepOffers(); return; }
    this.setDeadline(0);
    for (const sq of list) this._startSpSquadTurn(sq);
    this.markPublic();
  }

  _startSpSquadTurn(sq) {
    this.cancel(sq._timer);
    sq._timer = null;
    while (sq.idx < sq.order.length) { // loop-cap: the squad's draft order
      const ps = this.players.get(sq.order[sq.idx]);
      if (ps && ps.alive && sq.picks[ps.playerId] == null) break;
      sq.idx++;
    }
    const available = sq.cards.filter((c) => this._spAvail(sq, c)).map((c) => c.idx);
    if (sq.idx >= sq.order.length || !available.length) {
      sq.done = true;
      sq.turnDeadline = 0;
      for (const pid of sq.order) { const ps = this.players.get(pid); if (ps) this.markPrivate(ps); }
      this._maybeFinishSpSquads();
      return;
    }
    const token = ++sq._token;
    if (!sq.untimed) {
      const secs = sq.idx === 0 ? this.gd.timer('spFirst') : this.gd.timer('spTurn');
      const ms = this.scaled(secs * 1000);
      sq.turnDeadline = this.sched.now() + ms;
      sq._timer = this.later(ms, () => {
        if (this.phase !== PHASE.SP_DRAFT || !Array.isArray(this.spSquads) || token !== sq._token) return;
        const ps = this.players.get(sq.order[sq.idx]);
        if (!ps) return;
        const avail = sq.cards.filter((c) => this._spAvail(sq, c)).map((c) => c.idx);
        if (!avail.length) { this._maybeFinishSpSquads(); return; }
        this._applySpPick(ps, sq, avail[Math.floor(this.rngDraft() * avail.length)]);
      });
    } else {
      sq.turnDeadline = 0;
    }
    const cur = this.players.get(sq.order[sq.idx]);
    if (cur && cur.botControlled) this._scheduleSpSquadBot(sq);
    for (const pid of sq.order) { const ps = this.players.get(pid); if (ps) this.markPrivate(ps); }
    this.markPublic();
  }

  _maybeFinishSpSquads() {
    if (this.phase !== PHASE.SP_DRAFT || !Array.isArray(this.spSquads)) return;
    if (this.spSquads.every((x) => x.done)) { this.setDeadline(0); this.later(0, () => this.finishSpDraft()); }
  }

  _scheduleSpSquadBot(sq) {
    const token = sq._token;
    this.later(this.scaled(DELAYS.BOT_ACTION), () => {
      if (this.phase !== PHASE.SP_DRAFT || !Array.isArray(this.spSquads) || token !== sq._token) return;
      const ps = this.players.get(sq.order[sq.idx]);
      if (!ps || !ps.botControlled) return;
      const avail = sq.cards.filter((c) => this._spAvail(sq, c)).map((c) => c.idx);
      if (!avail.length) return;
      this._applySpPick(ps, sq, botPickCard(this, ps, sq.cards, avail));
    });
  }

  _applySpPick(ps, sq, idx) {
    if (!sq || sq.picks[ps.playerId] != null || !this._spAvail(sq, sq.cards[idx])) return;
    const card = sq.cards[idx];
    if (!card) return;
    sq.picks[ps.playerId] = idx;
    sq.taken[idx] = ps.playerId;
    try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
    this.markPrivate(ps);
    this.markPublic();
    onPickCard(this, ps, card); // AI bots say "思考" when they take a bounty (enabled by default; SP_BOT_EMOTES=0 silences it)
    this._startSpSquadTurn(sq);
  }

  /**
   * 教鞭 (content/items/meta.js, ctx.offerBountyChoice): the Art opens a PERSONAL choice (act2autochess choice event
   * `hunter_band_1`, choiceType PERSONAL_CHOOSE) between up to three of `candidates` — drawn once from the meta rng, kept in
   * `ps.personalChoice` (m.private only) until the owner confirms one with `g.choice { idx, choiceId }`. It lives inside
   * PREP: no phase of its own and no timer — the prep's deadline resolves it (prepDeadline), Ready is refused while it is
   * pending (PlayerPrep.setReady). Refused — before an rng draw or an id is used, so the Art stays in the hand — when it
   * is not the player's PREP, a choice is already open or no card is left to offer.
   * @param {import('../PlayerState.js').PlayerState} ps @param {any[]} candidates cards.bounty entries
   * @param {string} sourceItemId the Art
   */
  offerBountyChoice(ps, candidates, sourceItemId) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    if (ps.personalChoice) return fail(ERR.BAD_TARGET, '请先完成当前教鞭选择'); // i18n-ignore: developer error detail
    if (!candidates.length) return fail(ERR.BAD_TARGET, '当前没有可用的战术特训'); // i18n-ignore: developer error detail
    const cards = this.rngMeta.shuffle(candidates.slice()).slice(0, PERSONAL_OFFER_SIZE);
    ps.personalChoice = { id: `${this.battlePrefix}.choice.${this.nextUid()}`, round: this.round, sourceItemId, cards };
    ps.dirty();
    return OK;
  }

  /** g.choice { idx, choiceId }: the owner's pick of its open personal choice — the card becomes a bounty on its next battles. */
  pickPersonalChoice(ps, idx, choiceId) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    const pending = ps.personalChoice;
    if (!pending || pending.id !== choiceId || pending.round !== this.round) return fail(ERR.BAD_TARGET);
    if (!Number.isInteger(idx) || idx < 0 || idx >= pending.cards.length) return fail(ERR.BAD_TARGET);
    if (!this.addBounty(ps, pending.cards[idx])) return fail(ERR.BAD_TARGET);
    ps.personalChoice = null;
    ps.dirty();
    return OK;
  }

  /**
   * The pick made for a player who did not make it. 'bot': an AI seat or a human under AI 托管 — the bounty scorer of the
   * 机变 draft (bot.js botPickCard: the expected pay minus the expected LP lost against the own board, the bots' seeded rng
   * only breaks ties); 'random': the prep's deadline and a seat the engine finishes by other means — one of the cards at
   * random from the meta rng, like a 机变 turn that runs out. Nothing pending: nothing happens, no rng draw.
   */
  autoPickPersonalChoice(ps, mode) {
    const pending = ps.personalChoice;
    if (!pending) return undefined;
    const indices = pending.cards.map((c, i) => i);
    const idx = mode === 'bot'
      ? botPickCard(this, ps, pending.cards.map((c) => bountyCard(this.gd, c)), indices)
      : this.rngMeta.pick(indices);
    return this.pickPersonalChoice(ps, idx, pending.id);
  }

  addBounty(ps, card) {
    if (!ps || !card || !this.gd.enemy(card.enemyKey)) return null;
    // a multi-round card lasts MULTI_ROUND_BOUNTY_BATTLES battles (choices.js; the user's call after playtest #6)
    const rounds = bountyBattles(card);
    const b = {
      id: `bounty:${this.nextUid()}`,
      card: { effectId: card.effectId ?? card.id ?? null, name: card.name ?? '悬赏', desc: card.desc ?? '', tier: card.tier ?? 1, coin: Math.max(0, Math.trunc(Number(card.coin) || 0)), payout: card.payout === 'perfect' ? 'perfect' : 'kill', rounds, multiRound: isMultiRoundBounty(card), enemyKey: card.enemyKey, count: Math.max(1, Math.min(20, Number.isInteger(card.count) ? card.count : 1)) }, // i18n-ignore: a data-less card's fallback name
      roundsLeft: rounds,
    };
    ps.bounties.push(b);
    ps.dirty();
    return b.id;
  }

  /** Random item id: a choices.json server pool ({ pool }), a tier, or ≤ maxTier shop-eligible items.
   * `also` (pool_equip_kathe: 突变细胞) joins the draw even though it is shopExcluded. The shop item slot does not
   * read it. `pick` still drops ids that `canGain` refuses, so an empty shop item stays out and an uncapped `also`
   * id can still be drawn. `exclude` removes ids before sampling (Cathy's match-long allowance / distinct choices). */
  rollItemId({ pool = null, tier = null, maxTier = 6, shopLevel = 6, exclude = [] } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof pool === 'string' && Object.hasOwn(pools, pool) ? pools[pool] : null;
    const rng = this.rngMeta;
    const pick = (ids, weights = null) => this.itemPool.pick(rng, ids.filter((id) => !exclude.includes(id)), weights);
    const tierList = (lo, hi) => { const out = []; for (let t = lo; t <= hi; t++) for (const id of this.gd.shopItemsByTier[t] || []) out.push(id); return out; };
    const also = p && Array.isArray(p.also) ? p.also.filter((id) => typeof id === 'string' && this.gd.item(id)) : [];
    const withAlso = (list) => {
      const out = list.slice();
      for (const id of also) if (!out.includes(id)) out.push(id);
      return out;
    };
    if (p && p.kind === 'equip') {
      if (Array.isArray(p.weighted) && p.weighted.length) {
        const pairs = p.weighted.filter((x) => Array.isArray(x) && this.gd.item(x[0]) && this.itemPool.canGain(x[0]));
        for (const id of also) if (!pairs.some((x) => x[0] === id)) pairs.push([id, 1]);
        return pick(pairs.map(x => x[0]), new Map(pairs));
      }
      if (Array.isArray(p.items) && p.items.length) {
        const items = p.items.filter((id) => this.gd.item(id));
        return pick(withAlso(items));
      }
      let list;
      if (Array.isArray(p.tiers) && p.tiers.length) list = p.tiers.flatMap((t) => this.gd.shopItemsByTier[t] || []);
      else list = tierList(1, p.maxTier === 'shopLevel' ? Math.max(1, Math.min(6, shopLevel)) : 6);
      return pick(withAlso(list));
    }
    const list = Number.isInteger(tier) ? tierList(tier, tier) : tierList(1, Math.max(1, Math.min(6, maxTier)));
    return pick(list);
  }

  /**
   * Roll a choices.json pool (ctx.rollPool). Equip pools → rollItemId. Chess pools: an `items` (uniform) or `weighted`
   * list — only chess with a free pool copy (or outside the pool) qualify — else a copy-weighted draw from the shared
   * pool filtered by `tier` / `minTier` / `maxTier` (number or 'shopLevel') / `bond`; `golden: true` yields the elite id.
   * `extra` (the drawing player's 自选 stock, player/diy.js diyStockEntries) joins that shared-pool draw, `chessOf` reads the
   * bonds (the player's data view: a slotted slot's operator) — 0.2.0 WE2. `pool` is the DRAW SOURCE: the match's shared
   * pool by default, the DRAWING player's own pool in the 100-seat variant (player/rules.js mainPool —
   * docs/PS100-MIGRATION.md §10-A; the identical object when the switch is off).
   * @returns {{ kind: 'item'|'chess', id: string, golden?: boolean } | null}
   */
    rollPool(poolId, { shopLevel = 6, extra = null, chessOf = null, pool = null, exclude = [] } = {}) {
      const src = pool || this.pool;
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof poolId === 'string' && Object.hasOwn(pools, poolId) ? pools[poolId] : null;
    if (!p || typeof p !== 'object') return null;
    const lvl = Math.max(1, Math.min(6, Number.isInteger(shopLevel) ? shopLevel : 6));
    if (p.kind === 'equip') {
      const id = this.rollItemId({ pool: poolId, shopLevel: lvl, exclude });
      return id ? { kind: 'item', id } : null;
    }
    if (p.kind !== 'chess') return null;
    const rng = this.rngMeta;
    const free = (id) => {
      if (typeof id !== 'string' || !this.gd.chess(id)) return false;
      const base = this.gd.baseIdOf(id);
      return !src.has(base) || src.left(base) > 0;
    };
    let id = null;
    if (Array.isArray(p.weighted) && p.weighted.length) {
      const pairs = p.weighted.filter((x) => Array.isArray(x) && free(x[0]));
      id = pairs.length ? weightedPick(rng, pairs) : null;
    } else if (Array.isArray(p.items) && p.items.length) {
      const list = p.items.filter(free);
      id = list.length ? list[Math.floor(rng() * list.length)] : null;
    } else {
      const maxTier = p.maxTier === 'shopLevel' ? lvl : Number.isInteger(p.maxTier) ? p.maxTier : 6;
      const minTier = Number.isInteger(p.minTier) ? p.minTier : 1;
      const bond = typeof p.bond === 'string' ? p.bond : null;
      const recOf = typeof chessOf === 'function' ? chessOf : (cid) => this.gd.chess(cid);
      id = src.roll(rng, {
        tier: Number.isInteger(p.tier) ? p.tier : null,
        maxTier,
        filter: (cid, e) => e.tier >= minTier && (!bond || (Array.isArray(recOf(cid)?.bonds) && recOf(cid).bonds.includes(bond))),
        extra,
      });
    }
    if (!id) return null;
    const golden = !!p.golden;
    return { kind: 'chess', id: golden ? this.gd.goldenIdOf(id) || id : id, golden };
  }
}
