# 上游任务承接与范围

来源仓库：`lluzi/hima_harness_reforge_claude`。核查日期 2026-09-12，代码固定在 `ca47fa0`。本表中的编号全部是上游编号；本仓库实施任务为 PLS 编号。原项目代码和 Issues 保持只读；上游 closed 不替代 polishing 独立验证，open 也不意味着完全没有相关实现。

## 已合入能力

上游 #54、#56～64 已关闭并有主线代码/资料：诚实模拟、Site 探测、Pack-local 数据、Strategy、模型会话、九阶段 stand-in、reader 语义、Workshop、五阶段作者流程。PLS-20 整体接收并核对覆盖；不能把 #64 完成理解为没有后续编译缺口，#79 已明确记录 Workshop 声明仍未生成。

## 剩余业务与发布工作

| 上游任务 | 当前状态 | polishing 承接 | 独立交付标准 |
| --- | --- | --- | --- |
| [#65](https://github.com/lluzi/hima_harness_reforge_claude/issues/65) AES Fmax probe | open | PLS-23 → PLS-08 | 作者流程、真实 probe、test/release、后续研究输入；同一 Agent 推进 |
| [#66](https://github.com/lluzi/hima_harness_reforge_claude/issues/66) 代码/知识与 ending 展示 | open | PLS-24；研究分析为 PLS-15 | 在 UI-02 原面板中展示核验过的版本，不新建分离工作台 |
| [#67](https://github.com/lluzi/hima_harness_reforge_claude/issues/67) 挖掘 Loop 与完整工具链 | open | PLS-25 | 六路线、合并、库 gate、采用/liveness 与正式 Pack，复用 PLS-09 算法 |
| [#68](https://github.com/lluzi/hima_harness_reforge_claude/issues/68) 完整 Campaign | open | PLS-18 | 匹配双臂、实际 AI 研究、控制/恢复、报告/资产与第二次引用；一套 L5 |
| [#69](https://github.com/lluzi/hima_harness_reforge_claude/issues/69) 第二位用户 | open | PLS-26 | 实际未参与开发的工程师操作与确认；不能由 Agent 代签 |

## 已知缺口与后续治理

| 上游任务 | 处理方式 | 边界 |
| --- | --- | --- |
| [#70](https://github.com/lluzi/hima_harness_reforge_claude/issues/70) 数值精度与范围 | PLS-21 验证正式 Pack 实际需要的范围/精度 | 不借机建通用参数语言；已合法数值不能被静默修改 |
| [#71](https://github.com/lluzi/hima_harness_reforge_claude/issues/71) 解析重复与重复参数名 | PLS-21 共享被实际入口使用的校验并拒绝重复名 | 纯整理不扩大成单独前置 |
| [#72](https://github.com/lluzi/hima_harness_reforge_claude/issues/72) Goal 去固定 period | PLS-21 | 以 period 与 AES 改善目标两个真实用例验证 |
| [#73](https://github.com/lluzi/hima_harness_reforge_claude/issues/73) 测试辅助和边界 | PLS-20 对账现有实现，必要修复随对应模块 | 不把出口重命名当产品功能 |
| [#74](https://github.com/lluzi/hima_harness_reforge_claude/issues/74) tmux absent 判定 | PLS-19/23 的恢复与 Site 检查先复现，影响路径时修复 | 暂不宣称已修复；不得把未知 Job 生死直接当已退出 |
| [#75](https://github.com/lluzi/hima_harness_reforge_claude/issues/75) 动态 argv 字面值 | PLS-21，生产 Job 前置 | wrapper 的允许不等于变量内容安全，L2 验证无启动副作用 |
| [#76](https://github.com/lluzi/hima_harness_reforge_claude/issues/76) 创建作者会话 | PLS-22 | 复用 dsh 工作区和当前对话入口 |
| [#77](https://github.com/lluzi/hima_harness_reforge_claude/issues/77) reader 迁进 Pack | PLS-23/25 的正式业务采用 Pack 自带 reader | 把全部旧 bundled reader 搬走不作为当前统一前置；需有兼容证据 |
| [#78](https://github.com/lluzi/hima_harness_reforge_claude/issues/78) Ledger 写入 schema | PLS-19 必须验证本轮新增/改变的控制和执行记录 | 全部旧记录的治理另行按反例立项；不表示旧全集已认证 |
| [#79](https://github.com/lluzi/hima_harness_reforge_claude/issues/79) 真正生成 Workshop | PLS-22，正式作者流程前置 | 当前 Skill 明确只写 prose，必须生成可加载/执行声明 |
| [#80](https://github.com/lluzi/hima_harness_reforge_claude/issues/80) reader 首词固定 | PLS-21，reader 接纳前置 | 无占位符，实际 wrapper 与 Permit 对应 |
| [#81](https://github.com/lluzi/hima_harness_reforge_claude/issues/81) Workshop 文件上限 | PLS-12 的研究写入/预算边界；PLS-19 先保留现有权限和单次工具限制 | 在完整研究前给 Pack 明确文件/字节限制，不能通过调用次数变成无限写入 |
| [#82](https://github.com/lluzi/hima_harness_reforge_claude/issues/82) Chat card 渲染 seam | PLS-24 使用现有 Host 投影与关键真实 L3 两入口核验 | 不为此创建第二 UI 测试框架 |
| [#83](https://github.com/lluzi/hima_harness_reforge_claude/issues/83) 安装态真实模型 | PLS-22；PLS-19 的 L4 也按安装态做 | 不向模型提供开发源码补救产品材料不足 |
| [#84](https://github.com/lluzi/hima_harness_reforge_claude/issues/84) packs.ts 拆分 | 暂不承接为 pilot 前置 | 只有当前改动确需职责边界调整时做有证据的小重构 |
| [#85](https://github.com/lluzi/hima_harness_reforge_claude/issues/85) 校验错误可读性 | PLS-21/22 的输入和作者错误场景 | 复用现有错误投影，不新增全局错误框架 |

本表给出归属而非关闭证明。未单独建 Issue 的范围若出现明确阻塞且不能在对应任务内安全完成，应在 polishing 创建有最小反例与依赖的新任务；不修改源项目的完成记录。
