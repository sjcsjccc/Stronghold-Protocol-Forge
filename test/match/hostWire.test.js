// test/match/hostWire.test.js — [local-patch 2026-10-21] the match host's worker payload carries `hostId`, and host
// migrations reach a PLUGIN match too: g.matchSpeed (the 房主对局倍速) checks `match.hostId` inside the sandbox, and a
// payload that drops it made every plugin match refuse the host's speed request with NOT_HOST (the user report:
// 「开了插件用不了加速」).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireOptions, MatchProxy } from '../../server/match/host/proxy.js';

test('wireOptions carries hostId to the worker; absent stays absent', () => {
  const o = wireOptions({ roomCode: 'ABCD', mode: 'coop', hostId: 'p_0', seats: [], seed: 1 });
  assert.equal(o.hostId, 'p_0', 'the host rides along');
  assert.equal('hostId' in wireOptions({ roomCode: 'ABCD', mode: 'solo' }), false, 'a vanilla payload keeps its shape');
});

test('MatchProxy.setHost follows the migration in a plugin match too (not test-only)', () => {
  const posted = [];
  const proxy = new MatchProxy({ host: { post: (m) => posted.push(m) }, matchId: 'm1', opts: { roomCode: 'X', hostId: 'a' } });
  proxy.setHost('b');
  assert.equal(proxy.opts.hostId, 'b', 'the proxy remembers the new host');
  const notify = posted.find((m) => m.type === 'call' && m.method === 'setHost');
  assert.deepEqual(notify, { type: 'call', matchId: 'm1', method: 'setHost', args: ['b'] }, 'the worker is told');
  proxy.dispose();
});
