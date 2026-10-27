# 卫戍协议：盟约 — Web Remake · Architecture & Contracts (DESIGN.md)

This is the **single source of truth** for every implementer. Research lives in `docs/research/` (start with `00-INDEX.md`; where a research file's body and its "Addendum (critic)" disagree, the addendum wins). When this document and research disagree, **this document wins**; when this document is silent, follow research; when both are silent, choose the simplest faithful behaviour and write it down in the module's header comment.

Language: player-facing text is **Simplified Chinese** by default, with an English switch since 0.2.0 (§25.2, docs/I18N.md: UI strings through `t('中文')`, game texts from the official Chinese data or the official EN client's). Code, comments and identifiers are English.

Versions: the first public release was **0.1.0** (2026-10-02, the state of §0–§20.15); the releases after it add the player feedback and GitHub reports — 0.1.1 §21, 0.1.2 §22, 0.1.3 §23, 0.1.4 §24 — and **0.2.0** (2026-10-07; `CHANGELOG.md`) the maintainability refactor, two languages, 补位, 自选编队 and their fidelity work — §25 — **0.2.1** (2026-10-07) the 联防 battlefield restored, full potential and the GitHub fixes after it — §26 — and **0.2.2** (2026-10-09) per-operator 潜能 / 练度, Japanese voices, the statistics page, 失衡, whole-frame attack timing and the GitHub fixes after 0.2.1 — §27. **0.2.3** (2026-10-10; `package.json`, `shared/constants.js APP_VERSION`) 克莱门莎 and new modules, community fixes, text size, per-operator voices, installation, the opening reroll and local match recovery — §28. **0.2.4** (2026-10-11) the official shared card pool and item stock, Raid revival and #475, and the community fixes after 0.2.3 — §29. **0.2.5** (2026-10-12) fixed gifts and already displayed operator offers under the shared stock, random boss pairing, the official battlefield scenes on the 3D board (optional local art: the full bundle includes them when extracted, a missing scene keeps the metal board; §15, §30.21), the official damage-number option, the 驭械术师 / hit-tile / bot ports and the community fixes after 0.2.4 — §30; its rules supersede the corresponding 0.2.4 ones. **0.2.6** (2026-10-13) the host-bandwidth layers 0 and 1 (no BGM download while the music is silent, WebSocket compression, content-hashed asset URLs with long caching, brotli, WebP guide pages), the official scene light gains, the impostor bounds, the deploy-animation replays, the optional ammo count and the community fixes after 0.2.5 — §31; its rules supersede the corresponding 0.2.5 ones. **0.3.0** (2026-10-14) the plugin system (插件) and the fixes after 0.2.6 — §32; **0.3.1** (2026-10-18) the Forge-pack additions, the studio templates and the fixes after 0.3.0 — §34; **0.3.2** (2026-10-24) the fixes after 0.3.1 — [§35](history/0.3.2.md), the state this document describes; it includes the first two milestones of the official version switch: M0 (§37.22: the version registry, the builds of the earlier versions, behaviour keyed by charId / effectId, the default pinned by tests), invisible to players, and M1 (§37.23: the lobby's version button, the room's version switched by the host's vote, version match hosts, settings by operator and statistics by version), enabled by default for all four official versions (`SP_VERSIONS` narrows the list, §37.23.11). The labels v1 / v2 / v2.1–v2.5.2 in §0, §14–§20 and in the BALANCE / SIM comparisons name the design generations and the private playtest builds that came before it; they are kept as history.

---

The 0.3.1 Forge integration/browser polish is [§36.27](history/0.3.1.md#3427-plugin-polish-after-the-end-to-end-checks):
companion cosmetic hints, accurate import reports, record DSL permission checks and usable result panels (§32.8/§32.12).

Studio presentation authoring extends §32.9 in [§36.30](history/0.3.1.md#3430-studio-templates-for-the-031-presentation-features): theme, notices, fx and skins forms reuse the existing validators, slots and trial routes.

Blemishine S2 attack clips extend §9 in [§36.31](history/0.3.1.md#3431-official-effects-and-a-skill-clip-the-maintainer-reported-after-030):
a verified mode mapping for 瑕光 S2 only, with or without the effects index; held skill loops and every other skill keep their roles.

The verified list expands in [§37.20](history/0.3.2.md#3520-verified-skill-attack-clips): 德克萨斯 S1/S2, 伺夜 S1/S2,
归溟幽灵鲨 S1, 焰影苇草 S2 and 耀骑士临光 S2 use their model's normal attack role across facings and skins.
The earlier 郁金香 S2 candidate remains unimplemented for the identity mismatch documented in
[§37.21](history/0.3.2.md#3521-tulips-s2-candidate-remains-unimplemented). Current contract: [design/client.md](design/client.md).

The 0.3.1 sim investigation and rule correction are [§36.32](history/0.3.1.md#3432-瑕光-attacks-the-enemies-she-put-to-sleep-琳琅诗怀雅s-s3-keeps-its-coins):
瑕光 S2 retains sleeper targeting and attack replay events; 琳琅诗怀雅 S3 keeps double attacks and coins at the cap,
following the official mode's no-auto-close rule. Current contracts: [design/engine.md](design/engine.md).

Q / X prefer the selected operator, otherwise the hovered operator (PR #859, the maintainer's decision of 2026-10-23) in
[§37.31](history/0.3.2.md#3531-q--x-prefer-the-selected-operator-otherwise-use-hover-pr-859-felixsion28).
Current interaction contract: [design/client.md](design/client.md).

设置 → 异形屏适配 →「界面大小」 (75–100 %, manual, default 100 %, at 文字大小 小 only) scales the layout root and every
px floor while the touch floor stays: [§37.43](history/0.3.2.md#3543-界面大小-in-异形屏适配-837-pr-838-reworked-zasx77771); contract:
[design/client.md](design/client.md).

The damage settlement follows PRTS 伤判效果 / 伤害分类 since 0.3.2 (@Siornya's series): the public entry
server/sim/attack.js and fixed before percentage penetration in
[§37.30](history/0.3.2.md#3530-settlement-penetration-order-prs-796-and-798-siornya), the ordered pipeline and the
consumers that depend on it in [§37.32](history/0.3.2.md#3532-ordered-settlement-pipeline-and-dependent-consumers-pr-802-siornya)–§37.34,
the contract and the series' verification in [§37.35](history/0.3.2.md#3535-settlement-contract-and-the-series-verification-pr-856-siornya).
Current contracts: [design/engine.md](design/engine.md) §5.5 and [SIM.md](SIM.md) §4. The batch's merge review
(burst damage dodgeable, fixed reductions by name, #848's manifest, 界面大小 at 小 only) is
[§37.44](history/0.3.2.md#3544-merge-review-of-the-pr-batch-2026-10-23); its second review (the injury fields in SIM §3,
the 界面大小 reading) is [§37.45](history/0.3.2.md#3545-second-review-of-the-pr-batch-2026-10-23), the third
[§37.46](history/0.3.2.md#3546-third-review-of-the-pr-batch-2026-10-23), the fourth (界面大小's disabled row and the lobby
dialogs at 75 %, #796's credit, one dodge notice per masked hit, the single-human reroll throttle)
[§37.47](history/0.3.2.md#3547-fourth-review-of-the-pr-batch-2026-10-23).

Picture-only outfits become wearable under the maintainer's 2026-10-18 option A in
[§37.4](history/0.3.2.md#354-picture-only-outfits-b6): per-seat pictures with default battle models;
current rendering rules are in [design/client.md](design/client.md) and [SKINS.md](SKINS.md).

Re-entrant buff removal is specified in [§37.5](history/0.3.2.md#355-re-entrant-buff-removal): reverse-order candidates,
current object lookup and actual removal counts; [ASSUMED] extension API policy. Current contract: [design/engine.md](design/engine.md) §5.3 and [SIM.md](SIM.md) §3.

Wild Mane S2's rear-target exception is superseded by the maintainer's official recordings in
[§37.10](history/0.3.2.md#3510-wild-mane-s2-rear-push-782): radial away, force level −2, about 0.09 tile at weight 1.
Front distances stay unchanged; using the effect column only behind her is [ASSUMED] scope, not an official
direction-dependent classification. Current contract: [design/engine.md](design/engine.md) §5.4 and [SIM.md](SIM.md) §6.

盐风主教昆图斯's attack-class 大潮 / 崩坍 take the normal attack's turn under PRTS's skill rules in
[§37.19](history/0.3.2.md#3519-quintuss-tide-takes-the-attacks-turn-maintainer-recordings-2026-10-22): cooldowns
from the clip's end, equal priorities at random, 断裂生殖 limited to its level branch. The other leaders and enemies
follow the same turns in §37.29 / §37.52; longer clips hold the next attack and “自在”'s 破桎而出 needs an attack target
in §37.54. 昆图斯's 断裂生殖 / 物种爆发 join the turns in §37.55. Current contract: [SIM.md](SIM.md) §1.2 and
[design/engine.md](design/engine.md) §7. Attack-turn casts play their official clips in §37.57
([design/client.md](design/client.md)); the draft and briefing headers and the 机变 overlay fit larger text in §37.56.

The official version switch starts in 0.3.2 with M0, recorded in
[§37.22](history/0.3.2.md#3522-official-versions-groundwork-m0): four versions named by period, as the maintainer named
them on 2026-10-22 — 第一期 is the official `act1autochess` (「卫戍协议：盟约」 上半期活动), 第二期 `act2autochess` (下半期活动),
and each period's 上半 / 下半 its sub-versions V1_1 / V1_2 and V2_1 / V2_2; 第二期下半, today's game, stays the default
byte for byte. M1, recorded in [§37.23](history/0.3.2.md#3523-official-versions-the-version-switch-m1), makes them
playable by default (all four; `SP_VERSIONS` narrows the list, [§37.23.11](history/0.3.2.md#352311-every-official-version-is-enabled-unless-the-list-is-narrowed)): each player's lobby switch, the room's version
switched before the match by a unanimous vote of the seated humans (the host proposes, as in 重刷), one match process per
version; the earlier versions still play with 第二期下半's rules where they differ (M2). Current contract:
[DATA.md](DATA.md) "Official versions (M0)" (registry, profiles, builds) and "Serving the versions (M1)",
[design/network.md](design/network.md) §8.5 (the messages), [design/client.md](design/client.md) "Official versions"
and [SIM.md](SIM.md) §7.2 (behaviour keyed by charId / effectId).

## Where each section lives

The sourced freeze/redeployment advisor recipes in [§37.12](history/0.3.2.md#3512-regenerable-advisor-strategy-playbook)
require reachable named core roles and distinct thresholds; current data overrides community shorthand.
These are [ASSUMED] recommendations, specified in [AI-STRATEGY §9](AI-STRATEGY.md#9-sourced-freeze-and-redeployment-builds-assumed).

Optional selected-unit bond timers (#746, maintainer approved 2026-10-18) extend §9 in
[§37.3](history/0.3.2.md#353-optional-selected-unit-bond-timers-746): default-off convenience HUD, independent Sargon
stack expiry and separate Siracusa deployment/stealth/post-stealth effects, all read from simulation snapshots.
The official game has no numeric timer HUD; the presentation is [ASSUMED]. Current contract: [design/client.md](design/client.md).

Studio §32.9 gains five graphical gameplay templates and isolated Match exercises in
[§36.29](history/0.3.1.md#3429-studio-templates-for-the-031-gameplay-features); the current UI contract is in
[design/client.md](design/client.md#plugin-studio-gameplay-previews-3291).

Section numbers are global and never change: code, tests and the other documents cite them as "DESIGN §N". The
current rules by area are in `docs/design/`, the per-release revisions (the evidence behind each rule) in
`docs/history/`. When a revision changes a rule, the rule in `docs/design/` is rewritten too (the revision lists the
normative lines it rewrote).

| sections | file | content |
|---|---|---|
| §0, §1, §2, §11, §12 | [design/overview.md](design/overview.md) | Scope, stack, repository layout, quality bar |
| §3, §4 | [design/geometry-time.md](design/geometry-time.md) | Coordinates, fields, geometry and time |
| §5, §7 | [design/engine.md](design/engine.md) | The battle engine (server/sim) and content modules |
| §6, §16 | [design/match.md](design/match.md) | The match and meta engine (server/match), operator loadouts |
| §8, §14 | [design/network.md](design/network.md) | The network protocol and client-side combat |
| §9, §10, §13, §15 | [design/client.md](design/client.md) | Rendering, UI, local-client art, the 3D board |
| §17 | [history/v2.2-playtest3.md](history/v2.2-playtest3.md) | User playtest #3 (v2.2) |
| §18 | [history/v2.3-playtest4.md](history/v2.3-playtest4.md) | User playtest #4 (v2.3) |
| §19 | [history/v2.4-playtest5.md](history/v2.4-playtest5.md) | User playtest #5 (v2.4) |
| §20 | [history/v2.5-playtest6.md](history/v2.5-playtest6.md) | User playtest #6 (v2.5) and its follow-ups, up to 0.1.0 |
| §21 | [history/0.1.1.md](history/0.1.1.md) | 0.1.1 — player feedback after 0.1.0 |
| §22 | [history/0.1.2.md](history/0.1.2.md) | 0.1.2 — GitHub issues after 0.1.1 |
| §23 | [history/0.1.3.md](history/0.1.3.md) | 0.1.3 — community reports after 0.1.2 |
| §24 | [history/0.1.4.md](history/0.1.4.md) | 0.1.4 — community reports after 0.1.3 |
| §25 | [history/0.2.0.md](history/0.2.0.md) | 0.2.0 |
| §26 | [history/0.2.1.md](history/0.2.1.md) | 0.2.1 — after the 0.2.0 release |
| §27 | [history/0.2.2.md](history/0.2.2.md) | 0.2.2 — after the 0.2.1 release (2026-10-09) |
| §28 | [design/mod-layer.md](design/mod-layer.md) | The mod layer: identity, loading, isolation, versioning, distribution |
| §29 | [design/meta-payload.md](design/meta-payload.md) | The match meta payload: a pack's server-side match logic (`server.meta`) |
| §30 | [history/0.2.3.md](history/0.2.3.md) | 0.2.3 — after the 0.2.2 release (2026-10-10) |
| §31 | [history/0.2.4.md](history/0.2.4.md) | 0.2.4 — after the 0.2.3 release (2026-10-11) |
| §32 | [history/0.2.5.md](history/0.2.5.md) | 0.2.5 — after the 0.2.4 release (2026-10-12) |
| §33 | [history/0.2.6.md](history/0.2.6.md) | 0.2.6 — after the 0.2.5 release (2026-10-13) |
| §34 | [history/0.3.0.md](history/0.3.0.md) | 0.3.0 — the plugin system (2026-10-14) |
| §35 | [design/vfx-format.md](design/vfx-format.md) | Official battle effects: the extracted format (0.3.0, Phase 1a–1d) |
| §36 | [history/0.3.1.md](history/0.3.1.md) | 0.3.1 — after the 0.3.0 release (2026-10-18) |
| §37 | [history/0.3.2.md](history/0.3.2.md) | 0.3.2 — released 2026-10-24, fixes after 0.3.1; AI strategy framework (§37.7), external AI (§37.8), official versions (§37.22, §37.23) |
| §38 | [history/0.3.3.md](history/0.3.3.md) | 0.3.3 — released 2026-10-25, hotfixes after 0.3.2; 第一期商店装备与空栏 (§38.1), 满休整区双向互换 (§38.2), 切版本后的旧装备图标 (§38.3) |


Default-off spectator AI handover (maintainer decision 2026-10-24, §37.100): [AI handover rules](history/0.3.2/ai-handover.md).
