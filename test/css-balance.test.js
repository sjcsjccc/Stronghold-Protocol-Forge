// [local-patch 2026-10-27] public/css 语法守门：括号配平 + 注释闭合。
//
// 背景：上游 0.21.0 的 public/css/screens/lobby.css 带两处拼接断裂——一条规则被切掉尾部
// （`.mode-card { … overflow: hidden;` 没有 `}`）、一条悬空选择器（`.mode-card__bg {` 后面
// 直接是下一条规则）。浏览器的 CSS 解析器把断裂点之后的全部规则当作嵌套规则吞掉：
// `.hub-bg{position:absolute}` 等上百条规则集体失效，大厅的背景层变成普通块级元素，
// 把整个大厅 UI 挤出视口——线上表现是「点开始只看到一张背景图」。
//
// 现有 CSS 审计（test/ui/lobby-hub.test.js 等）按正则查文本，抓不住这类结构断裂；
// 这条测试按字符扫描每个 public/css/*.css，断裂时点名文件、括号差与起始行号。
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

/**
 * 扫描 CSS 文本，返回括号深度与未闭合项（注释与字符串里的括号不计）。
 * @param {string} text
 * @returns {{ depth: number, openLines: number[], inComment: boolean, lines: number }}
 */
function scan(text) {
  let i = 0;
  let depth = 0;
  let line = 1;
  let inComment = false;
  let inString = null;
  const openLines = [];
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '\n') line += 1;
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
    if (c === '{') { depth += 1; openLines.push(line); }
    else if (c === '}') {
      depth -= 1;
      if (openLines.length) openLines.pop();
    }
    i += 1;
  }
  return { depth, openLines, inComment, lines: line };
}

describe('public/css: 语法守门（括号配平 + 注释闭合）', () => {
  test('每个 CSS 文件都配平，且没有未闭合注释', () => {
    const files = cssFiles(ROOT);
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
});
