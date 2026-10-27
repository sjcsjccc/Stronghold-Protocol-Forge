// [local-patch 2026-10-27] public/css 结构守门：括号配平 + 注释闭合 + 无"吞规则"嵌套。
//
// 背景：上游 0.21.0 的 public/css/screens/lobby.css 与 room.css 带多处拼接断裂（移植时的并集
// 合并把旧设计的规则切在属性中间、又留下无选择器的孤儿残尾），两类伤互补后**括号居然是配平的**，
// 但浏览器的 CSS 解析器把断裂点之后的上百条规则当作嵌套规则吞掉——`.hub-bg{position:absolute}`、
// `.hub-entry{display:flex}` 等集体失效，线上表现是「点开始只见一张背景图」「模式卡变成裸按钮」。
//
// 两类检查（本代码库不使用 CSS 嵌套，出现嵌套即断裂）：
//   1. 括号配平 + 注释闭合 —— 抓「多 } / 少 }」与未闭合注释；
//   2. style 规则体内不得再开块 —— 抓「少 } 但被另一处多 } 补偿」的吞规则伤（第 1 类查不出）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../public', import.meta.url));

function cssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cssFiles(p));
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

/** 一次扫描得出：括号深度、未闭合 `{` 行、注释是否未闭合、以及 style 规则内的嵌套块。 */
function scan(text) {
  let i = 0;
  let depth = 0;
  let line = 1;
  let inComment = false;
  let inString = null;
  const openLines = [];
  const nested = [];
  const stack = []; // { line, isAt }
  let header = '';
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '\n') { line += 1; header = ''; }
    if (inComment) {
      if (text.startsWith('*/', i)) { inComment = false; i += 2; continue; }
      i += 1; continue;
    }
    if (inString) {
      if (c === '\\') { i += 2; continue; }
      if (c === inString) inString = null;
      i += 1; continue;
    }
    if (text.startsWith('/*', i)) { inComment = true; i += 2; continue; }
    if (c === '"' || c === "'") { inString = c; i += 1; continue; }
    if (c === '{') {
      const isAt = header.trim().startsWith('@');
      if (stack.length && !stack[stack.length - 1].isAt && !isAt) {
        nested.push({ parentLine: stack[stack.length - 1].line, childLine: line, child: header.trim().slice(0, 60) });
      }
      stack.push({ line, isAt });
      depth += 1;
      openLines.push(line);
      header = '';
    } else if (c === '}') {
      depth -= 1;
      if (openLines.length) openLines.pop();
      if (stack.length) stack.pop();
      header = '';
    } else {
      header += c;
    }
    i += 1;
  }
  return { depth, openLines, inComment, nested, lines: line };
}

describe('public/css: 结构守门（配平 + 注释 + 无嵌套）', () => {
  const files = cssFiles(ROOT);

  test('每个 CSS 文件都配平，且没有未闭合注释', () => {
    assert.ok(files.length >= 20, `扫到 ${files.length} 个 CSS 文件（预期 20+）`);
    const bad = [];
    for (const f of files) {
      const r = scan(readFileSync(f, 'utf8'));
      const rel = relative(ROOT, f).replaceAll('\\', '/');
      if (r.depth !== 0) bad.push(`${rel}: 括号差 ${r.depth}（未闭合的 { 起始行：${r.openLines.slice(0, 6).join(', ')}）`);
      if (r.inComment) bad.push(`${rel}: 注释未闭合（缺 */）`);
    }
    assert.deepEqual(bad, [], `CSS 结构断裂：\n${bad.join('\n')}`);
  });

  test('没有 style 规则吞掉后续规则（本库不用 CSS 嵌套：出现即前面某条丢了 }）', () => {
    const bad = [];
    for (const f of files) {
      const r = scan(readFileSync(f, 'utf8'));
      if (!r.nested.length) continue;
      const rel = relative(ROOT, f).replaceAll('\\', '/');
      for (const hit of r.nested.slice(0, 8)) {
        bad.push(`${rel}: 行${hit.parentLine} 的规则吞了 行${hit.childLine}（${hit.child}）——它丢了 }`);
      }
    }
    assert.deepEqual(bad, [], `CSS 吞规则断裂：\n${bad.join('\n')}`);
  });
});
