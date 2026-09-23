# 检索、反证与验证记录

本次只研究，Hima 源码基线 47ce341。没有依赖安装、产品模型调用、App/Campaign/EDA 启动、vendor API 调试或活动试验恢复。

## 研究组织

root 综合；Sol/High 独立核查 agent/runtime/权限与后续读者审查；两位 Terra/Medium 分别核查 Guide/Pack/知识与 UI/Insights。均使用干净上下文和有界任务，未递归派工。开发/研究模型 token 成本未测量；“零产品模型”不代表研究没有使用 agent 额度。

研究包保留在 `.hima-tmp/ecosystem-research-20260922/agent-runtime.md`、`guide-author.md`、`insight-ui.md`，下属目录保存只读下载的元数据、README、LICENSE、类型与选定实现文件。没有执行这些仓库的安装或构建脚本。正式报告不复制整篇第三方资料；证据清单用固定来源和 hash 支持复核。

## 检索覆盖与停止点

| 线 | 一手材料 | 判断如何受到反例约束 | 停止理由 |
| --- | --- | --- | --- |
| 当前产品 | AGENTS、产品定义、CONTEXT、纪律、测试策略、先前 review、package/lock、实际实现 | 历史设计不代表当前实现；源代码不代表本轮测试通过 | 当前归属和缺口明确，未重新做一次完整产品审计 |
| 原生 runtime | 安装的 0.1.5-alpha.1 README/types；官方 tag 5dda764e；上游 00102833 | 包存在不代表 profile 已挂载；Inbox acceptance 不代表业务完成；新版本不直接替换 | 第一只读委派已有接口，剩余是消费验证 |
| 社区团队/后台 | NanmiCoder teams、PerryLink background 的固定 source/package/license | task/captain/storage 与 Hima 权威重叠；自定义 session event 兼容限制 | 足以排除整体采用，无需运行社区调度器 |
| Guide/作者/知识 | 当前 prompt/skills/authoring/release、Mnemon、Continual Evolve、Plugin Guide、Promptfoo | plugin author 与 Pack author 不同；memory/promotion 不能改写业务事实 | 可先用现有接口与反例库；剩余是小型 A/B |
| UI/Insights | Hima Workbench/FabricCanvas；data-agent、genui、tool-stat、better-sidebar、PaperMachine | 严格报告与生成 UI 不同；SQL write/full shell 带来无关责任 | 已能选定最小 renderer 组合，不需完整 BI |
| 诊断/提醒 | dsh-context、context-doctor、fast、automation、notification、automation-center 及安装的 Schedule | heuristic token 不当费用；turn completion 不当 Campaign completion；新 session 不能接旧 Run | 三个生命周期区分后，采用范围已明确 |
| 相邻库 | ECharts 源码/tag/registry；TanStack metadata；React Flow/ELK/Docling 官方文档 | 不以常见依赖替代实际性能/功能反例；未全资格化对象仅暂缓 | 新增库的收益需 POC，而非更多 README |

发现渠道包括 DeepSeek 官方入口、GitHub dsh-plugin topic、社区 DSHPlugin 和 curated list；只用它们找到作者原始仓库，没有以社区目录数量、stars 或兼容标签作结论。官方域名与社区网站明确区分。检索关键词包括 subagent、background agents、agent teams、context、notification、automation、memory、continual evolution、plugin guide、data-agent、GenUI、table/graph/plot。

## 主张、替代解释与下一证据

| 主张 | 替代解释/最强反方 | 让选择改变的证据 |
| --- | --- | --- |
| 先用原生 worker | 更好的选中上下文已足够，不需要 worker | 同输入 owner-only 与 specialist 的质量/成本/干预对照；无增益就停止团队扩展 |
| data-agent 只提取协议 | 完整插件通过配置即可可靠禁写并适配 Library | 对当前 pin 验证所有工具/数据/身份路径；能删净不相关责任才重新考虑整体依赖 |
| Guide 上下文应结构化 | 扩写 prompt 也可能解决简单问答 | 准备/恢复/错 Run/人类 pause 的冻结 case；必须保留实际权限反例 |
| 诊断先选轻量 | 原生 trace 已能回答全部支持问题 | 若无可复现的定位成本改善，不引入 diagnostic plugin |
| 不替换 FabricCanvas | React Flow/ELK 可显著降低特定图功能成本 | 一个已测的复杂布局/渲染/可访问性缺口，且 adapter 不改变运行控制 |
| 原生 API 先资格化 | 合成图可先验证 UI 方向 | 可以做明确标注的合成合同研究；不能变成真实 Library 功能验收 |

## 独立复核和已采纳修正

1. 将原生 subagent 从“已可直接用于业务”收窄为“已安装原生候选”；R2 第一门是 booted-profile 工具/slot 可达性检查，显式 import 须声明依赖。
2. Analyst → Reviewer 有产物依赖。真正并行的第二视角叫 Counter-analyst；不把两份平行分析当一次独立产物复核。
3. 当前 analysisRecord 尚无完整 contributor/role/adoption 字段。DSH Session 留原始输出，owner 只记录采纳的综合；真实消费者出现后再扩大 schema。
4. 通知展示只能投影现有 Hima 控制/完成与交付事实；不创建第二通知权威。
5. 首批建议收窄为 R1 上下文与有控制前置的 R2 A/B，其余切片按明确触发条件推进。
6. HimaGuide 的 browser selection 在用户发送时显式携带并由 Host 复验；后台 owner 不受另一窗口焦点变化的隐式影响。
7. TanStack Virtual 只是已有传递依赖，新增直接消费者仍要声明/构建检查。ECharts 6.0 源码初查后补核 6.1.0 registry/tag；没有把不同版本混称一个已测试产物。
8. 社区 evolve 项目初查按不完整名称未命中，补得正确 owner `ZK-Andy` 后重新检查；最终报告不保留“没有该项目”的错误结论。

## 核查方式与局限

来源正文通过浏览器或 GitHub/raw/registry 一手接口实际读取；不是只引用搜索摘要。ECharts 官方 handbook 浏览器超时，已在同一任务页确认错误，改用其官方 GitHub 6.1.0 和 npm publisher metadata，均可读取；不宣称 handbook 成功访问。研究浏览器 task space 已关闭。

自动验证检查 Markdown 本地/引用链接、JSON、唯一 component ID、固定 pin、版本字段与 manifest 对照，以及正文重点 URL 的可达性；结果写入 [verification.json](verification.json)。HTTP 可达不证明语义；主要推荐另行读源码/类型和许可。未完整审计候选依赖链/漏洞/性能，也没有将第三方 tests 数量记为本项目测试结果。

本地研究日期是 2026-09-22；部分下载时间和上游提交以 UTC 标记为 2026-09-23，属于本地晚间同一研究窗口。固定 SHA 比“最新版本”标签更可靠。

实际文档检查结果：32 条组件/组件组记录的 ID 唯一；11 个本地链接和 19 处参考链接无缺失；正文 18 个主要一手来源 HEAD 均为 HTTP 200；JSON 解析与 `git diff --check` 通过。许可信息及兼容判断保留核查范围，没有据此声明任何新增组件已安装或可用于生产。
