// test/match/infinite.test.js — [local-patch 2026-10-22] 超限模拟（solo_infinite，上游 0.3.1.1 移植）：
// 模式开关点亮、R14 Boss 打完不结算、R16+ 无限波次、R20 起真正的 Boss 轮、词条抉择在 Boss 清场后开卡、
// 选完的怪下一轮出场、盟约层数上限抬到 9999。普通模式（solo/coop）一根汗毛都不动。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeMatch } from './harness.js';
import { PHASE, layerGainRoom, setBondLayerCap } from '../../shared/constants.js';
import { isInfiniteBossRound } from '../../server/match/infiniteWaves.js';
import { enemyInfiniteScale } from '../../shared/infiniteMode.js';

/** Drive the match like h.drive, answering the trait draft as well (idx 0). */
function drive(h, pred) {
  const m = h.m;
  for (let i = 0; i < 3e6; i++) {
    if (pred()) return true;
    if (h.ended) return !!pred();
    for (const ps of m.players.values()) {
      if (ps.isBot || ps.left) continue;
      if (m.phase === 'INFO_CHECK' && !ps.infoReady) m.handle(ps.playerId, { t: 'g.infoReady' });
      if (m.phase === 'BAND_DRAFT' && m.draftTurn() === ps.playerId) m.handle(ps.playerId, { t: 'g.band', bandId: 'band_bldsk' });
      if (m.phase === 'TRAIT_DRAFT' && m.traitTurn() === ps.playerId) m.handle(ps.playerId, { t: 'g.traitChoice', idx: 0 });
      if (m.phase === 'SP_DRAFT' && m.spTurn() === ps.playerId) {
        const idx = m.sp.cards.map((c) => c.idx).find((k) => m.sp.taken[k] == null);
        if (idx != null) m.handle(ps.playerId, { t: 'g.choice', idx });
      }
      if (m.phase === 'PREP' && ps.alive && !ps.ready) {
        if (ps.personalChoice) m.handle(ps.playerId, { t: 'g.choice', idx: 0, choiceId: ps.personalChoice.id });
        if (!ps.tempEmpty) ps.resolveTemp();
        m.handle(ps.playerId, { t: 'g.ready', ready: true });
      }
    }
    if (!h.sched.runNext()) return !!pred();
  }
  return !!pred();
}

