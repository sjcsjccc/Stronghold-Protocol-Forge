// test/match/traitWire.test.js — [local-patch 2026-10-27] 词条接线回归：
// 此前 27 张词条卡里 16 张纯文案（traitFlags 的 11 键注入 battle.flags 后无消费者、settle 的
// funds/giveItems/addElite 三键 bundle 产出后无人读、regen/corrode 连数据都没有）。本文件钉住：
//   ① sim 层：overlimit spec（浏览器权威场/服务端 spec 验证走的那条路）安装 infiniteRule，
//      静态修正以 trait_ally_aura / trait_enemy_aura 光环 buff 落进标准属性管线（atkMul/defMul/
//      spRecoveryFlat…），敌方靠 tick 扫尾补晚出生的怪；普通 spec 逐字节不动。
//      落位懒武装在第一个 tick（单位 start() 后才 alive），断言都在 runToEnd 之后。
//   ② 匹配层：富足（funds +1/回合，A/B 同种子对照）、集群（发变形同构体）、蜂拥（下一轮排精英）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeMatch } from './harness.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';

const approx = (a, b, eps = 1e-6, what = '') => assert.ok(Math.abs(a - b) < eps, `${what} ${a} ≉ ${b}`);

function specOf(flags, chessId = 'chess_char_1_01_a') {
  return buildBattleSpec({
    battleId: 'x', fieldId: 'n:p', kind: 'normal', round: 3, stageId: 'act1autochess_m01', timeLimit: 60,
    players: [{ playerId: 'p', units: [{ uid: 5, kind: 'chess', chessId, row: 9, col: 3 }] }],
    spawns: [{ enemyKey: 'enemy_1007_slime', count: 3, time: 0 }],
    flags,
  });
}

test('词条接线（sim）：overlimit spec 装 infiniteRule + 光环属性落地；普通 spec 一根汗毛不动', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 41, fake: true }).start();
  const ds = h.m.ds;
  const runFor = (flags, secs, chessId) => {
    const b = createBattleFromSpec(specOf(flags, chessId), ds, { quiet: true });
    b.runToEnd(secs);
    return b;
  };

  // 普通战斗：不安装、无光环（帧级不变）
  const plain = runFor({ layerGainsEnabled: true }, 1);
  assert.equal(plain.infinite, undefined, '普通 spec 不装 infiniteRule');
  const plainAlly = plain.players[0].units.find((u) => u.alive) || plain.players[0].units[0];
  assert.ok(plainAlly, 'plain ally exists');
  assert.ok(!plainAlly.findBuff('trait_ally_aura'), '普通 spec 无词条光环');

  // 超限 + 静态修正：spec 侧安装（此前只有服务端直构场装，真人权威场全裸奔）
  const inf = runFor({ layerGainsEnabled: true, overlimit: true, allyAtkMul: 1.25, allySpRegen: 0.2 }, 1);
  assert.ok(inf.infinite, 'overlimit spec 安装 infiniteRule');
  const ally = inf.players[0].units.find((u) => u.alive);
  assert.ok(ally, 'inf ally alive after a short run');
  assert.ok(ally.findBuff('trait_ally_aura'), 'ally 光环 buff 在（tick 懒武装）');
  approx(ally.s.atk, plainAlly.s.atk * 1.25, 1e-6, '强攻 atkMul');
  approx(ally.s.spRecovery, plainAlly.s.spRecovery + 0.2, 1e-6, '熟稔 spRecoveryFlat（自然回复技力）');

  // 意志（近战屏障）：chess_char_1_02_a 的 rangeGrid 只盖贴身格 = 近战代理；远程棋子不吃
  const will = runFor({ overlimit: true, allyBarrierPct: 0.5 }, 0.5, 'chess_char_1_02_a');
  const melee = will.players[0].units.find((u) => u.alive);
  assert.ok(melee, 'melee ally alive');
  const barrier = melee.findBuff('trait_barrier');
  assert.ok(barrier && barrier.shield > 0, '意志：近战单位带屏障');
  approx(barrier.shield, melee.s.maxHp * 0.5, 1e-6, '屏障 = 50% 最大生命');
  const rangedB = runFor({ overlimit: true, allyBarrierPct: 0.5 }, 0.5, 'chess_char_1_01_a');
  const ranged = rangedB.players[0].units.find((u) => u.alive);
  assert.ok(!ranged.findBuff('trait_barrier'), '远程单位不吃近战屏障');

  // 敌方光环：晚出生的怪靠 tick 扫尾补
  const pe = runFor({ layerGainsEnabled: true }, 0.5);
  const ie = runFor({ overlimit: true, enemyDefMul: 0.85 }, 0.5);
  const peE = pe.enemies.find((x) => x.alive);
  const ieE = ie.enemies.find((x) => x.alive);
  assert.ok(peE && ieE, '两场都有活着的怪（同种子同出生）');
  assert.ok(ieE.findBuff('trait_enemy_aura'), '敌方光环扫尾补上晚出生的怪');
  approx(ieE.s.def, peE.s.def * 0.85, 1e-6, '破局 enemyDefMul');

  // 浴血：动态 buff 挂上（0.25s 重估 atkPct）
  const lust = runFor({ overlimit: true, allyAtkByMissingHp: 0.5, allyAtkByMissingHpFloor: 0.3 }, 0.5);
  const lustAlly = lust.players[0].units.find((u) => u.alive);
  assert.ok(lustAlly.findBuff('trait_bloodlust'), '浴血动态 buff 在');
  h.m.dispose();
});

