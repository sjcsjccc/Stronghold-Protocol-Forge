#!/usr/bin/env node
// [local-patch 2026-10-27] 官方时装数据并入 data/assets.json —— 补丁⑤的脚本化。
//
// 背景：上游 0.3.2 起用 tools/build-data.mjs 从发布包重生成 data/*.json（每次同步上游都会整文件换掉），
// 而上游的皮肤体系走「插件 overlay」（docs/SKINS.md），官方数据本身不带 chars[<charId>].skins。
// 本仓库的口径是把 273 套官方时装直接并进 data/assets.json（服务端发给每个客户端，无需插件）。
// 皮肤清单维护在 tools/skins-official.json（174 干员），每次同步上游后跑一次本脚本即可：
//
//   node tools/merge-skins.mjs
//
// 只注入 `skins` 子字段，其余字段（portrait/avatar/spine/…）一律以上游重生成结果为准 ——
// 上游 0.3.2 的 chars 集比我们的旧底多（新干员），按 charId 对齐注入，缺失的 charId 连同其皮肤
// 一起跳过并在 stdout 点名（那说明上游删了干员，清单该跟着修）。
import { readFileSync, writeFileSync } from 'node:fs';

const ASSETS = new URL('../data/assets.json', import.meta.url);
const SKINS = new URL('./skins-official.json', import.meta.url);

const assets = JSON.parse(readFileSync(ASSETS, 'utf8'));
const skins = JSON.parse(readFileSync(SKINS, 'utf8'));

let merged = 0, skipped = 0, total = 0;
for (const [charId, entry] of Object.entries(skins)) {
  const target = assets.chars[charId];
  if (!target) { skipped++; console.log(`  跳过（上游无此干员）: ${charId} (${Object.keys(entry.skins).length} 套)`); continue; }
  target.skins = entry.skins;
  merged++; total += Object.keys(entry.skins).length;
}
// 皮肤键里的 # 在 URL 路径段要转义成 %23 —— 清单里存的是已转义好的路径，这里不重复处理，只校验没退化。
const bad = Object.values(assets.chars).flatMap((c) => Object.values(c.skins || {}))
  .flatMap((s) => [s.avatar, s.portrait].filter((p) => p && p.includes('#')));
if (bad.length) { console.error(`发现未转义的 # 路径 ${bad.length} 条，先修 tools/skins-official.json`); process.exit(1); }

writeFileSync(ASSETS, JSON.stringify(assets) + '\n');
console.log(`assets.json 皮肤并入：${merged} 干员 / ${total} 套（跳过 ${skipped}）`);
