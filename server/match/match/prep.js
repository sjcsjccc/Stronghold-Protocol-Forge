// server/match/match/prep.js — Match methods: the PREP phase — its start (deferred item merges, onPrepStart), the AI
// seats' sliced preps (scheduleBotPrep: economy + layout, rehearsal, Ready), Ready and the deadline, and its end
// (onPrepEnd, PlayerState.endPrep, then COMBAT or the Final Assault / Hidden Core).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE } from '../../../shared/constants.js';
import { isInfiniteBossRound } from '../infiniteWaves.js'; // [local-patch 2026-10-22]（botPrep* 导入随上游 0.3.2 的 this.bot.prepBegin/prepEnd 策略对象化而废弃）
import { testSlice } from '../testTrace.js';
import { DELAYS } from './common.js';

export class MatchPrep {
  enterPrep() {
    this.phase = PHASE.PREP;
    this.sp = null;
    const alive = this.alivePlayers();
    for (const ps of alive) {
      ps.ready = false;
      // Items gained as the previous prep ended waited unmerged (acquireItem deferMerge). Merge them now, before
      // this prep's onPrepStart grants and before the player acts — not in endPrep, which runs in the same prep
      // that granted them and would take an equipped copy off for the fight about to start.
      ps.checkItemMerges();
      ps.recompute();
      this.dispatch(ps, 'onPrepStart', { round: this.round });
      ps.recompute();
    }
    // A co-op room waits for every alive seat's Ready (maybeEndPrep), so a human able to press it must have a
    // deadline — otherwise that human's silence stalls the match forever (docs/PS100-MIGRATION.md §5).
    // [local-patch 2026-10-20] the lone-human co-op room (1 真人 + N AI) is untimed here as well now
    // (prepDeadlineSeconds keys off `soloUntimed`): its only human ends the prep by pressing Ready, and the
    // 25 s `prepFallbackGuard` arm below no longer fires for it.
    //
    // The round's own prepTime decides 0 vs a deadline, exactly as before: a round that declares `prepTime: null`
    // means UNTIMED and stays untimed (the config is the authority on whether this round is timed at all — the
    // zero-delay ordering of `verification-slices.test.js` depends on it). The `infoCheck` 25 s guard is used ONLY
    // for the lone-human room, and never to time a round the data leaves untimed for anyone else.
    this.setDeadline(this.prepDeadlineSeconds(), () => this.prepDeadline());
    let i = 0;
    for (const ps of alive) if (ps.botControlled) this.scheduleBotPrep(ps, i++);
    this.markPublic();
    this.maybeEndPrep();
  }

  /**
   * Seconds of this round's prep deadline (null = untimed). The SINGLE definition of the rule, so the prep and the
   * `attachAudit` check can never drift apart:
   *
   *   * solo, any room with no seat able to press Ready, and — [local-patch 2026-10-20] — the lone-human co-op
   *     room (1 human + AI teammates, `soloUntimed`) → null: nobody waits on anybody; the lone human ends the
   *     prep with their own Ready press, so their silence can stall only their own run;
   *   * a co-op room with ≥2 humans and a round that declares a `prepTime` → that value (upstream behaviour);
   *   * otherwise → null: the data left this round untimed and it stays untimed. The old lone-human
   *     `prepFallbackGuard` arm (25 s `timers.infoCheck`) is unreachable since the patch and is kept only so a
   *     revert is a one-token change.
   *
   * @returns {number|null}
   */
  prepDeadlineSeconds() {
    // 维护者口径（与 infra.js `soloUntimed` 的注释同一条）：**历史版本的 solo 走它自己的计时** ——
    // `config.version.rules.soloTimed === true` 就是"这一期的 solo 有时限"，此时 prep 也要计时；
    // 「不限时」打开、或该版本没有这个字段（今天的默认版本）时才是 null。
    // 注意不能写成 `if (this.isSolo) return null` —— 那会把历史版本的 solo 计时一起关掉。
    // [local-patch 2026-10-20] 也不加 `isSolo` 门：合并后的 soloUntimed getter 在「1 真人 + N AI」的
    // 盟房（loneHuman 分支）也为真，那正是补丁④要免计时的形状；solo 分支的真值已由 getter 里的
    // 版本规则把关（soloTimed 未开「不限时」→ false → prep 照计时）。
    if (this.soloUntimed) return null;
    const declared = this.gd.prepTime(this.round);
    if (declared != null) return declared;
    return this.prepFallbackGuard ? this.gd.timer('infoCheck') : null;
  }

