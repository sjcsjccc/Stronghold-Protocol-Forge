// server/match/match/intents.js — Match methods: the g.* / b.* intent router (_handle: the prep intents go to
// PlayerState, the drafts, watching, the pause and the battle reports to the match), emotes, AI 托管 (setAutoplay,
// kickBot) and g.unitStats (the stats the board's units start their next battle with: a preview battle, started, read
// and dropped).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { unitStatsEntry } from '../../../shared/protocol.js';
import { PHASE, ERR, EMOTES, EMOTE_COOLDOWN_MS, GEO } from '../../../shared/constants.js';
import { deriveSeed } from '../../sim/rng.js';
import { OK, fail } from './common.js';
import { onHumanEmote } from '../botEmotes.js';

export class MatchIntents {
  _handle(ps, msg) {
    switch (msg.t) {
      case 'g.infoReady':
        if (this.phase !== PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE);
        if (this.setupVote) return fail(ERR.WRONG_PHASE, 'setup reroll vote in progress');
        if ((msg.setupRevision ?? 0) !== this.setupRevision) return fail(ERR.BAD_TARGET, 'setup changed; confirm the current revision');
        if (!ps.infoReady) { ps.infoReady = true; this.markPublic(); this.maybeEndInfo(); }
        return OK;
      case 'g.rerollVote': return this.voteSetupReroll(ps, msg.voteId, msg.agree);
      case 'g.band': return this.pickBand(ps, msg.bandId);
      case 'g.bandSkip': return this.skipBand(ps);
      // the strategy highlighted in the draft screen (what a timed-out turn takes, timeoutBand)
      case 'g.bandFocus': return this.bandFocus(ps, msg.bandId ?? null);
      case 'g.buy': return ps.buy(msg.slot);
      case 'g.refresh': return ps.refresh();
      case 'g.freeze': return ps.freeze();
      case 'g.levelUp': return ps.levelUp();
      case 'g.sell': return ps.sell(msg.uid);
      // dir: the deploy wheel's facing (DESIGN §3; absent ⇒ PlayerState reads to.dir, then RIGHT)
      case 'g.move': return ps.move(msg.uid, msg.to, msg.dir);
      case 'g.equip': return ps.equip(msg.itemUid, msg.targetUid, msg.replaceUid ?? null);
      case 'g.art': return ps.useArt(msg.itemUid, msg.row, msg.col, msg.dir);
      case 'g.destroy': return ps.destroy(msg.uid);
      // 装备拆卸（行为开关 `unequip: "allow"`，DESIGN §28.43.1）：把一件已装备的装备退回手牌 / 临时整备区。
      // 缺省档下 `PlayerState.unequip` 回的就是 `destroy` 那句 `'equipped items are locked'` ⇒ 这一行在缺省档与
      // 「意图不存在」**行为等价**。
      case 'g.unequip': return ps.unequip(msg.itemUid);
      case 'g.reward': return ps.pickReward(msg.idx);
      // [local-patch 2026-10-22] 超限的词条抉择 / 战术撤退 / 战斗内倍速开关（traitDraft.js / phases.js）
      case 'g.traitChoice': return this.pickTrait(ps, msg.idx);
      case 'g.traitRetreat': return this.retreatNow(ps);
      case 'g.combatSpeed': return this.setCombatSpeed(ps, msg.speed);
      case 'g.choice': return msg.choiceId !== undefined
        ? this.pickPersonalChoice(ps, msg.idx, msg.choiceId)
        : this.pickCard(ps, msg.idx);
      // a plugin interaction window (PLUGIN API v2, docs/PLUGINS.md §10b): the window's own id, not a draft card —
      // the host applies the declared primitive, a plugin never reaches the match state itself
      case 'g.offer': return this.requestOffer(ps, msg.offerId, msg.idx, msg);
      case 'g.offerRefresh': return this.requestOfferRefresh(ps, msg.offerId, msg.idx, msg);
      case 'g.ready': return ps.setReady(!!msg.ready);
      case 'g.emote': return this.emote(ps, msg.id);
      // playerId: the player tapped (a shared field names two) — the watch preference (item 56)
      case 'g.watch': return this.watch(ps, msg.fieldId, msg.playerId ?? null);
      case 'g.autoplay': return this.setAutoplay(ps, !!msg.on);
      case 'g.pause': return this.setPause(ps, !!msg.on);
      // the stats the board's units start their next battle with (the detail card in prep, user playtest #4 item 7)
      case 'g.unitStats': return this.unitStats(ps, msg.seq ?? null);
      // [local-patch 2026-10-20] the shared chess pool's remaining counts (the client's pool panel)
      case 'g.pool': return this.poolView(ps);
      // [local-patch 2026-10-21] 房主对局倍速：全房真人与 AI 统一节奏（仅房主）
      case 'g.matchSpeed': return this.setMatchSpeed(ps, msg.rate);
      case 'g.leave': this.onLeave(ps.playerId); return OK;
      // the client could not merge an incremental m.public frame and asks for the full one again
      // (DESIGN §8.2 "incremental frame", the self-healing ask; shared/protocol.js 'g.publicFull')
      case 'g.publicFull': return this.resendPublic(ps.playerId);
      case 'g.test': return this.applyTestCommand(ps, msg);
      case 'b.progress': return this._onProgress(ps, msg);
      case 'b.result': return this._onResult(ps, msg);
      // the host's answer to a delegated bot layout rehearsal (DESIGN §14): a report, never an error — an unknown,
      // expired or foreign task is ignored (MatchRehearsal._onRehearsalResult)
      case 'b.rehearsalResult': this._onRehearsalResult(ps, msg); return OK;
      default: return fail(ERR.BAD_MSG);
    }
  }

