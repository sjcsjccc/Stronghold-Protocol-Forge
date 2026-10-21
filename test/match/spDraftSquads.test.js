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
