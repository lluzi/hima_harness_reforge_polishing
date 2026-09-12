# [PLS-21] 打通正式 Pack 的 Goal 与参数声明并约束 Job 启动输入

Part of [#1](https://github.com/lluzi/hima_harness_reforge_polishing/issues/1) · [本轮规格](../../step4-takeover/spec.md)

GitHub: [PLS-21 / #24](https://github.com/lluzi/hima_harness_reforge_polishing/issues/24)

Blocked by: [PLS-20 / #23](https://github.com/lluzi/hima_harness_reforge_polishing/issues/23)

承接来源：[上游 #70](https://github.com/lluzi/hima_harness_reforge_claude/issues/70)、[上游 #71](https://github.com/lluzi/hima_harness_reforge_claude/issues/71)、[上游 #72](https://github.com/lluzi/hima_harness_reforge_claude/issues/72)、[上游 #75](https://github.com/lluzi/hima_harness_reforge_claude/issues/75)、[上游 #80](https://github.com/lluzi/hima_harness_reforge_claude/issues/80)。原项目任务只读，完成状态由本仓库独立验证。

Triage: `ready-for-agent`。标签不解除依赖与真实资源前置；真人验收不能由 agent 代做。

## 目标与开工条件

依赖完成后实施；真实模型和 Site 作业另须具备明确输入、凭据与预算。

## 代码基线与修改模块

实施基线：先由 PLS-20 把上游 `ca47fa0` 与已交付 polishing `263a073` 整合，再以其已验证的集成提交开工。下列上游新增路径在导入前尚不属于本地运行代码；实施时核对真实符号。源项目与旧 himaharness 保持只读。

| 路径 | 修改内容与目标 |
| --- | --- |
| `packages/harness/src/packs.ts` | Goal/Strategy/reader/tool 声明校验与 checkPack |
| `packages/harness/src/run-arguments.ts` | Goal、Strategy、Site 绑定到实际参数的解析 |
| `packages/harness/src/node-turns.ts` | tool/workshop 参数替换的共同接纳边界 |
| `packages/harness/src/observe.ts` | Pack reader argv 启动边界 |
| `packages/harness/src/paths.ts` | Permit 路径判定 |
| `packages/harness/src/card-labels.ts` | Goal 声明的标签、单位与约束 |
| `packages/harness/src/client/HimaWorkbench.tsx` | 从 Pack 声明生成原生面板的输入 |
| `packages/harness/src/remote.ts` | 预检与最终开始共享有效性规则 |
| `test/contract/strategy.test.ts` | 有效/无效输入通过生产入口的既有参考 |

## 修改内容

1. 用即将承接的 AES Pack 需求做最小反例：period 目标与相对改善目标均由 Pack 声明。移除阻碍这两种业务的 target_period_ns 固定假设，保留旧 Pack 的兼容映射，不新建表单框架。
2. 类型、单位、范围及必要精度来自 Pack 声明；所有入口拒绝重复参数名、非有限数字、越界选择和不可表示的值，不截断或修正后冒充用户输入。只有实际方法需要时扩展 precision 字段。
3. 在替换后的参数交给 Job 或 reader 之前校验字面值。拒绝 make/shell 可再次解释的动态值，如 dollar expansion、反引号和换行；固定脚本内容作为记录过的文件传递，不作为动态命令文本。
4. reader argv[0] 必须是声明的固定 wrapper，不能包含占位符；普通 tool 与 Workshop 使用同一 Permit/参数规则。路径按声明及 Permit 解析，支持合法带空格路径，不靠删字符消毒。

## 验收标准

- [ ] 旧 period Pack 和 AES 改善目标分别从 UI、工具、命令/HTTP 进入同一校验规则；显示单位/错误与真正绑定值一致。
- [ ] 恶意或无效动态值在测试期不会留下逃逸文件、Job launched 记录或 reader 子进程；shell 引号包围 make 变量不作为安全证明。
- [ ] 合法边界数值、命名和路径可往返传递；预检通过后若输入/方法改变，开始阶段仍重新校验。
- [ ] 固定 Goal 在 Campaign 内不可改；策略候选不满足声明时不启动下一代。

## 分级测试

- L0/L1：声明、数值/精度、重复参数、字面值与路径矩阵。
- L2：真实 Host、文件、无外部依赖的实际 wrapper/reader；核对无副作用拒绝及合法参数接收。
- L3：一个新 Goal 表单合法/非法交互；组合不反复启动窗口。
- L4 Site：仅在真实 wrapper 参数语义改变时做最小检查；模型调用非本切片必需。

## 交付证据

记录实际 commit、构建/Pack/输入/环境身份、命令及退出码、通过/失败/跳过/未跑、耗时、Host/窗口启动数、模型调用与 Site 作业数、材料 hash 和原断言去向。每个本地提交立即推送并核对远端 SHA。

## 不在范围内

不改只读源项目，不新增第二图/模型/知识/测试服务，不将 stand-in、replay 或上游历史记录称为本版本真实研究通过。纯重构只有本切片的有效反例或交付要求需要时才做。

## 回滚

回退声明扩展时继续能读取已保存旧/新 Goal；不退回会重新接受已证实危险动态值的生产入口。