  emote(ps, id) {
    if (!EMOTES.includes(id)) return fail(ERR.BAD_MSG, 'unknown emote');
    const now = this.sched.now();
    // [local-patch 2026-10-22] a spectator seat may emote too: its stand-in (watch.js _spectator) is frozen — no
    // lastEmoteAt to write, so the cooldown lives on the match keyed by the seat's id; no AI reacts to a spectator.
    if (ps.spectator) {
      if (now - (this.spectatorEmoteAt.get(ps.playerId) ?? -Infinity) < EMOTE_COOLDOWN_MS) return fail(ERR.RATE);
      this.spectatorEmoteAt.set(ps.playerId, now);
      this.broadcast({ t: 'm.emote', playerId: ps.playerId, id });
      return OK;
    }
    if (now - ps.lastEmoteAt < EMOTE_COOLDOWN_MS) return fail(ERR.RATE);
    ps.lastEmoteAt = now;
    this.broadcast({ t: 'm.emote', playerId: ps.playerId, id });
    // an AI teammate can react to a human's emote (enabled by default: server/match/botEmotes.js, SP_BOT_EMOTES=0 silences it)
    onHumanEmote(this, ps.playerId, id);
    return OK;
  }

  setAutoplay(ps, on) {
    if (ps.autoplay === on) return OK;
    ps.autoplay = on;
    this.markPublic();
    if (on) this.kickBot(ps);
    return OK;
  }

  /** Let the bot act for a (newly) bot-controlled seat in the current phase. */
  kickBot(ps) {
    if (!ps.botControlled || this.ended) return;
    this.offersChanged();
    if (this.phase === PHASE.INFO_CHECK && !ps.infoReady) { ps.infoReady = true; this.markPublic(); this.maybeEndInfo(); }
    else if (this.phase === PHASE.BAND_DRAFT && this.draftTurn() === ps.playerId) this.scheduleBandBot();
    else if (this.phase === PHASE.SP_DRAFT && this.spTurn() === ps.playerId) this.scheduleSpBot();
    else if (this.phase === PHASE.PREP && ps.alive && !ps.ready) this.scheduleBotPrep(ps, 0);
  }

  /**
   * g.unitStats { seq? } (user playtest #4 item 7: the detail card showed fixed record stats): the stats every unit of
   * the player's board will fight with at the start of its next battle — equipment, bonds and their layers, 特质, the
   * band and 机变 effects — computed exactly by the shared sim. The player's battle input after the onBattleStart meta
   * handlers (`ev.preview: true`, no enemies — those handlers must not change the match for a preview) builds a Battle
   * of the battle's options that is started (initial deployment + battleStart hooks), read and dropped: it is never
   * stepped: deployment skills contribute their initial stats but their timers do not advance. No SP / skill timer is
   * sent, and the real battle gets fresh units. Pushed to the player as `m.unitStats { seq, round, units }`
   * (units: shared/protocol.js unitStatsEntry, board operators and summons by uid); cached per input (a build costs
   * ≈ 0.3–0.7 ms). Prep phases only (ROUND_START, 机变, PREP); a battle's live stats come from the browser's own sim.
   * @param {PlayerState} ps @param {number|null} seq echoed (the client keeps the newest answer)
   */
  unitStats(ps, seq = null) {
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.phase !== PHASE.ROUND_START && this.phase !== PHASE.SP_DRAFT && this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    const units = this._unitStatsOf(ps);
    this.sendTo(ps.playerId, { t: 'm.unitStats', seq: Number.isInteger(seq) ? seq : null, round: this.round, units });
    return OK;
  }

