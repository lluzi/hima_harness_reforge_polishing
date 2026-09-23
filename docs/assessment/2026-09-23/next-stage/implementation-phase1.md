# 下一阶段首批实现与验收

基线：`5157390604151cb2e202b27deb7ae84a36d16035`。这是规格索引的首批可交付增量，不是 12 份 spec / 29 项任务的全量完成。逐项边界见 [覆盖矩阵](phase1-coverage.md)。沿用 DSH、Fabric、Ledger、Site、现有 Workbench 和五阶段 Pack 作者流程，没有新增调度、记忆或分析服务。

## 用户可见变化

- Guide 确认方案后创建独立的原生执行会话。相同 Guide/方案重复确认复用原任务；Guide 仍可对话。注册过的 Guide 会把任务挂到相同原生 Workspace；未注册的 cwd 会话保持原 API 行为，不自动创建 Workspace。执行会话恢复核对 workspace、preset、根会话身份和有效模型。
- 人类暂停由既有 RunControl 回执保留来源，Agent 不能通过重复 pause/continue 消除人类暂停。未知旧暂停保守处理；原本的 Agent handoff/adopt 暂停仍可按原授权接续。
- Workbench 提供 Campaign / Data Insight 两个入口，保留聊天草稿及原 Campaign。Insight 当前是准备态；没有声称已经接通 Library 分析。
- 关窗隐藏同一个窗口并保留 Host，重开使用同一 Host；明确 Quit 仍停止 Host。完整的 graceful fence / 等待 EDA 安全边界退出是后续切片。
- Run、记录、材料、归档、日志和控制通过实际观看会话的项目关系授权；UI 缓存按 viewer 分开。普通 observe、job launch、pack prepare 新建 Probe 时记录实际发起项目，不能将旧 Run 重新绑定给任意项目。全局 audit/drain 只留给显式测试配置。
- 工作摘要保存在现有 workspace，引用实际证据及 Run 修订号，注明模型生成、陈旧或不可用。当前是 Campaign 证据支持的摘要，不是完整 session compaction 系统。经验纠偏通过追加 person 回执记录精确源身份、适用条件和新证据，不覆盖旧经验。
- Site 再发现只更新与 Site/Permit 字节身份绑定的派生缓存，不重写管理员政策。陈旧预览、符号链接及不明文件冲突拒绝保存。
- 原生 terminal consumer 已接入固定版本 profile，普通会话可以在同一本地进程中输入、读取、后台等待、中断和关闭；Campaign owner、child 和作者受现有 guard 约束。这不是尚未完成的 Site/Fabric EDA Operator。

## 两个 Pack

DTCO `5.2.11` 与 XTop `1.0.6` 都是未封板的 development 候选，未冒用旧版本的 release seal。

DTCO 为冻结反馈 A/B 保存选择增加/移除或不变的可验证结果，Reader 核对实际 proposal，不能据此宣称真实模型已形成创新能力。

XTop 按用户确认执行：同口径完整物理检查，相对基线不新增 DRC/连通性错误；覆盖不完整不得采用。未知物理语法仍保留 timing 证据，不转为零错误。真实 Tcl 暂标 coverage unknown，完整语法仍需独立资格验证。快照绑定 DB、报告、SPEF、场景和输入身份；best DB 写入不可变版本目录，经验证后更新 manifest，失败不删除上一个 best。endpoint 消失记为 missing；显式非负观测才记 fixed；不可比较的增量不填零。

## 复核与局部证据

按最多主任务加三个 worker 分波并行，公共接线由主集成者负责。普通实现使用既有 Terra/Medium worker；Site/资产/恢复关键复核及补强由新建 Sol/High worker 完成。另有复用 worker 做 Spec 轴复核，其实际模型配置不可追溯，不声称已切换模型。请求数、token 与开发成本未测量。所有“零模型”仅指被测产品没有真实模型请求。

独立复核发现并修复：Run 旧入口跨项目读取、Site 政策保存竞态、纠偏 writer/适用条件、XTop unknown 处理、Guide preset 与原生 Workspace 归属、全局 audit/drain 以及 standalone prepare 项目身份。最后关键增量复核通过；边界是 Host 项目上下文隔离，不是操作系统或 Site 多租户沙箱。

