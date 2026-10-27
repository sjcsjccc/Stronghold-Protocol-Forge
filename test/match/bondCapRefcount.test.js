// test/match/bondCapRefcount.test.js — [local-patch 2026-10-27] 盟约层数上限引用计数回归：
// 旧的 setBondLayerCap 存/取「上一局的值」假设 LIFO 嵌套，而大厅进程里多个对局并行——
// A、B 两个超限局交叠时 A 的 dispose 会把 B 正在用的 9999 冲回 999，B 的 dispose 再把进程
// 永久留在 9999（殃及之后所有普通局，直到重启）。hold/release 引用计数归零才回 999。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMatch } from './harness.js';
import { currentBondLayerCap, holdInfiniteBondLayerCap, releaseInfiniteBondLayerCap } from '../../shared/constants.js';

test('hold/release 基本语义：并发持有各算一份，归零才回 999，多释放安全', () => {
  assert.equal(currentBondLayerCap(), 999);
  holdInfiniteBondLayerCap();
  holdInfiniteBondLayerCap();
  assert.equal(currentBondLayerCap(), 9999);
  releaseInfiniteBondLayerCap();
  assert.equal(currentBondLayerCap(), 9999, '还有一份持有时不得回 999（旧实现在此把并发的另一局冲掉）');
  releaseInfiniteBondLayerCap();
  assert.equal(currentBondLayerCap(), 999);
  releaseInfiniteBondLayerCap(); // 与 hold 不配对的多释放：钳在 0，不抛不倒扣
  assert.equal(currentBondLayerCap(), 999);
});

test('并发超限局交叠（A、B 同时在场，先结束 A）不再互相污染', () => {
  const a = makeMatch({ mode: 'solo_infinite', difficulty: 'HARD', humans: 1, seed: 11, fake: true, hostId: 'p_0' }).start();
  assert.equal(currentBondLayerCap(), 9999, 'A 开局即 9999');
  const b = makeMatch({ mode: 'solo_infinite', difficulty: 'HARD', humans: 1, seed: 12, fake: true, hostId: 'p_0' }).start();
  assert.equal(currentBondLayerCap(), 9999, 'B 并发开局');
  a.m.dispose();
  assert.equal(currentBondLayerCap(), 9999, 'A 结束后 B 仍在超限——上限不得被冲回 999（旧实现在此翻车）');
  b.m.dispose();
  assert.equal(currentBondLayerCap(), 999, '全部超限局结束回到 999（旧实现会把进程永久留在 9999）');
});

test('普通局从头到尾不动上限', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 13, fake: true }).start();
  assert.equal(currentBondLayerCap(), 999);
  h.m.dispose();
  assert.equal(currentBondLayerCap(), 999);
});
