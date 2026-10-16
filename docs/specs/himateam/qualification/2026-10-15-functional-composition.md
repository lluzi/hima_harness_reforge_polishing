# #109 功能组合资格：INCOMPLETE

本报告记录 macOS 可信本机开发候选的功能资格。#109 仍未完成：真实完整三 Kit 的标准 Data Insight 默认页面已在 2 GiB 内通过；最终文档增量复核、强制检查、提交和远端同步仍待完成。安装包、Linux、强隔离和分发继续由 #110 HOLD 承接，不用于延期本轮功能缺口。

[逐项对账 JSON](2026-10-15-functional-composition.json) 对原 141 行逐一保留基线状态、原证据引用与本轮 disposition。原基线计数为 `50 proven / 74 partial / 11 unknown / 1 missing / 5 deferred-110`，没有批量改写成 PASS。JSON 的 `closureGates` 单列真正尚缺的关单判据；旧证据仅按原组件、场景与限制复用。

## 当前候选与权限

Hima App 为 `hima-585dda4772cd4609ef34e45578051278cb6e2de4a060863a8940bb4601e332f6`，Desktop main SHA 为 `d6a507561670c777d1b6a74d94301a9ad3e86b2da9ca475e8a566e4de1b0c42f`，实际 renderer SHA 为 `c08a5a6a2d2acb7fbfe41d75216b51dade78347c58616e2a6143b53bc9954982`。源码仍是 d46d337 基础上的未提交增量；AppVersion 不代替 renderer 或外部 SDK 字节身份。

