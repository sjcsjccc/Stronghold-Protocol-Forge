// server/sim/traitRule.js — [local-patch 2026-10-27] 超限词条「静态修正」接线
//
// 背景：traits.js 的 traitFlags() 产出 11 个修正键（traitFlagBundle 合并进 battle.flags），
// 上游 0.3.1.1 与我们的移植都只注入不消费——27 张词条卡里 16 张是纯文案。本文件把它们接进
// 引擎**既有的属性管线**：翻成标准 buff mods（buffs.js ADD_KEYS/MUL_KEYS，units.js _recalc），
// 而不是教 damage.js 认新键——同一份代码在服务端与浏览器 sim（/sim/ 路由同源）都生效。
//
// 覆盖（traits.js → 引擎键）：
//   强攻/虚弱 allyAtkMul → atkMul；坚守/破防 allyDefMul → defMul；guard/sunder allyResAdd → resFlat
//   破局/壁垒 enemyDefMul/enemyResAdd → 敌方 defMul/resFlat
//   灵巧 allyDodgePhys/Arts → dodgePhys/dodgeArts；暴露 allyTakenMul → dmgTakenMul
//   熟稔/迟滞 allySpRegen → spRecoveryFlat（只作用 'time' 型自然回复，skills.js:390，与卡面口径一致）
//   浴血/颓势 allyAtkByMissingHp → 0.25s 重估 atkPct 的常驻 buff（mods 是活引用，markDirty 即重算）
//   意志/脆壳 allyBarrierPct → 近战（rangeGrid 切比雪夫 ≤1 代理）开战获得 shield / 吃 true 伤害
//   再生/腐蚀 traitRegenPct/traitCorrodePct → 2 秒一跳的全体回血/流失（盛发的 allyHealMul 在
//   damage.js heal() 里乘，覆盖治疗与回复两条路径——上游同款，本文件不碰）
//
// 时机：安装发生在战斗构造后、start() 前——**单位此刻 alive=false**，所以一切对单位的落位都
// 懒武装到第一个 tick（start() 之后）；战斗已开跑的迟装（幂等守卫放行的那次）立即武装。
// 敌人是战斗中出生的（spawns.js），没有出生钩子 ⇒ 敌方光环走 tick 扫尾补新怪，引擎文件一个不动。
// 普通模式的 flags 没有这些键 ⇒ 本文件是纯 no-op，零开销。

// [local-patch 2026-10-27] 上游 0.3.2 把 damage.js 拆进 attack/：heal→attack/heal.js，
// periodicDamage→attack/helpers.js，applyHpLoss(battle,src,tgt,amt,dmg)→attack/health.js
// 的 applyHpDecrease(battle, {source,credit,target,dmg}, amt)（同一套 bossPool/fatal 逻辑）。
import { heal } from './attack/heal.js';
import { periodicDamage } from './attack/helpers.js';
import { applyHpDecrease } from './attack/health.js';

const ALLY_AURA = 'trait_ally_aura';
const ENEMY_AURA = 'trait_enemy_aura';
const BLOODLUST = 'trait_bloodlust';
const MELEE_GRID = 1; // 攻击范围只盖贴身格（切比雪夫 ≤1）⇒ 近战代理

/** 近战代理：rangeGrid 的最大偏移 ≤1（打得着贴身格）。没有 rangeGrid 的单位（召唤物等）不算。 */
function isMeleeUnit(u) {
  const grid = Array.isArray(u && u.rangeGrid) ? u.rangeGrid : (u && u.def && Array.isArray(u.def.rangeGrid) ? u.def.rangeGrid : null);
  if (!grid || !grid.length) return false;
  return grid.every(([r, c]) => Math.max(Math.abs(r), Math.abs(c)) <= MELEE_GRID);
}

function allyUnitsOf(battle) {
  const out = [];
  for (const ps of battle.players || []) for (const u of ps.units || []) if (u && u.alive && u.side === 'ally') out.push(u);
  return out;
}

/**
 * 把 battle.flags 里的超限词条静态修正装成常驻光环/行为。flags 没有任何词条键时是纯 no-op。
 * @param {import('./Battle.js').Battle} battle
 */
