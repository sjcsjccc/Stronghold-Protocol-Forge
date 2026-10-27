// test/match/spDraftSquads.test.js — 机变按小队 ([local-patch 2026-10-21]): with more than MAX_SEATS (4) participants
// every squad (the seats' floor(seat/4) groups, SQUAD_SIZE = 4) drafts its OWN six cards in parallel, a pick lands only
// in its own squad, and each player sees only its squad's draft (m.private.sp; m.public carries no sp at all). A room of
// ≤ MAX_SEATS participants keeps the shared public draft byte-for-byte (spSquads stays null).
// [ASSUMED] pinned by the upstream docs (docs/PS100-MIGRATION.md §10-B design item B) and this file; the ≤4 shapes are
// test/match/draft.test.js's to protect — this suite only adds the variant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch, checkInvariants } from './harness.js';

test('机变按小队 (>4 participants): two squads draft in parallel, picks are squad-scoped, the draft is private', () => {
  // 5 participants: p_0..p_3 = squad 0, p_4 = squad 1
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 5, seed: 21, fake: true }).start();
  const m = h.m;
  assert.equal(m.variant, true, '5 participants = the variant');
  h.drive(() => m.phase === PHASE.ROUND_START && m.round === 3, { ready: true });
  h.run(() => m.phase === PHASE.SP_DRAFT);
  assert.equal(m.phase, PHASE.SP_DRAFT);
  assert.equal(m.sp, null, 'no shared draft state in the variant');
  assert.ok(Array.isArray(m.spSquads) && m.spSquads.length === 2, `two squad drafts, got ${m.spSquads && m.spSquads.length}`);
  assert.equal(m.deadline, 0, 'no shared countdown: the turn clocks are per squad');

  for (const sq of m.spSquads) {
    assert.equal(sq.cards.length, 6, `squad ${sq.squad} drafts six cards`);
    assert.ok(sq.order.length >= 1, `squad ${sq.squad} has its alive members in the order`);
  }
  const sq0 = m.spSquadOf(m.players.get('p_0'));
  const sq1 = m.spSquadOf(m.players.get('p_4'));
  assert.notEqual(sq0, sq1, 'p_0 and p_4 sit in different squads');
  assert.deepEqual(sq1.order, ['p_4'], 'squad 1 is p_4 alone');
  assert.deepEqual(sq0.order.filter((id) => id === 'p_4'), [], 'squad 0 never holds p_4');

  // the public frame carries no draft; each player's private frame carries only its own squad's
  assert.equal(m.publicView().sp, undefined, 'no m.public.sp in the variant');
  h.flushAll();
  const priv0 = h.lastTo('p_0', 'm.private');
  const priv1 = h.lastTo('p_4', 'm.private');
  assert.ok(priv0 && priv0.sp, 'p_0 gets m.private.sp');
  assert.ok(priv1 && priv1.sp, 'p_4 gets m.private.sp');
  assert.deepEqual(priv1.sp.order, ['p_4'], 'p_4 sees only its own squad');
  assert.equal(priv0.sp.order.includes('p_4'), false, 'p_0 never sees p_4 in its draft');
  assert.equal(typeof priv0.sp.turnDeadline, 'number', 'the private frame carries the squad turn clock');
  assert.equal(priv0.sp.turnDeadline, sq0.turnDeadline);
  assert.equal(priv0.sp.cards.length, 6);

  // turn discipline + scoping: squad 0's non-current member is refused; the same idx is pickable in both squads
  const cur0 = sq0.order[sq0.idx];
  const rest0 = sq0.order.find((id) => id !== cur0);
  assert.equal(m.handle(rest0, { t: 'g.choice', idx: 0 }).error, 'NOT_YOUR_TURN');
  assert.deepEqual(m.handle(cur0, { t: 'g.choice', idx: 2 }), { ok: true });
  assert.equal(m.handle(cur0, { t: 'g.choice', idx: 3 }).error, 'ALREADY');
  const next0 = sq0.order[sq0.idx];
  assert.notEqual(next0, cur0, 'the squad chain moved on');
  assert.equal(m.handle(next0, { t: 'g.choice', idx: 2 }).error, 'SOLD_OUT', 'the card is gone within squad 0');
  assert.deepEqual(m.handle('p_4', { t: 'g.choice', idx: 2 }), { ok: true }, 'squad 1 picks the same idx independently');
  assert.equal(sq1.taken[2], 'p_4');
  assert.equal(sq0.taken[2], cur0);

  // the players' public status reads their own squad (deciding = its current picker)
  const pub = m.publicView();
  assert.equal(pub.players.find((p) => p.playerId === next0).status, 'deciding');
  assert.equal(pub.players.find((p) => p.playerId === cur0).status, 'ready');
  assert.equal(pub.players.find((p) => p.playerId === 'p_4').status, 'ready');

  // squad 0's remaining members auto-assign on their turn clocks (30 s first, 16 s after — the shared timers)
  h.sched.advance(16001);
  assert.ok(sq0.picks[next0] != null, 'the 16 s clock auto-assigned');
  h.sched.advance(32001);
  assert.equal(m.phase, PHASE.PREP, 'every squad done → the draft finishes into prep');
  for (const [pid, sq] of [['p_0', sq0], ['p_1', sq0], ['p_2', sq0], ['p_3', sq0], ['p_4', sq1]]) {
    assert.ok(sq.picks[pid] != null, `${pid} ends 机变 with a card of its own squad`);
  }
  checkInvariants(m);
  m.dispose();
});

