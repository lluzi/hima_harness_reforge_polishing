# DeepSeek Harness UI 对标与第一轮改进

日期：2026-09-11。起点：polishing `c7a2a07bace44ef09f8188c83ec983a714080739`。

## 对标依据

用户要求对标最好的 DeepSeek Harness。尚未指定具体发行版，因此以官方界面和公开社区产品为候选参照，不把 star 数或封装方式当作“最好”的证明。

- [官方 Harness](https://github.com/deepseek-ai/deepseek-harness/tree/c291e7961a515f6d7af9304e7fd1d257929aef26)：核对时 master 为 `c291e7961a515f6d7af9304e7fd1d257929aef26`，提交日期 2026-09-10。官方 README 的运行入口是 Web UI。
- [官方 SidebarRoot](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/ui-sidebar/src/client/SidebarRoot.tsx)：现有工作区/会话导航、可收起栏、设置区和 `sidebar.footer.action` 扩展位置。
- [官方文档侧栏](https://github.com/deepseek-ai/deepseek-harness/tree/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/ui-sidebar-documentpreview)：代码、Markdown、HTML、图片等资料在侧栏阅读；这是后续研究证据阅读的参照，当前没有移植或新建文档系统。
- [anywhere-labs/dsh-desktop](https://github.com/anywhere-labs/dsh-desktop)：社区桌面产品，README 说明保留特定官方版本并通过插件组合桌面能力。可对标工作配置、桌面入口与完整性，不能称作 DeepSeek 官方桌面版。
- [web-casa/DeepSeek-Harness-Desktop](https://github.com/web-casa/DeepSeek-Harness-Desktop)：社区桌面封装，保留原版 Web UI；作为启动、诊断和恢复体验的参考，不因此引入 Tauri/Rust 组件。

证据边界：社区页面与公开截图文件的存在已核对，但 ego-browser 的截图调用超时，未完成社区产品的视觉或交互实测。Hima 的原始工作台和随包官方界面由真实 Electron 独立 home 截图；没有运行模型、SSH 或 EDA。官方初次打开显示预览提示，基线截图被该提示遮挡；后续真实窗口验证通过实际 Continue 和 Configure later 进入可操作页面，记录在验证报告中。

## 产品目标与差距

我们的主任务是复杂研究。对话用于研究和判断，工作台用于掌握运行及证据。衡量 UI 的标准是工程师能否快速回答：现在研究什么、正在做什么、何处需要我、结果的依据在哪。

| 维度 | 当前可观察问题 | 改进落点 | 验收 |
| --- | --- | --- | --- |
| 对话到研究工作台 | Hima 客户端只注册两个工具卡；聊天中没有 Hima 工作台导航入口，Run id 是普通文字 | `src/client/index.ts` 现有 sidebar slot；`HimaRunCard.tsx` 链接到既有 Run 路由 | 真实窗口能从聊天进入工作台；工具卡链接保留准确 Run id |
| 输入层级 | 同一个双栏表单平铺 Pack、Site、Goal、Strategy、Budget | `workbench.ts` 用原生 fieldset/legend 分组；`workbench-style.ts` 统一字号、留白、焦点 | 原参数、Pack 动态更新、提交和错误语义保持；窄窗口不挤出正文 |
| 运行阅读 | 原始证据与整份报告沿一长页展开，没有直达目录 | 现有 `renderCard` 加原生片段导航，报告独立成阅读段落 | 仅存在的段落出现链接；点击准确定位，标题不被固定栏挡住；原记录与报告可复核 |
| 对话中的研究状态 | 卡片长、字号不一致，且主要在加载和操作时读取状态 | 后续单独切片修改 `HimaRunCard.tsx` 的摘要/展开与更新反馈 | 保留未知/错误、区分当前快照和实时状态；不把报告压缩成无证据结论 |
| 资料与 Coding 阅读 | 当前独立工作台与官方文件/代码侧栏之间未形成完整研究路径 | 随 PLS-08 核对 Step 4 与现有预览接口，再落到客户端和远程路由 | 同一 Run 的算法、日志、原始报告来源可见，导航不丢失身份 |
| 研究资产 | Pack 内归档与历史复用仍属于未完成能力 | 依赖 PLS-13 至 PLS-17 的实际记录再做入口 | 不能先画一个看起来已可用的知识库 |

## 本轮范围

先完成前三项的最小改进。使用现有客户端注册机制、SSR 页面、样式表与 RunView；不引入新服务、状态引擎、UI 框架或依赖升级。暂不重写聊天、工作区或文档侧栏。这里的第一轮并非宣称整体 UI 已达到社区最佳或完整研究产品已验收。

L0：构建、类型和 seam 检查。L2：原工具视图注册、真实 Host 的视图/表单/报告相关子集。L3：真实窗口检查聊天入口、表单、运行段落导航、明暗主题与窄窗口。纯布局不新增数值镜像测试，不因 UI 改动重跑完整模型或 EDA Campaign。

回滚：恢复本轮客户端、工作台和对应注册断言即可；不修改 Ledger、Run 数据、Pack 方法或已写报告。测试及实际限制另记验证结果。