  /**
   * The bot plays a prep in three stages, every one in slices of ≤ botSliceMs wall-clock ms (one scheduler callback
   * each, so other rooms' battles and every player's requests keep flowing): economy + the default layout
   * (bot.js botPrepBeginSteps — shop decisions and layout planning, 50–120 ms late in a 4-bot match), the layout
   * rehearsal (whole simulated battles, 0.2–1 s of CPU per bot late in a match), then botPrepEndSteps (the rehearsed
   * layout, temp, Ready). The step generators run the same actions in the same order as the one-shot routine (same
   * rng draws, same decisions); in virtual time (botSliceMs unbounded) each stage runs at once. The prep ending first
   * (deadline) or a newer schedule for the seat drops the job (a step never leaves a transient board behind).
   * A rehearsal offered to the host's browser (botRehearsalDelegate, DESIGN §14 — AI teammates only) is not stepped
   * here: the job stays `pending` until MatchRehearsal accepts the host's pick (`done`, the layout ready to apply) or
   * takes it over, and only a takeover runs `job.run` — the server's slices, never a second simulation of what the host
   * already ran; a pick accepted before this driver subscribed to the job is applied just the same (`job.done`). Either
   * outcome is applied once the generator that offered the task has finished — it still places the default layout after
   * the delegation — which is why the continuation is installed here and not with the frame.
   */
  scheduleBotPrep(ps, i = 0) {
    const round = this.round;
    const token = (ps._botPrepToken = (ps._botPrepToken || 0) + 1);
    const valid = () => this.phase === PHASE.PREP && this.round === round && ps.alive && !ps.ready && ps.botControlled && ps._botPrepToken === token;
    const bounded = Number.isFinite(this.botSliceMs);
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // Test replay ignores the wall clock and stops after the journalled step count (testSlice).
    const sliceCtl = testSlice(this);
    /** Step a generator until done or the slice budget is used; `then(value)` once it is done (null on an error). */
    const drive = (gen, label, then) => {
      const t0 = now();
      let r = null;
      try {
        do {
          r = gen.next();
          if (!r || typeof r.done !== 'boolean') throw new TypeError('Bot prep hooks must return a synchronous iterator');
          if (sliceCtl) sliceCtl.note(1);
        } while (!r.done && !(sliceCtl ? sliceCtl.wall(now() - t0, this.botSliceMs) : (bounded && now() - t0 >= this.botSliceMs))); // loop-cap: generator and the bot time slice
      } catch (e) {
        this.reportError(`bot ${ps.playerId}${label}`, e);
        then(null);
        return;
      }
      if (r.done) { then(r.value); return; }
      this.later(0, () => { if (valid()) drive(gen, label, then); });
    };
    const ready = () => {
      if (!ps.ready) {
        this.autoPickPersonalChoice(ps, 'random');
        ps.resolveTemp();
        ps.setReady(true);
      }
    };
    const end = (job) => {
      let gen = null;
      try { gen = this.bot.prepEnd(this, ps, job); } catch (e) { this.reportError(`bot ${ps.playerId}`, e); }
      if (!gen) { ready(); return; }
      drive(gen, '', ready);
    };
    /** The layout the finished job chose is applied in a callback of its own (bounded slices end one stage per call). */
    const finish = (job) => {
      if (bounded) this.later(0, () => { if (valid()) end(job); });
      else end(job);
    };
    /** The rehearsal's slices, once the job simulates locally (nobody answered, or the server took it over). */
    const runJob = (job) => {
      const slice = () => {
        if (!valid()) return;
        let done = true;
        try { done = job.run(this.botSliceMs, sliceCtl); } catch (e) { this.reportError(`bot ${ps.playerId} rehearsal`, e); }
        if (done) finish(job);
        else this.later(0, slice);
      };
      // bounded slices start in a callback of their own (the economy + default layout above already used this one)
      if (bounded) this.later(0, slice);
      else slice();
    };
    const begin = () => {
      if (!valid()) return;
      let gen;
      try { gen = this.bot.prepBegin(this, ps, { delegate: this.botRehearsalDelegate, pooled: !!this.simPool }); }
      catch (e) { this.reportError(`bot ${ps.playerId}`, e); end(null); return; }
      drive(gen, '', (job) => {
        if (!job) { end(null); return; }
        // A job is finished when it has nothing left to simulate: the server's own run over the candidates, or — with a
        // delegated one — the host's pick, which MatchRehearsal accepts as soon as it arrives, possibly while the
        // generator above was still placing the default layout (its `done` is already true here). Either way the layout
        // is ready: it is applied, never simulated again, and a later local run cannot overwrite the accepted pick.
        if (job.done) { finish(job); return; }
        // delegated and unanswered: MatchRehearsal calls back here — `done`, the pick already in `job.best`, nothing
        // left to simulate — or after the server took the job over, whose own slices follow; never once the prep ended.
        // The continuation is installed here rather than when the frame went out: the generator that offered the task
        // still places the default layout after the delegation returns (`applyPlanSteps`), so an outcome applied earlier
        // would set the seat Ready and drop those steps — an answer that arrived in the meantime is the `done` above.
        if (job.pending) {
          job.onSettled = () => {
            if (!valid()) return;
            if (job.done) finish(job);
            else { job.takeOver(); runJob(job); }
          };
          return;
        }
        runJob(job);
      });
    };
    this.later(this.scaled(DELAYS.BOT_ACTION + i * DELAYS.BOT_STAGGER), () => {
      if (!valid()) return;
      if (this.bot.decide?.(this, ps, { kind: 'prep', valid, complete: () => ps.ready,
        fallback: () => this.later(0, begin) })) return;
      begin();
    });
  }

