# 本地补丁清单（wsp.sjcsjccc.top 部署定制）

基于 [XiaMo233M/Stronghold-Protocol-Forge](https://github.com/XiaMo233M/Stronghold-Protocol-Forge) **v0.19.1-0.3.1** 的 release 源码（基线提交 = src.zip 原件，逐字节未动）。

部署形态：hk 服务器 Docker 容器（源码树与 main 分支逐字节一致，Dockerfile 构建；素材 assets/fonts 不在本仓库，来自 win-x64 包运行时挂载）。

## 补丁一览

| # | 提交 | 文件 | 改动 | 一句话 |
|---|------|------|------|--------|
| 1 | AI 模拟切片 | `server/match/fields.js` | `HEADLESS_SLICE_MS` 8→40 | 真人清场后等 AI 出结果快 5 倍 |
| 2 | 大厅在线人数 | `public/js/screens/lobby.js` | +15s 轮询 /healthz 直写 DOM | 修复上游「N 名博士在线」恒死值 |
| 3 | 战局一览 | `server/lobby.js` `shared/protocol.js` | +`room.list` 分发与声明 | 唤醒客户端沉睡的大厅观战 UI |
| 4 | 整备期免倒计时 | `server/match/match/prep.js` | `isSolo`→`soloUntimed` | 1 真人 + N AI 房整备不限时 |
| 5 | 卡池乘数缩放 | `server/match/Match.js` `server/match/gamedata.js` | 乘数 `max(2, ceil(开局人数/2))` | 超编房不再 20 人抢 4 人份牌 |
| 6 | 卡池余量面板 | `server/match/match/intents.js` `shared/protocol.js` `public/js/ui/shopBar.js` `public/js/ui/poolPanel.js`(新) | +`g.pool`/`m.pool` +面板 UI；**2026-10-21 修正：读 `ps.mainPool()`**（>4 人变体局每人独立牌库，`m.pool` 只是目录——修正前面板数字不随买卡变动） | 整备期查看每个干员剩余张数 |
| 7 | 房主对局倍速 | `server/match/Match.js` `server/match/match/intents.js` `server/match/match/clientCombat.js` `server/match/fields.js` `shared/protocol.js` `public/js/screens/game.js` | +`g.matchSpeed`（仅房主，×1–×4） | 全房真人与 AI 统一战斗节奏 |
| 7b | 插件局倍速修复 | `server/match/host/proxy.js` | `wireOptions` 载荷带上 `hostId`（原来只给 test 局传）；`setHost` 房主迁移不再只对 test 局生效 | 插件局（match host 沙箱）里 `match.hostId=null`，房主倍速请求全部 NOT_HOST——修复后实测沙箱内 ×2/×3 生效 |
| 9 | 牌池按小队共享 | `server/match/player/rules.js` `server/match/Match.js` `server/match/gamedata.js` `server/match/invariants.js` `test/ps100-variant-ac.test.js` `test/match/poolViewVariant.test.js` | 变体局（>4 参战者）牌池从「每人一池」（百卫原设计 A）改为**每小队（4 席）一池、组间独立**；守恒式/卡池面板/`poolOf` 分派全按小队走；密度按池的实际共享人数（4 席 ⇒ 官方 2×，`GameData.poolShare`） | 4 人组的官方手感：组内协作抢牌、组间互不干扰 |
| 8 | 机变按小队 | `server/match/match/spDraft.js` `server/match/match/views.js` `server/match/player/views.js` `server/match/match/phases.js` `server/match/match/platform.js` `server/match/match/testCommands.js` `server/match/audit.js` `server/match/Match.js` `public/js/screens/game.js` `public/js/ui/gameLogic/phases.js` `test/match/spDraftSquads.test.js`(新) | >4 参战者时每个小队（按座位 floor(seat/4) 分队）各发一副 6 张并行选，走私密视图 | 超编房机变不再「第 7 人起空手」，一屏仍是 3×2 六张 |

所有代码内改动都带 `[local-patch 2026-10-19|20|21]` 注释标记，可全文搜索定位。

## 关键机制笔记（改前必读）

- **倍速语义**（补丁 7）：官方基速 `GAME_SPEED=2` × 房主 `matchRate(1–4)` = `gameSpeed`，b.start 的 speed、真人场截止、AI/托管场释放、BOSS pacer 全从这一个值派生——改它即全房一致加速，tick 序列与战果不变。房主的顶栏倍速按钮 = 设对局倍速（服务端裁决、乐观更新）；非房主的按钮仍是个人本地回放倍速。改速后 `rearmFieldTimers` 只重排服务端代跑场的释放，真人正在打的一场照旧打完。`AI_FIELD_SPEED`（fields.js，默认 1，`SP_AI_FIELD_SPEED` 可调）是「AI 比真人更快」的附加后门，与房主倍速相乘。
- **lobby 消息分发**：handler 必须自己 `sendSession(session, {...})` 发回执（**必须带请求 rid**）并 `return OK`；直接 return 载荷会被无声丢弃。
- **游戏内弹窗三件套**：Modal 遮罩/盒子默认 `pointer-events: none`（不挡战场操作）⇒ ① 内容根节点显式 `pointerEvents:'auto'`，否则整个面板「看得见摸不着」、触摸穿透到战场画布；② 滚动区要 `touch-action: pan-y`（战场容器是 `touch-action:none`）；③ 必须自带「关闭」按钮（点空白关闭与 Esc 全死）。
- **协议加类型**：C2S/S2C 表里声明即可（`PROTOCOL_VERSION` 不动），客户端按 hello 广播目录自动识别。
- **牌池按小队共享**（补丁 9，2026-10-21）：变体局的牌池结构从百卫原设计 A（每人一整副独立池）改为**每小队一副**——缓存挂在 Match 上（`m._squadPools`，键 = `floor(seat/4)`），`PlayerRules.pool()`/`poolOf()`/`mainPool()` 分派点不变只是落点变；`invariants.js` 与 harness 的守恒式改成按小队分组（`squad <k> pool <base>: left+held != cap`，读 `m._squadPools` **绝不建池**）。密度：`GameData.poolShare`（变体=4、否则=开局人数）进 `poolCopies()` —— 每个小队池 = 官方 4 人房 2×，补丁⑤的「随人数膨胀」只对 ≤4 共享池有意义了。卡池面板（补丁⑥）读 `ps.mainPool()`，变体局显示的即本小队池的实时余量。**教训：动池结构必须同步三处消费**——分派（rules）、守恒（invariants+harness）、面板（intents poolView）。
- **机变按小队**（补丁 8）：闸门 = `Match.variant`（**在场参战者 > 4**，与联防分场同口径；座位数不看）。变体下 `m.sp` 恒为 null，各小队状态在 `m.spSquads[]`，玩家各自的小队草稿经 `MatchViews.spViewFor` 进 `m.private.sp`（形状与旧 `m.public.sp` 完全一致，多带 `turnDeadline`/`squad`），客户端只改了一处读取（`priv?.sp ?? pub?.sp`）与倒计时来源。每队独立回合链（超时自动随机拿牌照旧）、卡被拿只在自己队里算 SOLD_OUT；结算/审计口径不变。≤4 参战者逐字节走原路径（黄金序列不动）。注意 `docs/PS100-MIGRATION.md` §10-B 的原设计是「百卫 25 队并发+不设计时器」，本实现是它的 4 人小队版：计时保留（单真人房仍 `soloUntimed` 不限时）。
单人房映射 `mode_single_*`、同盟房映射 `mode_multi_*`，同名难度曲线不同（联合版更陡）；BOSS 血池 = 基础 × 开战存活数（上限房座数）；牌库按星级固定张数 12/14/18/16/8/5（1-6★），联合房整体乘 `coopPoolMultiplier`。

## 验证方法

- 服务端补丁：容器内 `grep` 补丁标记（如 `HEADLESS_SLICE_MS = 40`、`soloUntimed) return null`）。
- 卡池乘数：容器内跑 `/tmp/pool-smoke.mjs`（GameData 直构，4p→10、5p→15、20p→50）。
- 房主倍速：`docker logs stronghold-forge | grep "match speed"`（每次调整都有一条 `host ... set match speed ×N (gameSpeed M)`）。
- 客户端改动：浏览器有 Service Worker 缓存，**验证必须清 Cache Storage / 注销 SW**；自动化验收可用 browser-use 真局实测（elementFromPoint 命中、cua.scroll 实滚）。
- browser-use 实测卫生：测试局结束必须点「离开」；SOLO 局断线保护 24h（`singleReconnectTime`），直接关页面会留幻影房（清场=`docker restart stronghold-forge`，先看 healthz 有没有别人在线）。

## 更新上游版本的流程

1. 下载新 release 的 `src.zip` + `win-x64.zip`；
2. src.zip 解压为新基线，重放本仓库的补丁文件（都是独立文件替换，冲突面小；`shared/protocol.js` 同时承载 3/6/7 三个补丁，注意三段都补）；
3. win-x64 抽 `public/assets`、`public/fonts` 挂载（1.2GB，不入库）；
4. `docker build -t stronghold-forge:<新版本> . && docker rm -f stronghold-forge && docker run ...`（run 参数见部署笔记）。

## 回滚

每个补丁一个独立提交，`git revert <commit>` 即可单独摘除任一补丁；服务器上另有历史档案 `/data/forge-duel/patches/*.{orig,patched}`。
