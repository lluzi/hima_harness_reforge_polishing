# [PLS-20] 整合 ca47fa0 快照并保留已交付的 PLS 与统一工作区

Part of [#1](https://github.com/lluzi/hima_harness_reforge_polishing/issues/1) · [本轮规格](../../step4-takeover/spec.md)

GitHub: [PLS-20 / #23](https://github.com/lluzi/hima_harness_reforge_polishing/issues/23)

Blocked by: [PLS-02 / #3](https://github.com/lluzi/hima_harness_reforge_polishing/issues/3), [PLS-04 / #5](https://github.com/lluzi/hima_harness_reforge_polishing/issues/5), [PLS-05 / #6](https://github.com/lluzi/hima_harness_reforge_polishing/issues/6), [PLS-06 / #7](https://github.com/lluzi/hima_harness_reforge_polishing/issues/7), [PLS-07 / #8](https://github.com/lluzi/hima_harness_reforge_polishing/issues/8), [UI-02 / #21](https://github.com/lluzi/hima_harness_reforge_polishing/issues/21)

承接来源：固定源快照；PLS-01～07 与 UI-02 的交付记录。原项目任务只读，完成状态由本仓库独立验证。

Triage: `ready-for-agent`。标签不解除依赖与真实资源前置；真人验收不能由 agent 代做。

## 目标与开工条件

可作为本轮第一个实现任务；依赖均已有交付。开工仍核对源 SHA、PLS SHA 与工作区状态。

## 代码基线与修改模块

本切片直接在 P=263a073 的已交付状态上接收 U=ca47fa0，以原导入 B=b4ac9d9 为比对基线；不以本任务自身完成作为开工条件。两个参考源码目录保持只读。

| 路径 | 修改内容与目标 |
| --- | --- |
| `docs/assessment/2026-09-11/source-import.json` | 读取原始文件映射；新增本次导入清单，不改写原证据 |
| `package.json` | 保留 build-once 与 local/desktop/live 分组，纳入上游边界检查 |
| `pnpm-lock.yaml` | 以合并后的依赖声明重新锁定，不任选一侧锁文件 |
| `packages/desktop/src/main.ts` | 合并 profile/启动改动与同屏工作区入口 |
| `packages/desktop/src/driver.ts` | 合并显示器/焦点行为与 React controlled input 支持 |
| `packages/desktop/src/local-site.ts` | 九阶段 stand-in 与正确默认方法并存 |
| `packages/harness/src/fabric.ts` | 上游 Workshop 接线与 PLS-06 resume admission 保护整合 |
| `packages/harness/src/remote.ts` | 上游模型/作者入口与现有预检、Run 列表和证据读取整合 |
| `packages/harness/src/client/HimaRunCard.tsx` | 上游 Workshop 状态投影进入已打磨的卡片 |
| `packages/harness/src/client/HimaWorkbench.tsx` | 保留原生对话旁的统一面板、草稿和过时响应保护 |
| `packages/harness/src/experience-report.ts` | 保留研究结果与执行终态分离及有效证据标准 |
| `scripts/run-contract-tests.mjs` | 完整登记新增测试和 fixture 的资源归属 |
| `test/contract-groups.json` | 新旧文件覆盖对账，名称以实际现存配置校正 |

## 修改内容

1. 在 polishing 下的独立集成分支/隔离工作目录操作；源目录只读。固定 B=b4ac9d9、P=263a073、U=ca47fa0，后续源变化不得无记录混入。保留可回滚的 P 与导入前本地状态。
2. 当前历史无 Git 共同祖先：按原导入映射对 B/P/U 做三方内容整合；不直接覆盖目录，不用 allow-unrelated-histories 把冲突全部交给某一侧。删除/移动和同名新增文件单独对账。
3. 接收上游已提交源码、声明、测试及样本；不复制原 .git、node_modules、lib、DSH_HOME、凭据、Site workspace 或运行数据库。源说明放 docs/upstream/ca47fa0，保留本仓库 AGENTS、产品定义、术语和 ADR 权威。
4. 逐项记录上游独有、本地独有、共同修复和语义分歧。方法可移动进 Pack，但 PLS-04 的可达/收敛/预算标准保留；UI-02、预检、防重复恢复、报告 hash 与真假结论必须保留。
5. 这一切片建立可验证的集成基线，暂时保留隔离的旧执行路径作回归对照；不同时实施 PLS-19，不把旧自动 drive 当作新产品方向。
6. 检查导入路径、测试夹具和知识引用无源目录可写依赖；登记兼容的旧 Ledger、Experience 和 Pack 格式。每次提交立即推送并核对对应远端 SHA。

## 验收标准

- [x] 在全新 polishing 隔离 home 中能构建、加载 Host、检查 Pack、运行本地闭环；证据标明源码 SHA 与构建身份。
- [x] 新增和原有每个测试文件均有资源分组；旧断言无静默删除。local 默认入口不启动 Electron、不使用真实模型、不尝试 SSH；对迁入测试实际检查初始化副作用。
- [x] PLS-04 方法对照、PLS-05 预检/错误保留/防重复、PLS-06 并发 resume/cancel、PLS-07 不完整/篡改/负结果、UI-02 同屏主路径均继续成立。
- [x] 读旧报告不改写已保存的字节/hash；新代码记录进入现有投影时不丢字段。源目录产品文件保持未改动。
- [x] 导入清单可重建三方处理结果，24 个重叠路径逐项有去向；它们不是预先认定的 24 个冲突。

## 分级测试

- L0：Node/seams/新引入 boundary check、一次新构建、类型和测试分组完整性。
- L1/L2：保留的完整 local 回归及新增 reader/moment/workshop/pipeline/release 机制。昂贵依赖由明确标注的 replay/stand-in 替代；迁移的断言有对账。
- L3：只保留冷启动与同屏会话、预检启动、阻塞继续/取消、证据/代码阅读的关键组合；矩阵留 L2，Electron 串行。
- L4 模型：模型工具/装配/指令在整合中变化时做有预算的小检查；未改动的上游实跑记录仅为来源证据。L4 Site/L5 不随导入自动执行。

## 交付证据

记录实际 commit、构建/Pack/输入/环境身份、命令及退出码、通过/失败/跳过/未跑、耗时、Host/窗口启动数、模型调用与 Site 作业数、材料 hash 和原断言去向。每个本地提交立即推送并核对远端 SHA。

## 不在范围内

不改只读源项目，不新增第二图/模型/知识/测试服务，不将 stand-in、replay 或上游历史记录称为本版本真实研究通过。纯重构只有本切片的有效反例或交付要求需要时才做。

## 回滚

回退集成分支到保留的 P；任何升级后的运行数据均留在隔离 home，不让旧代码打开不兼容的新数据。保留导入清单与全部失败记录。

实施与独立验证：[PLS-20 交付记录](../../../assessment/2026-09-12/pls-20/README.md)。
