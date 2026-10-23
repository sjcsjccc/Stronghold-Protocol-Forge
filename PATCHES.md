# 本地补丁清单（wsp.sjcsjccc.top 部署定制）

基于 [XiaMo233M/Stronghold-Protocol-Forge](https://github.com/XiaMo233M/Stronghold-Protocol-Forge) **v0.19.1-0.3.1** 的 release 源码（基线提交 = src.zip 原件，逐字节未动）。

部署形态：hk 服务器 Docker 容器（源码树与 main 分支逐字节一致，Dockerfile 构建；素材 assets/fonts 不在本仓库，来自 win-x64 包运行时挂载）。

## 补丁一览

| # | 提交 | 文件 | 改动 | 一句话 |
|---|------|------|------|--------|
| 17 | 超限 Boss 轮休整期预览 | `shared/infiniteMode.js` `server/match/infiniteWaves.js` `public/js/ui/gameLogic/camera.js` `server/match/match/testCommands.js` `test/match/infinite.test.js` `test/ui/random-boss-pairs.test.js` | 超限的 Boss 轮（R20/25/30…）休整期两处缺口：①`buildInfiniteBossWave` 的领袖条目补官方同款 `preview.start` 出生格（取 Boss 场路径起点，正是官方领袖门 (2,10)/(5,10)）——客户端 `leaderStand` 只认带 start 的 boss 条目，没有它领袖不上场；②客户端 `prepCamera`/`teamFrameIds` 只认 `round===bossRound(14)/hiddenRound(15)`，超限 Boss 轮切不进 Boss 场准备相机（留在普通战场=笔围栏一群小怪、场上没领袖）——判定提到 shared（`isInfiniteBossRound`），服务端重导出同一份；③测试控制台的轮次跳转上限从官方 lastRound(15) 放开：超限没有「最后一轮」，上限用 TEST_ROUND_MAX（仅测试房、房主可用）。浏览器实测（本地测试房）：R20 休整期切 Boss 场相机、领袖站场带血条；普通模式 R14 本就正常（领袖站场）未动 | 休整期看得到要打的 Boss，而不是一群小怪 |
| 1 | AI 模拟切片 | `server/match/fields.js` | `HEADLESS_SLICE_MS` 8→40 | 真人清场后等 AI 出结果快 5 倍 |
| 2 | 大厅在线人数 | `public/js/screens/lobby.js` | +15s 轮询 /healthz 直写 DOM | 修复上游「N 名博士在线」恒死值 |
| 3 | 战局一览 | `server/lobby.js` `shared/protocol.js` | +`room.list` 分发与声明 | 唤醒客户端沉睡的大厅观战 UI |
| 4 | 整备期免倒计时 | `server/match/match/prep.js` | `isSolo`→`soloUntimed` | 1 真人 + N AI 房整备不限时 |
| 5 | 卡池乘数缩放 | `server/match/Match.js` `server/match/gamedata.js` | 乘数 `max(2, ceil(开局人数/2))` | 超编房不再 20 人抢 4 人份牌 |
| 6 | 卡池余量面板 | `server/match/match/intents.js` `shared/protocol.js` `public/js/ui/shopBar.js` `public/js/ui/poolPanel.js`(新) | +`g.pool`/`m.pool` +面板 UI；**2026-10-21 修正：读 `ps.mainPool()`**（>4 人变体局每人独立牌库，`m.pool` 只是目录——修正前面板数字不随买卡变动） | 整备期查看每个干员剩余张数 |
| 7 | 房主对局倍速 | `server/match/Match.js` `server/match/match/intents.js` `server/match/match/clientCombat.js` `server/match/fields.js` `shared/protocol.js` `public/js/screens/game.js` | +`g.matchSpeed`（仅房主，×1–×4） | 全房真人与 AI 统一战斗节奏 |
| 7b | 插件局倍速修复 | `server/match/host/proxy.js` | `wireOptions` 载荷带上 `hostId`（原来只给 test 局传）；`setHost` 房主迁移不再只对 test 局生效 | 插件局（match host 沙箱）里 `match.hostId=null`，房主倍速请求全部 NOT_HOST——修复后实测沙箱内 ×2/×3 生效 |
| 11 | 观战席房主可调 | `shared/constants.js` `shared/protocol.js` `server/lobby.js` `public/js/screens/room.js` `test/lobby.test.js` | `room.setSpectatorCap { code, cap }`（仅房主、大厅与对局中都可调、solo 房拒绝）；观战席从写死 2 改为房主滑杆 0–20，**默认 5**；`room.state.spectatorCap` 仅在偏离默认时下发（帧稳定惯例）；观战门槛现读房间实时值，已入座者不因下调被移出 | 满员观战/直播场景随开随调，多出的观战者只耗带宽不碰游戏逻辑 |
| 10 | 联防跨队兜底补漏 | `server/match/unite100.mjs` `server/match/match/unitePhase.js` `test/ps100-variant-ac.test.js` | 变体局联防阶段 2 原本只接力「阶段 1 出过场的计划」的残余——**全队都漏、没有完美成员的小队连场都出不了，漏怪直接结算扣 LP**；修复=这类无计划小队折成合成计划（`carveSquadLeaks` 抽出共享）进同一轮接力，按剩余实力转给别队完美成员，账仍记原漏怪玩家 | 设计原文「whatever phase 1 did not stop」的全覆盖：最需要兜底的小队不再被跳过 |
| 9 | 牌池按小队共享 | `server/match/player/rules.js` `server/match/Match.js` `server/match/gamedata.js` `server/match/invariants.js` `test/ps100-variant-ac.test.js` `test/match/poolViewVariant.test.js` | 变体局（>4 参战者）牌池从「每人一池」（百卫原设计 A）改为**每小队（4 席）一池、组间独立**；守恒式/卡池面板/`poolOf` 分派全按小队走；密度按池的实际共享人数（4 席 ⇒ 官方 2×，`GameData.poolShare`） | 4 人组的官方手感：组内协作抢牌、组间互不干扰 |
| 13 | 超限模拟（无限模式）+ AI 弹幕/聊天 + 上游数据同步 | `shared/infiniteMode.js`(新) `server/match/infiniteWaves.js`(新) `server/match/traits.js`(新) `server/match/match/traitDraft.js`(新) `server/sim/infiniteRule.js`(新) `server/match/Match.js` `server/match/match/{phases,settle,views,combat,prep,bossRounds,unitePhase,intents,platform}.js` `server/match/{gamedata,results,builtinMeta,StubMatch}.js` `server/lobby.js` `shared/{constants,protocol}.js` `public/js/**`（游戏内聊天 chatBox/roomDanmaku/aiDanmakuEvents、lobby 入口、hud 词条面板、traitOverlay、结算徽记） | ①`room.create` 新模式 `solo_infinite`：R1–R15 绝境曲线、R16 起指数膨胀波次、R20 起每 5 回合真 Boss 轮（R45 双 Boss）、盟约层数上限 9999、限伤放宽 + 密集索敌节流 + 霸体状态机（infiniteRule）、词条抉择三选一（正面/负面交替，选中的怪下轮出场）、战术撤退按当前回合结算（**2026-10-22 二次修正：加速不用上游的 SPEED 1×/2× 战斗内开关，改走与独立/同盟统一的房主倍速 g.matchSpeed ×1–4**——该开关整链已拆：g.combatSpeed 协议/setCombatSpeed/speedPref/SpeedToggle）；②游戏内文字聊天 + 全屏弹幕 + AI 队友彩蛋弹幕（盟约层数名言/联防吐槽，上游未接线的管理器在此接进 game.js）；③上游 0.3.1.1 的数据同步逐字段合并 | 来自我的服务器，玩自己的无尽模式；观战和局内都有话说 |
| 16 | 设置·素材存储 | `public/js/ui/settings.js` `public/i18n/en.json` | 设置弹窗补「素材存储 STORAGE」节（照上游 master）：申请持久保存（navigator.storage.persist，浏览器空间紧张时不再清掉素材缓存）+ 清理旧版本素材（pruneImportedAssets，删服务器清单不再引用的导入件）；助手 storagePersisted/askPersistStorage/pruneImportedAssets fork 里本来就有，只有这节接线没接 | 玩家的素材缓存不再被浏览器悄悄清掉；顺带能清旧版导入件 |
| 15 | 主页素材包按钮 | `public/js/screens/title.js` | fork 组件（ui/assetDownload + assetImport）与 `.title-assets` 样式一直在，唯独 title.js 的渲染段没了——照上游 0.3.1 补回「下载完整素材 / 导入素材包」双按钮（登录框下方，Android 壳里不显示；下载走本服 18294 文件清单进浏览器缓存，实测 62 文件/11.5MB 后暂停恢复正常） | 和上游一样：玩家可把美术预取进浏览器缓存，或自带素材包不占服务器流量 |
| 14 | 超限模拟·联机 | `shared/infiniteMode.js` `shared/protocol.js` `server/match/Match.js` `server/match/match/{traitDraft,views}.js` `server/lobby.js` `public/js/screens/{lobby,room,game}.js` `public/js/ui/traitOverlay.js` `public/css/traitOverlay.css` `public/i18n/en.json` `test/match/infinite.test.js` | ①`room.create` 新模式 `infinite`（盟形状联机超限）：与 solo_infinite 共用全部超限规则（isInfinite 点亮 → 绝境曲线/无限波次/真 Boss 轮/infiniteRule/层数 9999 全部复用），Match.mode 走 `coop` → 共享波次/联防/Boss 配对原样；②词条抉择照机变改**轮转引擎**：coop 洗牌 + humansFirst 轮流各选一张，词条全进同一份 traitMods（整队共享），每回合 gd.timer 限时、超时服务端随机代选、AI 队友 scheduleTraitBot 代选；soloUntimed（solo/单人类）不限时与旧单人实现逐字节同效；③战术撤退限单人超限（联机局按钮不渲染 + 服务端 BAD_TARGET）；④座位闸：超限房 seatCap ≤ MAX_SEATS（>4 进变体而词条没有小队变体）；⑤客户端：大厅超限卡改公开建房（进缺人同盟列表）、房间页「超限模拟」标签、traitOverlay 等待条（轮到谁+超时代选提示）与已选徽记 | 超限能和好友一起无尽；不勾选也全域生效的工坊包道路走不通后的正解 |
| 12 | 观战表情 + 对局踢人 | `server/lobby.js` `server/match/match/platform.js` `server/match/match/intents.js` `server/match/Match.js` `server/match/match/watch.js` `server/match/StubMatch.js` `public/js/screens/game.js` `public/js/ui/hud.js` `public/js/ui/teamPanel.js` `public/js/ui/gameActions.js` `public/css/screens/game.css` `test/lobby.test.js` `test/lobby-kick.test.js` | ①观战席放行 `g.emote`（lobby `routeGameNow` + match `platform.handle` 两道闸门；冷却挂 match 的 `spectatorEmoteAt` 表——观战 stand-in 是冻结对象写不了 `lastEmoteAt`），气泡浮在顶栏观战席胶囊下（TeamPanel 只挂参战者行）；②`room.kick` 去掉对局中禁令——`removeMember` 本身就按 `room.match` 分岔（座位保留标 left + match.onLeave 中途退出结算 + 房主迁移/空房回收），被踢者收 `room.closed {kicked}`；客户端 TeamPanel 行内 ✕（房主可见，确认弹窗） | 观战者能刷表情参与气氛；房主能把挂机/捣乱者当场请出对局 |
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