保留原失败及后续证据于 `.hima-tmp/next-stage-implementation/`：

| 验证 | 已保留结果 | 边界 |
| --- | --- | --- |
| 人类暂停反例 / 修复 | `s01-red.log`、`s01-green.log` | 最初确实复现 Agent 清除 human hold |
| 原生 session、Guide 恢复 | 原生 2/2、Guide 3/3；相关 Host 合并 12/12 | 空历史、独立身份、注册 Workspace 归属跨重启保留、无真实模型 |
| 原生 terminal | 1/1；profile/skill 子集 9/9 | 实际本地 PTY，多次输入和中断 |
| Site 文件合同 | 9/9；后续 Site Host 用例已通过 | 无 SSH |
| 冻结反馈 Python | 32/32 | 无真实 DeepSeek |
| XTop Python / 合同 | 22/22、2/2 | synthetic 协议，非真实 Innovus 完整检查 |
| 项目入口反例及 standalone prepare | `project-scope-qualification.log`，3/3 | 一个 subprocess Host、两个 in-process Host |
| Desktop / 双模式 / 草稿 /证据 | `desktop-qualification.log` 8/8；后续相同 8 项在 `desktop-final.log` 通过 | Catsights；窄面板按钮均可访问 |
| 独立 owner / 本地 Job / handoff / 七种状态 | `desktop-owner-green.log`，9/9 | 16 个隔离 Electron；首次唤醒、暂停/Continue、旧 owner 隔离、原生文件；仅 replay、无真实模型 |
| AES / DTCO 共用夹具 | 37/37 | 分别支持旧 AES 单 checkpoint 与新 DTCO 双 checkpoint，仅生成 Tcl 声明的报告 |
| 测试清理 / 历史导入夹具 | 4/4、13/13 | Host 先关闭再删目录；构造 v19–v27 来源时排除 v28 新字段，导入器保持严格 |
| 最终完整 local 组 | 612/612，0 失败、0 跳过；1011.277 秒 | 73 subprocess Host、450 in-process Host、0 Electron、0 SSH |

桌面集成的原失败也保留：原测试假定 Guide 就是 owner、静默测试中的空会话已有 header、以及跨会话共享 dock。现通过各自原生会话的正常输入、Campaign chip、节点确认操作验证，而非由测试脚本直接替代业务操作；清理回调确保失败时也退出测试窗口。

第一次全量 local 为 606 项、594 通过、12 失败，原日志 `full-local2.log` 保留。失败分别定位为暂停来源、独立 Guide 后的旧身份断言、schema 28、已提前拒绝的配置、AES 旧夹具；没有删除失败测试或启动真实 P&R。后一次完整 `check:local` 保留于 `full-local-final.log`：611 项、593 通过、18 失败，定位为上述三个夹具问题（包括 teardown 竞态与错误模拟旧 schema），均已修复。最终全量 local 组重新执行于 `full-local-green.log`：612/612 通过，零失败、零跳过；额外数量差异来自前次失败的测试子进程未完整报告。当前 checkout 未配置 pre-push hook，实际采用显式检查；不将一次成功 push 冒充测试通过。构建、seam、boundary、TypeScript 也通过，最后测试专用改动再次通过类型检查。

## 后续边界

保持 trial30 / Claude / 商业 EDA 暂停。后续仍需 Guide 内任务控制桥与回执、普通 subagent 团队与预算回执、真实 transcript/context 完整展示、graceful fence、纠偏 UI、session compaction 生命周期、F2/F3 交互 EDA 桥、Library E1 资格及真实分析。首批不承诺这些已交付。

App 使用 `0.3.0-trial.17`、Ledger schema 28 的独立 home，避免旧 trial.16 静默打开新 schema。本地候选已完成打包、ad-hoc 签名结构、隔离 home、搬迁 Host/API、DTCO 与 PDF 知识装载检查；没有 notarization 或 GitHub Release。App 源码身份 `2791aee5a288c96b21c2ae3704e96f2eb98c3cf3`，之后的提交只修测试/文档，未改应用字节。详见 [机器可读验收记录](verification.json)。旧 schema 显式导入保持原事实；缺少可靠项目归属的旧 Run 不会自动分配给当前 Guide。