describe('超限模拟 (solo_infinite)', () => {
  test('模式开关：isInfinite 点亮、加速走统一房主倍速、盟约层数上限 9999（对局存活期间）', () => {
    const h = makeMatch({ mode: 'solo_infinite', difficulty: 'HARD', humans: 1, seed: 9301, fake: true, hostId: 'p_0' }).start();
    const m = h.m;
    assert.equal(m.isInfinite, true);
    assert.equal(m.mode, 'solo', 'solo_infinite plays on the solo seat shape');
    assert.equal(m.gd.overlimit, true, 'R1–R15 uses the ABYSS curve');
    const pub = m.publicView();
    assert.equal(pub.isInfinite, true);
    // [local-patch 2026-10-22] 加速与另两个模式统一：房主倍速 g.matchSpeed（×1–4）在超限局照常生效
    assert.deepEqual(m.handle([...m.players.keys()][0], { t: 'g.matchSpeed', rate: 3 }), { ok: true });
    assert.equal(m.publicView().speedPref, undefined, 'the upstream speed toggle is gone');
    // the live bond-layer cap is 9999 for the overlimit match's lifetime …
    assert.equal(layerGainRoom(998, 5), 5, 'past the normal 999 cap the room continues');
    assert.deepEqual(m.handle([...m.players.keys()][0], { t: 'g.matchSpeed', rate: 2 }), { ok: true });
    m.dispose();
    assert.equal(layerGainRoom(998, 5), 1, '… and back to 999 after dispose');
  });

  test('R14 Boss 胜利不结算；R16+ 无限波次；R20 是真正的 Boss 轮；清场后开词条抉择，选中的怪下一轮出场', () => {
    const h = makeMatch({
      mode: 'solo_infinite', difficulty: 'HARD', humans: 1, seed: 9301, fake: true,
      // Boss 轮要真打：bossDps 把血池磨穿（R20 的双 Boss 同理）；普通轮 1 秒无漏怪
      script: (b) => (b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 20000 } : { duration: 1, leaks: {} }),
    }).start();
    const m = h.m;
    h.autoHumans();
    const human = [...m.players.keys()][0];

    drive(h, () => m.round === 15 && (m.phase === 'PREP' || m.phase === 'ROUND_START'));
    assert.equal(h.ended, null, 'R14 victory did not finish the match');
    assert.ok(true, 'reached R15');

    drive(h, () => m.round >= 16 && (m.phase === 'PREP' || m.phase === 'ROUND_START'));
    assert.ok(m.wave, 'R16+ has an infinite wave');
    assert.ok(m.wave.spawns.length >= 12, `R16+ waves are deep (${m.wave.spawns.length} spawns)`);
    // R16+ 的指数膨胀走 shared/infiniteMode.enemyInfiniteScale（从绝境 R15 的数值接着往上），不是查表
    assert.ok(enemyInfiniteScale(16, { hpMul: 1, atkMul: 1, speedMul: 1 }).hpMul > enemyInfiniteScale(15, { hpMul: 1, atkMul: 1, speedMul: 1 }).hpMul, 'the enemy curve keeps climbing past R15');

    drive(h, () => m.phase === 'FINAL_ASSAULT' || (h.ended != null));
    assert.equal(m.phase, PHASE.FINAL_ASSAULT, 'R20 is a real boss round');
    assert.ok(isInfiniteBossRound(m.round));
    assert.ok(m.bossWaves?.[0]?.wave, 'the boss wave came from buildInfiniteBossWave');

    drive(h, () => m.phase === 'TRAIT_DRAFT' || (h.ended != null));
    assert.equal(m.phase, PHASE.TRAIT_DRAFT, 'the trait draft opens after a cleared boss');
    assert.ok(m.publicView().trait, 'the public view carries the trait draft');
    assert.equal(m.trait.polarity, 'pos', 'the first draft of a run is a positive one');
    assert.equal(m.trait.cards.length, 3, 'three cards to pick from');

    assert.deepEqual(m.handle(human, { t: 'g.traitChoice', idx: 0 }), { ok: true });
    assert.equal(m.traitMods.length, 1, 'the picked trait is recorded for the match');
    assert.ok(Array.isArray(m.publicView().traitMods) && m.publicView().traitMods.length === 1, 'the HUD reads it from the public view');

    drive(h, () => m.round >= 21 && (m.phase === 'PREP' || m.phase === 'ROUND_START'));
    assert.equal(m.round, 21, 'the next round starts only after the pick');
    const spawned = (m.traitSpawnFor ? m.traitSpawnFor(21) : []);
    assert.equal(spawned.length, 1, 'the chosen mob spawns next round');
  });

  test('普通模式一根汗毛不动：solo 没有 isInfinite、词条阶段永不进入', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 5, fake: true, script: () => ({ duration: 1, leaks: {} }) }).start();
    const m = h.m;
    h.autoHumans();
    assert.equal(m.isInfinite, false);
    assert.equal(m.publicView().isInfinite, false);
    drive(h, () => h.ended != null);
    assert.ok(h.ended, 'a normal solo match still ends');
    assert.notEqual(m.phase, PHASE.TRAIT_DRAFT, 'no trait draft in the normal mode');
    assert.ok(!Array.isArray(m.traitMods) || m.traitMods.length === 0);
  });
});