test('机变 shared (≤4 participants): the public draft stays and no private sp is sent', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 1, seed: 8, fake: true }).start();
  const m = h.m;
  assert.equal(m.variant, false);
  h.drive(() => m.phase === PHASE.ROUND_START && m.round === 3, { ready: true });
  h.run(() => m.phase === PHASE.SP_DRAFT);
  assert.equal(m.phase, PHASE.SP_DRAFT);
  assert.ok(m.sp, 'the shared draft state');
  assert.equal(m.spSquads, null, 'no squad states in a shared room');
  assert.equal(m.publicView().sp.cards.length, 6);
  h.flushAll();
  const priv = h.lastTo('p_0', 'm.private');
  assert.ok(priv, 'a private frame exists');
  assert.equal('sp' in priv, false, 'the shared draft is not duplicated into m.private');
  m.dispose();
});

// [local-patch 2026-10-27] 死锁回归：小队的可选卡全部消失（operator 卡已被本队拿完、item 卡被全房
// 共享池抽干——跨队可触发）时，计时器 / bot 代选 / 落卡扫尾三条路径都必须把该小队收尾（sq.done），
// SP_DRAFT 阶段照常进 PREP。修复前：计时器与 bot 回调对空 avail 直接 return 且不置 done，其余小队
// 打完后 every(done) 恒 false，整局挂死；untimed 小队（1 真人 + N AI 大房）连计时器都没有。
test('机变按小队死锁修复（timed 路径）：小队可选卡被抽空时阶段照常收尾', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 5, seed: 22, fake: true }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.ROUND_START && m.round === 3, { ready: true });
  h.run(() => m.phase === PHASE.SP_DRAFT);
  assert.equal(m.phase, PHASE.SP_DRAFT);
  const sq0 = m.spSquadOf(m.players.get('p_0'));
  const sq1 = m.spSquadOf(m.players.get('p_4'));
  // squad 1（p_4 单人）先正常拿一张，把局面简化成「只差 squad 0」
  const pick1 = sq1.cards.find((c) => m._spAvail(sq1, c));
  assert.ok(pick1, 'squad 1 starts with a pickable card');
  assert.deepEqual(m.handle('p_4', { t: 'g.choice', idx: pick1.idx }), { ok: true });
  // 抽空 squad 0：六张全部视作已被拿走（taken 属队内口径，_spAvail 直接判不可选）
  for (const c of sq0.cards) sq0.taken[c.idx] = sq0.order[0];
  assert.equal(sq0.cards.some((c) => m._spAvail(sq0, c)), false, 'squad 0 has no pickable card left');
  // 推进时间：squad 0 的轮转计时器到点 → 修复后的回调重入轮转入口并置 done（修复前 here 挂死）
  h.sched.advance(65000);
  assert.equal(sq0.done, true, 'the emptied squad finishes (done)');
  assert.equal(m.phase, PHASE.PREP, 'the draft completes into prep');
  m.dispose();
});

test('机变按小队死锁修复（untimed/bot 路径 + 跨队扫尾）：1 真人 + 4 AI 变体房里被抽空的 bot 队不再停摆', () => {
  // 5 参战者（1 真人 + 4 AI）= 变体 + soloUntimed（小队全部 untimed，没有计时器兜底）
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 4, seed: 23, fake: true }).start();
  const m = h.m;
  assert.equal(m.variant, true, '5 participants = the variant');
  h.drive(() => m.phase === PHASE.ROUND_START && m.round === 3, { ready: true });
  h.run(() => m.phase === PHASE.SP_DRAFT);
  assert.equal(m.phase, PHASE.SP_DRAFT);
  // 真人在 squad 0（座位 0）；座位 4 的 bot 独占 squad 1
  const human = [...m.players.values()].find((p) => !p.botControlled);
  const sq0 = m.spSquadOf(human);
  const sq1 = m.spSquads.find((s) => s !== sq0);
  assert.ok(sq1, 'the lone-bot squad exists');
  // 抽空 bot 队：其 bot 代选回调到点时 avail 为空 → 修复后重入轮转入口收尾（修复前直接 return 永久停摆）
  for (const c of sq1.cards) sq1.taken[c.idx] = sq1.order[0];
  h.sched.advance(5000);
  assert.equal(sq1.done, true, 'the emptied untimed bot squad finishes via its bot callback');
  // 真人自己拿一张，队内 bot 依次代选，阶段照常收尾
  const pick0 = sq0.cards.find((c) => m._spAvail(sq0, c));
  assert.ok(pick0);
  assert.deepEqual(m.handle(human.playerId, { t: 'g.choice', idx: pick0.idx }), { ok: true });
  h.sched.advance(60000);
  assert.equal(m.phase, PHASE.PREP, 'the whole draft completes into prep');
  m.dispose();
});
