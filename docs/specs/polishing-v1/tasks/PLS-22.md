# [PLS-22] 让 Pack 编写流程生成可执行 Workshop 并在安装环境独立完成

Part of [#1](https://github.com/lluzi/hima_harness_reforge_polishing/issues/1) · [本轮规格](../../step4-takeover/spec.md)

GitHub: [PLS-22 / #25](https://github.com/lluzi/hima_harness_reforge_polishing/issues/25)

Blocked by: [PLS-20 / #23](https://github.com/lluzi/hima_harness_reforge_polishing/issues/23)

承接来源：[上游 #76](https://github.com/lluzi/hima_harness_reforge_claude/issues/76)、[上游 #79](https://github.com/lluzi/hima_harness_reforge_claude/issues/79)、[上游 #83](https://github.com/lluzi/hima_harness_reforge_claude/issues/83)。原项目任务只读，完成状态由本仓库独立验证。

Triage: `ready-for-agent`。标签不解除依赖与真实资源前置；真人验收不能由 agent 代做。

## 目标与开工条件

依赖完成后实施；真实模型和 Site 作业另须具备明确输入、凭据与预算。

## 代码基线与修改模块

实施基线：先由 PLS-20 把上游 `ca47fa0` 与已交付 polishing `263a073` 整合，再以其已验证的集成提交开工。下列上游新增路径在导入前尚不属于本地运行代码；实施时核对真实符号。源项目与旧 himaharness 保持只读。

| 路径 | 修改内容与目标 |
| --- | --- |
| `packages/harness/skills/hima-fabric/SKILL.md` | 将 SPEC 的 Workshops 编译为真实 contract/graph 绑定 |
| `packages/harness/skills/knowledge/pack-anatomy.md` | 与实际 loader 一致的最小形状 |
| `packages/harness/skills/hima-grill/SKILL.md` | 输入/Golden Flow 引用和作者上下文 |
| `packages/harness/skills/hima-test/SKILL.md` | 使用实际 test Run 与记录而不是手写通过 |
| `packages/harness/skills/hima-release/SKILL.md` | 调用现有 release 实现 |
| `packages/harness/src/authoring.ts` | 作者会话与 Pack 文件范围 |
| `packages/harness/src/tools.ts` | 复用公开入口，提供创建 Pack/绑定作者工作区的最小操作 |
| `packages/desktop/src/hima-home.ts` | 安装包带齐 skills、知识、preset 和语义 |
| `scripts/live-check-pipeline.ts` | 去掉模型对开发源码工作树的隐性依赖 |
| `test/fixtures/pipeline/README.md` | 真实录制与机制替身来源 |
| `test/contract/skills.test.ts` | 既有 in-process Host 的作者流程断言 |

## 修改内容

1. 接续上游 #79：Workshop 的 purpose、inputs/reads/knowledge、produces/reader、entry/wrapper/argv、目录与许可写入可加载的 contract，graph 节点真正引用它；不能仅写进 PACK.md。
2. 从统一对话发起 Pack authoring，创建/选择 Pack 文件夹并绑定正确会话工作区。使用已有 dsh 工具/工作区接口；不另建编辑器或作者服务。
3. 安装态只提供已安装 bundle、Pack、用户声明的只读 Golden Flow 与 Site 数据。知识路径随安装解析，不给模型开发源码路径来弥补说明缺口。普通 Coding 会话仍能在自身授权工作区读写/执行。
4. grill/spec/fabric/test/release 均输出实物；test 的真实 Run 身份及 digest 由现有 verb 计算，release 从单次文件快照核验。与 PLS-13 的方法/资产划分保持同一实现。

## 验收标准

- [x] 一个声明 Workshop 的最小业务经编写流程生成后，checkPack 通过，节点在执行时确实可读输入、写脚本、产生声明输出并被 reader 校验。
- [x] 缺少 reader、未声明 wrapper、越界输出、空 Workshop、矛盾 Goal/图均在有效检查点拒绝；失败不伪造 tested/released。
- [x] 离开原开发工作树后，安装态仍可发现五个 Skill 和知识材料；真实模型检查无开发源码访问，报告明确环境和访问范围。
- [x] 授权的普通 Coding 与 Pack authoring 分别正常；Pack authoring 写到 Golden Flow 或别的 Pack 被拒绝且没有落盘副作用。

## 分级测试

- L0：安装文件清单、Skill/声明引用与一次构建。
- L2：bootInProcess + replay + 真实临时文件/本地 Job；作者五阶段、错误、修改后重新测试/发布。
- L3：一次从当前对话创建/选择 Pack 并回到同屏 Run 的连线；其余阶段用 Host。
- L4 模型：DeepSeek V4 Flash 在安装态跑一个有 Workshop 的小样本；不把 stand-in 与示例脚本称为真实挖掘。

## 交付证据

记录实际 commit、构建/Pack/输入/环境身份、命令及退出码、通过/失败/跳过/未跑、耗时、Host/窗口启动数、模型调用与 Site 作业数、材料 hash 和原断言去向。每个本地提交立即推送并核对远端 SHA。

## 本轮验收证据

状态：本轮实现与验收已完成。完整 local 377/377、安装态作者只读终检11/11通过；原始模型 finalization 的属性顺序比较失败记录保留，闭环由实际模型执行/发布事实和独立只读终检共同确认。详见[本批验收](../../../assessment/2026-09-12/pls-next/README.md)。

[安装与作者会话](../../../assessment/2026-09-12/pls-22/README.md)保留普通 Coding、原生 Pack workspace、五个安装态 Skill、Golden Flow/跨 Pack 写入拒绝和 Workshop 真实文件/Job/reader 的 L2/L3 证据；[作者语义修正](../../../assessment/2026-09-12/pls-22/authoring-semantics/README.md)对齐实际目录、argv、图结束与数值判断。安装态资源复制已验证；测试环境的 npm/dsh 依赖仍由安装提供，不声称已有独立应用安装器。

[本批验收](../../../assessment/2026-09-12/pls-next/README.md)保留真实模型五阶段原会话及各次失败、reader 修正、实际 test Run、TEST 格式和 release 的完整证据链。数字方法的实际输入、代码 hash、reader、Judge 与 Goal 独立检查；不能以 replay 或手写 TEST/VERSION 替代。真实 EDA、正式 AES probe、挖掘算法价值和非开发者独立使用由后续任务验收。

## 不在范围内

不改只读源项目，不新增第二图/模型/知识/测试服务，不将 stand-in、replay 或上游历史记录称为本版本真实研究通过。纯重构只有本切片的有效反例或交付要求需要时才做。

## 回滚

保留作者源文件和历史测试/发布身份；回退指令不能给未测试目录补造发布状态。
