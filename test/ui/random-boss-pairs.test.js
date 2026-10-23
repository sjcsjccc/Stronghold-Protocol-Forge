import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepCamera, deployFieldOf, teamFrameIds } from '../../public/js/ui/gameLogic/camera.js';
import { makeMatch } from '../match/harness.js';
import { PHASE } from '../../shared/constants.js';

for (const humans of [2, 3, 4]) test(`random ${humans}-player boss preparation: client camera, placement and partner frames match server`, () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans, seed: 31, fake: true }).start();
  try {
    h.drive(() => h.m.phase === PHASE.PREP && h.m.round === 14);
    const pub = h.m.publicView();
    assert.deepEqual(pub.bossPairs, h.m.bossPairs);
    for (const p of h.m.alivePlayers()) {
      const expected = h.m.bossGroupOf(p);
      assert.equal(prepCamera(pub, p.playerId).opts.side, expected.side);
      assert.equal(deployFieldOf(pub, p.playerId), h.m.deployFieldOf(p));
      assert.deepEqual([...teamFrameIds(pub, p.playerId)], expected.players.length > 1 ? expected.players : []);
    }
    h.m.onLeave(h.m.bossPairs[0][0]);
    const after = h.m.publicView();
    for (const p of h.m.alivePlayers()) assert.equal(deployFieldOf(after, p.playerId), h.m.deployFieldOf(p));
  } finally { h.m.dispose(); }
});

test('unknown/new pairing is not guessed from seats; older servers still have their ordered fallback', () => {
  const pub = { phase: PHASE.PREP, round: 14, bossRound: 14, players: [{ playerId: 'a', seat: 0 }, { playerId: 'b', seat: 1 }] };
  assert.equal(prepCamera(pub, 'b').opts.side, 'R');
  assert.equal(prepCamera({ ...pub, bossPairs: null }, 'b').kind, 'prep');
  assert.equal(prepCamera({ ...pub, bossPairs: [['b', 'a']] }, 'b').opts.side, 'L');
  assert.deepEqual([...teamFrameIds({ ...pub, bossPairs: [['b', 'a']] }, 'a')], ['b', 'a']);
});

// [local-patch 2026-10-23] 超限的 Boss 轮（R20/25/30…，pub.bossRound 还是 14）也切 Boss 场准备相机 ——
// 业主 2026-10-23「休整期应该能看到 boss，但是显示是小怪」：以前超限 Boss 轮的休整期留在普通战场，
// 笔围栏里一群小怪、领袖不上场。
test('infinite boss rounds (R20/25/30) switch to the boss-field prep camera like R14 does', () => {
  const players = [{ playerId: 'a', seat: 0 }, { playerId: 'b', seat: 1 }];
  const base = { phase: PHASE.PREP, bossRound: 14, hiddenRound: 15, isInfinite: true, bossPairs: [['a', 'b']], players };
  for (const round of [20, 25, 30, 45]) {
    const pub = { ...base, round };
    assert.equal(prepCamera(pub, 'a').kind, 'bossPrep', `R${round} is a boss prep`);
    assert.equal(prepCamera(pub, 'a').opts.side, 'L');
    assert.equal(prepCamera(pub, 'b').opts.side, 'R');
    assert.deepEqual([...teamFrameIds(pub, 'a')], ['a', 'b'], `R${round} frames the pair`);
  }
  // 非 5 的倍数还是普通战场；普通模式（isInfinite 缺省）R20 也不算
  assert.equal(prepCamera({ ...base, round: 19 }, 'a').kind, 'prep');
  assert.equal(prepCamera({ ...base, round: 20, isInfinite: false }, 'a').kind, 'prep');
});