export function installTraitRule(battle) {
  const f = (battle && battle.flags) || {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  // ── 静态属性光环（标准 mods，全走 _recalc）──────────────────────────────
  const allyMods = {};
  const am = (k, v, skip1) => { const n = num(v); if (n != null && !(skip1 && n === 1)) allyMods[k] = n; };
  am('atkMul', f.allyAtkMul, true);
  am('defMul', f.allyDefMul, true);
  am('resFlat', f.allyResAdd, false);
  am('dodgePhys', f.allyDodgePhys, false);
  am('dodgeArts', f.allyDodgeArts, false);
  am('dmgTakenMul', f.allyTakenMul, true);
  am('spRecoveryFlat', f.allySpRegen, false);
  const enemyMods = {};
  const em = (k, v, skip1) => { const n = num(v); if (n != null && !(skip1 && n === 1)) enemyMods[k] = n; };
  em('defMul', f.enemyDefMul, true);
  em('resFlat', f.enemyResAdd, false);

  // ── 意志/脆壳：近战单位开战获得屏障 / 吃最大生命伤害 ──────────────────────
  const barrierPct = num(f.allyBarrierPct);

  // ── 浴血/颓势：生命越低攻越涨/越跌 ──────────────────────────────────────
  const byMissing = num(f.allyAtkByMissingHp);

  // ── 再生/腐蚀：每 2 秒一跳 ──────────────────────────────────────────────
  const regenPct = num(f.traitRegenPct);
  const corrodePct = num(f.traitCorrodePct);

  const hasAllyWork = Object.keys(allyMods).length > 0 || (barrierPct != null && barrierPct !== 0) || (byMissing != null && byMissing !== 0);
  const hasEnemyWork = Object.keys(enemyMods).length > 0;
  const periodic = regenPct > 0 || corrodePct > 0;
  if (!hasAllyWork && !hasEnemyWork && !periodic) return;

  // 懒武装：第一个 tick（start() 之后单位才 alive）把干员侧的都落位
  let armed = false;
  const arm = () => {
    if (armed) return;
    armed = true;
    const allies = allyUnitsOf(battle);
    if (Object.keys(allyMods).length) {
      for (const u of allies) battle.addBuff(u, { key: ALLY_AURA, mods: { ...allyMods } });
    }
    if (barrierPct != null && barrierPct !== 0) {
      for (const u of allies) {
        if (!isMeleeUnit(u)) continue;
        if (barrierPct > 0) battle.addBuff(u, { key: 'trait_barrier', shield: u.s.maxHp * barrierPct });
        else applyHpDecrease(battle, { source: null, credit: null, target: u, dmg: periodicDamage(u.s.maxHp * -barrierPct) }, u.s.maxHp * -barrierPct);
      }
    }
    if (byMissing != null && byMissing !== 0) {
      const magPct = byMissing * 100; // ±50 / ±30（百分点，units.js atkPct）
      const floor = Math.min(0.95, Math.max(0, num(f.allyAtkByMissingHpFloor) ?? 0.3)); // 30% 生命 → 极值：缺失 70% 映射满
      const span = Math.max(0.05, 1 - floor);
      for (const u of allies) {
        battle.addBuff(u, {
          key: BLOODLUST, mods: { atkPct: 0 }, interval: 0.25,
          onTick: ({ unit, buff }) => {
            if (!unit.alive || !unit.s || unit.s.maxHp <= 0) return;
            const missing = Math.min(1, Math.max(0, 1 - unit.hp / unit.s.maxHp));
            const pct = Math.round(magPct * (missing / span));
            if (!buff.mods || buff.mods.atkPct !== pct) { buff.mods = { atkPct: pct }; unit.markDirty(); }
          },
        });
      }
    }
  };

  let lastSweep = -1;
  let nextJumpAt = 2;
  battle.on('tick', () => {
    const now = battle.time;
    arm();
    // 敌方光环补新怪（每 ~0.1s 一扫，与 infiniteRule 的索敌缓存同节奏）
    if (hasEnemyWork && battle.tickCount - lastSweep >= 3) {
      lastSweep = battle.tickCount;
      for (const e of battle.enemies || []) {
        if (e.alive && !e.findBuff(ENEMY_AURA)) battle.addBuff(e, { key: ENEMY_AURA, mods: { ...enemyMods } });
      }
    }
    if (periodic && now >= nextJumpAt) {
      nextJumpAt = now + 2;
      for (const u of allyUnitsOf(battle)) {
        if (regenPct > 0) heal(battle, null, u, u.s.maxHp * regenPct, { regen: true, silent: true });
        if (corrodePct > 0) applyHpDecrease(battle, { source: null, credit: null, target: u, dmg: periodicDamage(u.s.maxHp * corrodePct) }, u.s.maxHp * corrodePct);
      }
    }
  });
  // 战斗已经开跑的迟装（幂等守卫放行 = 尚未装过）：立即武装
  if (battle.started) arm();
}