  onReadyChanged(ps) {
    this.markPublic();
    void ps;
    this.maybeEndPrep();
  }

  maybeEndPrep() {
    if (this.phase !== PHASE.PREP || this._prepEndQueued) return;
    const allReady = () => { const alive = this.alivePlayers(); return alive.length > 0 && alive.every((p) => p.ready); };
    if (!allReady()) return;
    const round = this.round;
    this._prepEndQueued = true;
    // the prep deadline stays armed until the phase really ends: a player may un-ready before this runs
    this.later(0, () => {
      this._prepEndQueued = false;
      if (this.phase === PHASE.PREP && this.round === round && allReady()) this.endPrep();
    });
  }

  prepDeadline() {
    if (this.phase !== PHASE.PREP) return;
    for (const ps of this.alivePlayers()) {
      if (ps.ready) continue;
      this.autoPickPersonalChoice(ps, 'random');
      ps.resolveTemp();
      ps.ready = true;
      ps.dirty();
    }
    this.endPrep();
  }

  endPrep() {
    if (this.phase !== PHASE.PREP) return;
    // rehearsals still waiting for a host's answer die with the prep: their bots place the default layout, a late answer
    // is ignored (Match._takeOverRehearsal / MatchRehearsal) and nothing of them runs after the phase ended
    this._cancelRehearsal();
    this.setDeadline(0);
    const alive = this.alivePlayers();
    for (const ps of alive) this.dispatch(ps, 'onPrepEnd', { round: this.round });
    for (const ps of alive) ps.endPrep();
    const r = this.round;
    // [local-patch 2026-10-22] 业主 2026-10-20：超限 R20/25/30… 是真正的 Boss 轮，走最终攻势 ——
    // phases.js 的 _planBossWaves 已经为它建好 bossWaves（buildInfiniteBossWave）。
    const infBoss = this.isInfinite && isInfiniteBossRound(r);
    if (r === this.gd.bossRound || infBoss) {
      this.hiddenLayerSum = alive.reduce((s, p) => s + p.activatedLayers(), 0);
      this.startFinalAssault(false);
    } else if (r === this.gd.hiddenRound) {
      this.startFinalAssault(true);
    } else {
      this.startCombat();
    }
  }
}