实际 Pi 1.1.0、OpenCode 1.18.6、Node 24.20.0，固定产品模型 DeepSeek 4.1 Flash。OAR 是开发资产 `0.46.0+hima-pi-retry-f2e4d53d7e55`，补丁 SHA `f2e4d53d7e5515163d5fcd5bef49878536fbdd4bf7dbb6dbc51d7c51e4d41469`、projection SHA `2dbb2ea0e1722ba3f7d3858e7983f78d38c858990a0d4120c8222ca9871cbcb1`；每次实际 native lease 的 assets 路径与 projection 字节另行绑定。原 p03 资产未改，此热补丁尚未进入安装包 manifest，后续分发接线见 [#110 回执](https://github.com/lluzi/hima_harness_reforge_polishing/issues/110#issuecomment-6206004471)。

原模块中的采用权限已接通 store、Host、独立 grant、native 工具和 client：human-opened 冻结 Task 内，成员可采用本人 member 范围的候选 experience，冻结负责人可在获准 team/project 范围采用协作方法。query 不获得写权限；feedback、纠正、停用、重新采用和权限/角色/人工节点/验收变化仍由人决定。34 项定向零模型正反例和独立增量 review 已通过。

## 真实业务与 Guide 链路

business3 同一次真实混编执行完成五次 invocation（含 lead 原生续接，并非五个独立 session），任务 `task-e94fd0aa1099f593e7c58f457c6401c98b6936143421edeff7124eba5a81d9f9` 为 succeeded/resources closed。当前 developer 个人采用、lead 团队采用的 actor/source/CAS/current tip，独立 review、最终 lead 本轮 `open-pr` request/reply 及 [PR2](https://github.com/lluzi/himateam_test/pull/2) 的 head `3ce544bc10186a69a7c8e2d6077988fc46a4c899` 均由原始日志及只读 PG 缓存对应。索引仍 pending，不称新采用已被检索。

原 business3 caller 在 yielded parent 的 PG observation 断言失败，TAP **1 PASS / 1 FAIL** 原样保留。随后仅修验收 helper，按原 effect/lease/sessionKey/generation/member/nativeSession/stream/input 冷读同次 Host durable journal；五次 invocation 均有 received/completed/raw_final。独立复核和协调者接受同一次实际运行的后验资格，没有第四次模型流水线。总峰 1897.421875 MiB，原正常 Host 关闭，最终 owned processes 为空。

GUI7 是唯一一次真实中文 Guide 用户回合，实际普通主会话 `session-32199966-d339-472c-91db-6f0b715809ce` 读取原 Task/冻结定义，列出 Skills/knowledgeRefs，按人类选择创建一个新 Team v1：保留负责人 Skills，开发/审查成员 Skills 为空，全部 knowledgeRefs 为空。协调者逐角色核对真实回复、runtime、职责与携带说明，独立复核核对工具调用→Host save→只读 PG；原 Team/Task/Run/5 invocations/3 results/leases 未改，新 Team 无 Task。原 GUI7 因允许的只读 `hima_team_read` 被 caller 额外 oracle 拒绝而 FAIL，记录未改，也未重发模型。

GUI9 在同一 Home 只读打开新 Team，实际 DOM 与 API 的标题、v1、三角色、Pi/OpenCode/Pi、default 模型、引用和 No Tasks 一致，新配置 SHA `ceb49a2191e519c8911f177d540af5d40d9572fc07c08418c8328b3243d19c69`。两条 adopted 的公开 memory status 已实际读取；仍显示 index pending。显式 drain 回执成功、App exit 0、PG pidfile absent、无 fallback、owned processes 为空。结果为 **5 PASS / 0 FAIL / 4 SKIP**，限定接受 Guide 自然语言→配置→UI→正常退出链路。四个可选 GUI case 缺输入：Campaign、Resident、standard Data Insight、custom analysis，不能合称 T24 全部通过。可观察 usage 是 UI 圆整显示的 1 用户回合、5 model steps、约 142K 累计 token、77% cache；不是精确计费 token 或 HTTP 请求次数。

## Data Insight 资源前沿

原完整三 Kit GUI6 在 2 GiB 守卫下峰值 2131.390625 MiB，被守卫终止，最终无残留。随后正常新 Home、真实完整 TSMC28 单 Kit 的 Host/API 可用，树峰 1686.0625 MiB；同次稳定 ready 样本 Python 1319.84375 MiB，尚不足以承载实际 Electron 默认页面。不能以源 JSON 字节数当 RSS，也没有改用小数据或 `/#runs` 绕过默认 Health→Overall。

真实 `physical.json` 为 146532741 字节，普通 `json.load` 一次耗时 7.616410083 秒，Darwin `ru_maxrss` 为 1146.109375 MiB，最终 owned processes 为空。这支持 eager physical metadata 是主要加载成本，不构成精确稳态占比。原文件和引擎仓库均只读。当前 raw manifest SHA 与保留 derived 中记录的 manifest SHA 原本不同，两者如实保留，未重新推导或重标身份。

LibInsight 按 ADR0019 保持自己的页面、计算和数据职责。隔离开发副本基于 `4a58fa6f9d22179b7010becc53167c9d4c976bc7`，叶修复令实际 physical 访问延迟加载，并以有界 header 读取保留 kits_list 的 supplied 元数据语义及兼容 fallback；原仓库和打包 pin `55e27bfaf4470f0f38010e8bfdaf8a284064f612` 不变。小 fixture 已先 RED，再 **19 PASS / 0 FAIL**，物理访问、并发、缺失/false、旧布局、损坏与快照替换反例保留。独立复核零 P1/P2；随后真实原完整三 Kit Host2 的 10 个 GET 全部 200，六个 Run status 均 null，默认 TSMC28 Health 为 9 variants/24 corners/72 cells/25 checks，Overall 空 label 返回同一矩阵。总树峰 758.515625 MiB，峰样本 Python 244.265625 MiB，原 Host.stop code 0、PG absent、实际 owned 20 个身份终态为空。随后同一正常 Home 的标准 Desktop2 通过，原业务窗口未准入而单独 SKIP，结果为 **1 PASS / 0 FAIL / 1 SKIP**。实际嵌入页为默认无 hash 的 Health，三 Kit options 保留、选择 TSMC28；同次 DOM 的 Overall 空 label 有 1 个 SVG 和 216 个 rect/path，Health/Overall API 对应原 derived identity，三 Run 状态仍 null，Retained reports 往返通过。截图只显示初始 Health，完整 Overall 由同次真实 DOM/SVG 证明。树峰 1482.34375 MiB，App 显式 drain 成功、exit 0、PG absent、无 fallback、实际 owned 24 个身份终态为空。原第一次标准窗口因主 page frameTree 不包含 OOPIF 而 FAIL，随后按既有统一工作区的 iframe target inspector 修验收器；没有改变 Desktop 隔离或再跑模型。叶补丁已 tracked，fresh offline archive/patch 实际重现同 64 文件 SHA；打包 pin 未改。入库载体仅省略一条空 context 行的空格，SHA 为 `6621135c35571ea350d1aff409e4e134eaf57c94d82b93a3a5cdbc9d1a836a4e`；原已审、实际资格所用补丁 SHA `11b62ebf6041558bf92d419b2ce54d6110762459e2b3b825b168ad95f0ec523b` 保留，两者经普通 BSD patch 均还原相同 64 文件，未改源码或重跑业务。第一次交付在 commit 前的空白检查退出，原强制 hook 当时尚未启动。

## 保留的限制与剩余交付

历史 #107 中文纠正后的新 Task 实际 recall/use、#108 同 OS source-loss/held/显式新 Run 恢复，以及当前 Campaign/Resident/故障控制机制，仅按各自记录的身份复用。现有 native subagent/compaction 路径没有被替换，实际发生及其连续性未在本轮执行验证。S64 原基线 unknown 保留；精确复用 push4 #390 冻结 unknown-member/定义拒绝、#1198 member bearer 对 admin 401、#384 人类 immutable v1/v2 保存、#377 Guide 无权 apply 的 Host 证据。既有 `hima-team-spec/SKILL.md:28–38` 可提出 ask-human 建议并将权限变化交给人。协调者按原矩阵最低 Host 控制样本明确接受其非阻断地位；实际“新角色理由→人批准”的模型对话未测，不称已发生，不增加角色审批协议。直接 Clone 按保存版本复制，忽略未保存编辑；本轮 S19 由 Guide read→人类选择引用→新 save 的实际路径满足。成功且 closed 的旧 Task 仍可能按 Host allowedActions 显示 Stop，未点击，不能宣称其实际效果已测。

business1/2 的失败、GUI1–8 各自失败及 GUI3 的 psql 暂态超时均保留；后续通过不改写其原始结果或声称历史未知根因已修复。普通 business failure 的 raw-tail 和真正 failed parent 被 accepted-wait 遮盖的问题分别以最低层 RED/GREEN 修复，独立 review 零 P1/P2；OAR 成功 auto-retry 后 sticky providerError 在 projection 本身修复，没有在 runner 覆盖失败结果。

尚需完成：最终 qualification/新增依赖交付增量复核；原强制 pre-push 检查；一批 coherent commit 后立即 push 并核 remote SHA；最后发布真实完成回执并关闭 #109。无 main merge、release/tag、Linux 安装或 EDA 操作。[当前公开前沿](https://github.com/lluzi/hima_harness_reforge_polishing/issues/109#issuecomment-6207373913) 与本报告均为 INCOMPLETE。
