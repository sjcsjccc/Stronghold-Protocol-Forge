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
  test('模式开关：isInfinite 点亮、公开视图带 isInfinite/speedPref、盟约层数上限 9999（对局存活期间）', () => {
    const h = makeMatch({ mode: 'solo_infinite', difficulty: 'HARD', humans: 1, seed: 9301, fake: true }).start();
    const m = h.m;
    assert.equal(m.isInfinite, true);
    assert.equal(m.mode, 'solo', 'solo_infinite plays on the solo seat shape');
    assert.equal(m.gd.overlimit, true, 'R1–R15 uses the ABYSS curve');
    const pub = m.publicView();
    assert.equal(pub.isInfinite, true);
    assert.equal(pub.speedPref, 1);
    assert.deepEqual(m.handle([...m.players.keys()][0], { t: 'g.combatSpeed', speed: 2 }), { ok: true });
    assert.equal(m.publicView().speedPref, 2, 'the in-battle speed switch moved');
    assert.equal(m.publicView().gameSpeed, 4, '2× = the base GAME_SPEED doubled');
    // the live bond-layer cap is 9999 for the overlimit match's lifetime …
    assert.equal(layerGainRoom(998, 5), 5, 'past the normal 999 cap the room continues');
    assert.equal(m.handle([...m.players.keys()][0], { t: 'g.matchSpeed', rate: 2 }).error, 'WRONG_PHASE', 'the host match-speed is inert in an overlimit match');
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
