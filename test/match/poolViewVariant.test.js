// test/match/poolViewVariant.test.js — 卡池面板读「请求者自己的牌库」([local-patch 2026-10-21]): in the > MAX_SEATS
// variant every player draws from a per-player pool (PlayerRules.mainPool) and the room-wide `m.pool` is only the
// canonical catalog — the panel used to read that catalog, so its counts never moved when the player bought (the user
// report). ≤ MAX_SEATS mainPool() IS m.pool, so the shared rooms are unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';

test('卡池面板 (variant >4): the panel follows the requester pool, buying moves it', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 5, seed: 3, fake: true }).start();
  const m = h.m;
  assert.equal(m.variant, true);
  h.drive(() => m.phase === PHASE.PREP && m.round === 1, { ready: true });
  const ps = m.players.get('p_0');
  assert.notEqual(ps.mainPool(), m.pool, 'a variant player draws from its own pool');
  const id = [...ps.mainPool().entries].find(([, e]) => e && e.left > 2)[0];
  const before = ps.mainPool().left(id);
  assert.ok(before > 2, 'picked an entry with stock');
  ps.mainPool().take(id, 2); // a purchase / merge / golden take draws from THIS pool
  m.poolView(ps);
  const view = h.lastTo('p_0', 'm.pool');
  assert.ok(view && view.pool && view.pool[id], 'the panel carries the entry');
  assert.equal(view.pool[id].left, before - 2, 'the panel shows the player own stock, live');
  assert.equal(view.pool[id].cap, ps.mainPool().cap(id));
  m.dispose();
});

test('卡池面板 (≤4): the shared pool is shown exactly as before', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 1, seed: 5, fake: true }).start();
  const m = h.m;
  assert.equal(m.variant, false);
  h.drive(() => m.phase === PHASE.PREP && m.round === 1, { ready: true });
  const ps = m.players.get('p_0');
  assert.equal(ps.mainPool(), m.pool, 'a shared room has one pool');
  const id = [...m.pool.entries].find(([, e]) => e && e.cap > 0)[0];
  m.poolView(ps);
  const view = h.lastTo('p_0', 'm.pool');
  assert.ok(view && view.pool[id]);
  assert.equal(view.pool[id].left, m.pool.left(id));
  assert.equal(view.pool[id].cap, m.pool.cap(id));
  m.dispose();
});