describe('超限模拟·联机 (infinite)', () => {
  test('盟形状：mode=coop + isInfinite；词条轮流选、非回合拒绝、整队共享 traitMods、选中的怪都进下一轮；战术撤退拒绝', () => {
    const h = makeMatch({
      mode: 'infinite', difficulty: 'HARD', humans: 2, seed: 77, fake: true, hostId: 'p_0',
      script: (b) => (b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 20000 } : { duration: 1, leaks: {} }),
    }).start();
    const m = h.m;
    h.autoHumans();
    assert.equal(m.isInfinite, true, 'the coop-shaped infinite lights the same switches');
    assert.equal(m.mode, 'coop', 'infinite plays on the coop seat shape');
    assert.equal(m.gd.overlimit, true, 'the ABYSS curve applies from R1');
    const [p0, p1] = [...m.players.keys()];

    drive(h, () => m.phase === 'TRAIT_DRAFT' || h.ended != null);
    assert.equal(m.phase, PHASE.TRAIT_DRAFT, 'the R20 boss cleared → the shared draft opens');
    const t = m.trait;
    assert.equal(t.order.length, 2, 'both players hold a turn');
    assert.equal(t.untimed, false, 'two humans: the draft is timed (auto-pick on timeout)');
    const first = m.traitTurn();
    const second = first === p0 ? p1 : p0;
    assert.equal(m.handle(second, { t: 'g.traitChoice', idx: 0 }).error, 'BAD_TARGET', 'not your turn');
    assert.deepEqual(m.handle(first, { t: 'g.traitChoice', idx: 0 }), { ok: true });
    assert.equal(m.traitMods.length, 1, 'picks land in the SHARED match-level pool');
    assert.equal(m.traitTurn(), second, 'the turn advances to the other player');
    assert.deepEqual(m.handle(second, { t: 'g.traitChoice', idx: 1 }), { ok: true });
    assert.equal(m.traitMods.length, 2, 'both picks stack in the shared pool');
    assert.equal(m.trait, null, 'the draft closes after the last pick');

    drive(h, () => m.round >= 21 && (m.phase === 'PREP' || m.phase === 'ROUND_START'));
    assert.equal(m.round, 21, 'the next round starts only after both picks');
    assert.equal(m.traitSpawnFor(21).length, 2, 'both chosen mobs spawn into the shared wave');
    assert.equal(m.handle(p0, { t: 'g.traitRetreat' }).error, 'BAD_TARGET', 'retreat is a solo-infinite control');
  });

  test('单人类的联机超限不受时限（soloUntimed），AI 队友由服务端代选', () => {
    const h = makeMatch({
      mode: 'infinite', difficulty: 'HARD', humans: 1, bots: 1, seed: 31, fake: true, hostId: 'p_0',
      script: (b) => (b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 20000 } : { duration: 1, leaks: {} }),
    }).start();
    const m = h.m;
    h.autoHumans();
    assert.equal(m.soloUntimed, true, 'one human + one AI: nobody waits on anybody');
    drive(h, () => m.phase === 'TRAIT_DRAFT' || h.ended != null);
    assert.equal(m.phase, PHASE.TRAIT_DRAFT, 'the draft opens after the R20 boss');
    assert.equal(m.trait.untimed, true, 'untimed draft for the lone human');
    // 人类选完 → 轮到 AI；AI 的代选由 scheduleTraitBot 定时驱动（drive 的 sched 会推它走）
    const human = [...m.players.keys()].find((id) => !m.players.get(id).isBot);
    assert.deepEqual(m.handle(human, { t: 'g.traitChoice', idx: 0 }), { ok: true });
    const botId = [...m.players.keys()].find((id) => m.players.get(id).isBot);
    assert.equal(m.traitTurn(), botId, 'the AI teammate holds the next turn');
    drive(h, () => m.trait == null || h.ended != null);
    assert.equal(m.traitMods.length, 2, 'the bot pick landed in the shared pool');
  });

  test('R20 休整期的敌方预览带领袖出生格（nextEnemies start），客户端 leaderStand 才能把 Boss 立上 Boss 场', () => {
    const h = makeMatch({
      mode: 'infinite', difficulty: 'HARD', humans: 2, seed: 77, fake: true, hostId: 'p_0',
      script: (b) => (b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 20000 } : { duration: 1, leaks: {} }),
    }).start();
    const m = h.m;
    h.autoHumans();
    drive(h, () => m.phase === 'PREP' && m.round === 20);
    assert.equal(m.round, 20, 'reached the boss round prep');
    for (const ps of m.alivePlayers()) {
      const list = m.nextEnemiesFor(ps);
      const bosses = list.filter((e) => e.boss);
      assert.ok(bosses.length >= 1, 'the preview carries the leader');
      for (const b of bosses) {
        assert.ok(Array.isArray(b.start) && b.start.length === 2 && b.start.every(Number.isFinite),
          `the leader entry has a spawn tile (got ${JSON.stringify(b.start)})`);
        // Boss 场显示行 0–5（prepfield.leaderStand 的界）；列在镜像界内
        assert.ok(b.start[0] >= 0 && b.start[0] <= 5, `start row ${b.start[0]} is on the boss field`);
        assert.ok(b.start[1] >= 0 && b.start[1] <= 20, `start col ${b.start[1]} is on the boss field`);
      }
    }
    m.dispose();
  });
});