  /**
   * [local-patch 2026-10-20] g.pool {} — the shared chess pool's live occupancy, pushed to the requester as
   * `m.pool { round, pool }` with `pool = { [baseId]: { cap, left, support? } }` (a snapshot of SharedPool.entries:
   * every eligible visible chess of this match; a piece brought as 助战 carries `support`). Read-only and
   * phase-independent — safe to ask at any point of the match; the client's pool panel refreshes on demand.
   * @param {PlayerState} ps
   */
  poolView(ps) {
    // [local-patch 2026-10-21] read the REQUESTER's own pool (PlayerRules.mainPool): in the > MAX_SEATS variant every
    // player draws from a per-player pool and `m.pool` is only the canonical catalog — showing it here froze the
    // counts (the user report: 买了卡面板数字不动). ≤ MAX_SEATS mainPool() returns m.pool, unchanged.
    const pool = {};
    for (const [baseId, e] of ps.mainPool().entries) {
      if (!e || !(e.cap > 0)) continue;
      pool[baseId] = { cap: e.cap, left: Math.max(0, e.left), ...(e.support ? { support: true } : {}) };
    }
    this.sendTo(ps.playerId, { t: 'm.pool', round: this.round, pool });
    return OK;
  }

  /**
   * [local-patch 2026-10-21] g.matchSpeed { rate 1–4 } — 房主对局倍速：把 `gameSpeed` 设为 基速(官方 2×) × rate，
   * 全房统一加速——真人场的截止/回放基速、AI/托管场的战果释放、BOSS pacer 全部从这一个值派生。节奏只改
   * 「墙钟→tick」映射，tick 序列与战果一字不变。已在飞的计时器由 clientCombat.rearmFieldTimers 按新速度重排
   * （只重排服务端代跑场的释放；真人当前一场照旧打完，下一场起用新速度）。仅房主；对局结束/重开归 1。
   * @param {PlayerState} ps @param {number} rate
   */
  setMatchSpeed(ps, rate) {
    if (this.ended || this.disposed) return fail(ERR.WRONG_PHASE);
    // [local-patch 2026-10-22] 超限局不走房主倍速：它有自己的战斗内 1×/2× 开关（phases.js setCombatSpeed），
    // 两条速度链会互相覆盖 —— 超限房里房主倍速按钮保持无效。
    if (this.isInfinite) return fail(ERR.WRONG_PHASE, 'the overlimit match uses its own combat speed switch');
    if (!this.hostId || ps.playerId !== this.hostId) return fail(ERR.NOT_HOST);
    if (!Number.isInteger(rate) || rate < 1 || rate > 4) return fail(ERR.BAD_MSG);
    if (rate === this.matchRate) return OK;
    this.matchRate = rate;
    this.gameSpeed = this._combatSpeedBase * rate;
    this.rearmFieldTimers?.();
    this.log.info?.(`[match ${this.roomCode}] R${this.round}: host ${ps.playerId} set match speed ×${rate} (gameSpeed ${this.gameSpeed})`);
    return OK;
  }

  /** The start-of-battle stats of a player's board units (see unitStats); [] when the preview battle cannot be built. */
  _unitStatsOf(ps) {
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    const ev = { input, kind: 'normal', round: this.round, preview: true };
    this.dispatch(ps, 'onBattleStart', ev);
    const players = [ev.input && typeof ev.input === 'object' ? ev.input : input];
    let key = null;
    try { key = JSON.stringify([this.round, this.stageId, this.battleContent, players]); } catch { key = null; }
    if (!this._unitStatsCache) this._unitStatsCache = new WeakMap(); // PlayerState → { key, units } (the last preview)
    const cached = this._unitStatsCache.get(ps);
    if (key && cached && cached.key === key) return cached.units;
    const units = [];
    // the flags of the battle it previews: a normal round gains IN_BATTLE layers from its start (a <战斗开始时> layer gain
    // raises bond stats at t = 0 there too); the Final Assault / Hidden Core fight without (previewed as a normal field)
    const bossRound = this.round === this.gd.bossRound || this.round === this.gd.hiddenRound;
    const b = this.newBattle({
      seed: deriveSeed(this.seed, `preview:${this.round}:${ps.seat}`), kind: 'normal', modeId: this.modeId, round: this.round,
      stageId: this.stageId, rect: { ...this.layout.battle.normal }, timeLimit: 60, players, spawns: [], routes: this.wave ? this.wave.routes : [],
      sharedBoss: null, flags: this._rmSpecFlags({ layerGainsEnabled: !bossRound, ...this.gd.dp, ...(this.isInfinite ? { overlimit: true } : {}) }), fieldId: `n:${ps.playerId}`, recordEvents: false,
    });
    try {
      if (typeof b.start === 'function') b.start();
      for (const u of Array.isArray(b.allyUnits) ? b.allyUnits : []) {
        if (u && Number.isInteger(u.uid) && (u.kind === 'op' || u.kind === 'token')) units.push(unitStatsEntry(u, u.s));
      }
    } catch (e) { this.reportError('unitStats', e); }
    this._unitStatsCache.set(ps, { key, units });
    return units;
  }
}
