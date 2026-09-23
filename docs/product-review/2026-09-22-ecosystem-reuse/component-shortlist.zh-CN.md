# 可复用组件清单

所有判断均是研究结论，未安装或完成本仓库集成测试。原生包存在于安装闭包，不保证当前 profile 已启用所有入口。候选进入 POC 前仍需检查消费接口、完整依赖与许可。

| ID | 组件 | 核查版本 | 许可范围 | 选择 | 一手来源 |
| --- | --- | --- | --- | --- | --- |
| N1 | DSH Agent Registry / Session | 0.1.5-alpha.1 | MIT | reuse existing interface | [源码/元数据](https://github.com/deepseek-ai/deepseek-harness/tree/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/core/agent) |
| N2 | DSH subagent spawn/fork/runtime/control/UI | 0.1.5-alpha.1 | MIT | installed native candidate; verify profile first | [源码/元数据](https://github.com/deepseek-ai/deepseek-harness/tree/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/subagent) |
| N3 | DSH systemPrompt section/context | 0.1.5-alpha.1 | MIT | reuse existing interface | [源码/元数据](https://github.com/deepseek-ai/deepseek-harness/tree/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/core/system-prompt) |
| N4 | DSH session-query / SQLite FTS | 0.1.5-alpha.1 | MIT | reuse installed API conditionally | [源码/元数据](https://github.com/deepseek-ai/deepseek-harness/tree/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/session-query) |
| N5 | DSH inbox followup/steer/inject | 0.1.5-alpha.1 | MIT | reuse existing interface | [源码/元数据](https://github.com/deepseek-ai/deepseek-harness/tree/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/core/agent) |
| N6 | DSH right-sidebar / Slots / tool-view | 0.1.5-alpha.1 | MIT | reuse existing Hima composition | [源码/元数据](https://github.com/deepseek-ai/deepseek-harness/tree/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/client) |
| N7 | DSH schedule | 0.1.5-alpha.1 | MIT | optional same-session reminder only | [源码/元数据](https://github.com/deepseek-ai/deepseek-harness/tree/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/schedule/schedule) |
| N8 | DSH session-telemetry / OTel | 0.1.5-alpha.1 | MIT | defer exporter; use existing local traces | [源码/元数据](https://github.com/deepseek-ai/deepseek-harness/tree/5dda764ed3aa172535a7967b06ff95d9cbfe536a/packages/session/session-telemetry-otel) |
| H1 | Hima five-stage authoring/check/release | 47ce341 | existing repository; no new dependency | extend existing | [当前实现](../../../packages/harness/src/skills.ts) |
| C1 | dsh-context | 0.54.4 | Apache-2.0 | conditional display extraction | [源码/元数据](https://github.com/bowenliang123/dsh-context/blob/2ae7cfa7f8f1e4b0ff0b31c9abdfa12ac803a9f7/README.md) |
| C2 | dsh-context-doctor | 0.7.2 | BSD-3-Clause | isolated diagnostic candidate | [源码/元数据](https://github.com/Zhenyu98/dsh-context-doctor/blob/41d5c2e4bbe0611b7928c4007bb28545f7ace38f/README.md) |
| C3 | dsh-fast | 0.2.14 | Apache-2.0 | isolated diagnostic candidate | [源码/元数据](https://github.com/PerryLink/dsh-fast/blob/f0c3e8cfef5149844536c8dad808a77c5bdb5ff4/README.md) |
| C4 | @dsh-external/dsh-automation | 0.1.7 | MIT | defer for Campaign; future standalone tasks | [源码/元数据](https://github.com/titanwings/dsh-automation/blob/0d73a4e03639d4f63d0771ae4490e2718b7e7aa0/README.md) |
| C5 | dsh-notification | 0.1.4 | MIT | narrow presentation reuse | [源码/元数据](https://github.com/omdsh-dev/dsh-notification/blob/675aab9b43d5011738feb6185281596c0365ccba/README.md) |
| C6 | dsh-automation-center | 0.1.0-alpha.8 | MIT | defer alternative | [源码/元数据](https://github.com/usersx/dsh-automation-center/blob/929f271aa40bd80b5b0906cf47ab151a57fd4525/README.md) |
| C7 | dsh-mnemon | 0.5.13 | MIT | pattern only | [源码/元数据](https://github.com/omdsh-dev/dsh-mnemon/blob/84d469ffa838a36fa579295d94029fcac8ac058e/README.md) |
| C8 | dsh-continual-evolve | 0.6.1 | MIT | pattern only | [源码/元数据](https://github.com/ZK-Andy/dsh-continual-evolve/blob/981568450d9643bc481130294ce67543b4c54e15/README.md) |
| C9 | dsh-plugin-guide | 0.3.16 | Apache-2.0 | maintainer reference candidate | [源码/元数据](https://github.com/PerryLink/dsh-plugin-guide/blob/3ad707fb2c73658dd3e7c702b33bfaf469fb4f96/README.md) |
| O1 | promptfoo | 0.123.1 | MIT | isolated eval runner candidate | [源码/元数据](https://github.com/promptfoo/promptfoo/blob/d59f045c4cda1193574380aae639d84380dbf5f2/README.md) |
| C10 | @yejiming/dsh-data-agent | 0.1.5 | MIT | narrow contract/replay extraction | [源码/元数据](https://github.com/omdsh-dev/dsh-data-agent/tree/6657771b8b9e66b3c06d6a6ce3056e601e7ff1fe) |
| C11 | @changfenhuang/dsh-genui | 0.11.1-preview.2 | MIT | pattern only | [源码/元数据](https://github.com/omdsh-dev/dsh-genui/tree/05aa8226409f6e9a585b2cb3a1ce57175a7331d7) |
| C12 | @deepseek-ai/dsh-tool-stat | 0.0.1 | MIT | narrow numeric algorithms/tests | [源码/元数据](https://github.com/omdsh-dev/dsh-tool-stat/tree/23069a4344dcfebd98ea381a77d07091f039f357) |
| C13 | papermachine | 0.1.2 | MIT | pattern only | [源码/元数据](https://github.com/SuperJJ007/papermachine/tree/b7f095ed665d3c0693006d20fbf0ad33f061cf82) |
| C14 | dsh-better-sidebar | 0.19.1 | MIT | pattern only | [源码/元数据](https://github.com/omdsh-dev/DSH-better-sidebar/tree/1fcf43ccbedd6e66370b7fb81df2b4dd0ef2604e) |
| C15 | NanmiCoder/dsh-agent-teams | 0.1.20 | MIT | pattern only / defer | [源码/元数据](https://github.com/NanmiCoder/dsh-agent-teams/tree/87c95c94d7847e4a242cb589916adc519981175f) |
| C16 | PerryLink/dsh-background-agents | 0.9.9 | Apache-2.0 | pattern only / defer | [源码/元数据](https://github.com/PerryLink/dsh-background-agents/tree/f2aea0460dcb1b3b03eaa13d1bdcba21650208a1) |
| O2 | echarts | 6.1.0 | Apache-2.0 | small chart adapter candidate | [源码/元数据](https://registry.npmjs.org/echarts/6.1.0) |
| O3 | @tanstack/react-virtual | 3.14.11 | MIT | conditional reuse; explicit direct dependency required | [源码/元数据](https://registry.npmjs.org/@tanstack%2freact-virtual/3.14.11) |
| O4 | TanStack Table | 未锁定，暂缓 | not adoption-qualified in this review | defer | [源码/元数据](https://github.com/TanStack/table/tree/v8.21.3) |
| O5 | React Flow / ELK | 未锁定，暂缓 | not adoption-qualified in this review | defer | [源码/元数据](https://reactflow.dev/learn) |
| O6 | DuckDB / Arrow | 未锁定，暂缓 | not adoption-qualified in this review | defer | [源码/元数据](https://duckdb.org/) |
| O7 | Docling | 未锁定，暂缓 | not adoption-qualified in this review | defer | [源码/元数据](https://docling-project.github.io/docling/) |

选择含义：reuse/extend 为沿用已有接口；installed native candidate 先做实际 profile 检查；isolated/small adapter 为隔离 POC；narrow extraction 只借局部协议/算法；pattern only 只参考设计；defer 暂缓。

32 条记录是组件或组件组，不是 32 个待安装依赖。保留的维护者 package/LICENSE、固定 commit 和 registry integrity 见 [components.json](components.json)。零新依赖也可能完成 Guide 第一切片；新组件必须以用户收益证明其必要性。