test('词条接线（settle）：富足每回合 +1 资金（A/B 同种子对照恰好差 1）', () => {
  const mk = () => makeMatch({ mode: 'infinite', difficulty: 'HARD', humans: 1, seed: 51, fake: true, hostId: 'p_0', script: () => ({ duration: 1, leaks: {} }) }).start();
  const a = mk();
  const b = mk();
  b.m.traitMods = [{ id: 'wealth', name: '富足', polarity: 'pos', round: 1 }];
  for (const h of [a, b]) h.autoHumans();
  for (const h of [a, b]) h.drive(() => h.m.round >= 2, { ready: true });
  const fa = a.m.players.get('p_0').funds;
  const fb = b.m.players.get('p_0').funds;
  assert.equal(fb - fa, 1, `富足结算恰好 +1（${fb} vs ${fa}）`);
  a.m.dispose(); b.m.dispose();
});

test('词条接线（settle）：集群发【变形同构体】、蜂拥给下一轮排精英（吃当轮缩放）', () => {
  const h = makeMatch({ mode: 'infinite', difficulty: 'HARD', humans: 1, seed: 52, fake: true, hostId: 'p_0', script: () => ({ duration: 1, leaks: {} }) }).start();
  const m = h.m;
  h.autoHumans();
  m.traitMods = [
    { id: 'cluster', name: '集群', polarity: 'pos', round: 1 },
    { id: 'swarm', name: '蜂拥', polarity: 'neg', round: 1 },
  ];
  h.drive(() => m.round >= 2, { ready: true });
  const ps = m.players.get('p_0');
  const ownsItem = (ps.hand || []).concat(ps.temp || []).some((p) => p && p.id === 'chess_item_6_09_e_a')
    || [...(ps.board ? ps.board.values() : [])].some((p) => p && (p.items || []).some((i) => i && i.id === 'chess_item_6_09_e_a'));
  assert.ok(ownsItem, '集群：变形同构体已入玩家手中（手牌/临时区/已装备）');
  const elites = (m.traitSpawn || []).filter((x) => x.elite);
  assert.equal(elites.length, 1, '蜂拥：一只精英排进 traitSpawn');
  assert.ok(elites[0].round >= 2, '蜂拥：下一轮出场');
  const spawn = m.traitSpawnFor(elites[0].round).find((s) => s.enemyKey === elites[0].enemyKey);
  assert.ok(spawn, '蜂拥精英出现在该轮 spawn 里');
  assert.ok(spawn.mods && Object.keys(spawn.mods).length > 0, '词条怪/蜂拥怪吃当轮波次缩放（mods 不再是空对象）');
  assert.equal(spawn.preview.elite, true, '蜂拥怪按精英标记预览');
  m.dispose();
});
