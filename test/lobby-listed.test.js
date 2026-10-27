// test/lobby-listed.test.js — [local-patch 2026-10-27] room.setListed（大厅一览公开开关，房主）：
// 默认全列（原行为）；房主关掉后 room.list 不再枚举本房（加入/观战只剩房间码），非房主/点错码被拒，
// 再打开恢复可见。room.state 仅在 false 时下发 listed（帧稳定惯例同 spectatorCap）。
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';

function clientPool(getUrl) {
  const open = new Set();
  return {
    async player(name, token) {
      const c = await TestClient.connect(getUrl());
      const w = await c.hello(name, token);
      c.id = w.playerId;
      c.token = w.token;
      open.add(c);
      return c;
    },
    async closeAll() { await Promise.all([...open].map((c) => c.terminate().catch(() => {}))); open.clear(); },
  };
}
const quietLog = () => {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
};
const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };

describe('room.setListed (lobby)', () => {
  let srv;
  let pool;
  const cap = quietLog();
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, MatchClass: StubMatch, lobbyGraceMs: 60_000 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await pool.closeAll(); });
  after(async () => {
    await srv?.close();
    assert.deepEqual(cap.errors, [], 'no server errors logged');
  });

  test('房主隐藏 → room.list 不列、state 带 listed:false；重新公开恢复；权限三连拒', async () => {
    const host = await pool.player('房主');
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const st = await host.waitFor('room.state', (s) => s.hostId === host.id);
    const code = st.code;

    const guest = await pool.player('路人');
    await ok(guest, { t: 'room.join', code });
    await guest.waitFor('room.state', (s) => s.code === code);

    // 权限：不在房里的人、非房主、点错码
    const outsider = await pool.player('外人');
    await err(outsider, { t: 'room.setListed', code, listed: false }, 'NOT_IN_ROOM');
    await err(guest, { t: 'room.setListed', code, listed: false }, 'NOT_HOST');
    await err(host, { t: 'room.setListed', code: 'ZZZZZ', listed: false }, 'NOT_IN_ROOM');

    // 默认可见（TestClient.request 只收 ok/error/welcome/pong 回执，数据帧用 waitFor 收）
    await guest.send({ t: 'room.list' });
    const before = await guest.waitFor('room.list');
    assert.equal(before.ok, true);
    assert.ok(before.rooms.some((r) => r.code === code), '默认公开：一览可见');

    // 隐藏
    await ok(host, { t: 'room.setListed', code, listed: false });
    const hidden = await host.waitFor('room.state', (s) => s.listed === false);
    assert.equal(hidden.listed, false, 'state 仅在 false 时带键');
    await guest.send({ t: 'room.list' });
    const after = await guest.waitFor('room.list');
    assert.ok(!after.rooms.some((r) => r.code === code), '隐藏后一览不再枚举本房');

    // 恢复公开
    await ok(host, { t: 'room.setListed', code, listed: true });
    await host.waitFor('room.state', (s) => s.listed === undefined);
    await guest.send({ t: 'room.list' });
    const resumed = await guest.waitFor('room.list');
    assert.ok(resumed.rooms.some((r) => r.code === code), '重新公开后一览恢复');
  });
});
