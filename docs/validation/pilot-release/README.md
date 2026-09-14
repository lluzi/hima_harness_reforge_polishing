# PLS-18 / PLS-26 试用交付

本轮组合技术验收与用户授权的独立 Agent 代操作验收已完成。已发布试用版 [`0.2.0-trial.1`](https://github.com/lluzi/hima_harness_reforge_polishing/releases/tag/v0.2.0-trial.1)，macOS Apple Silicon，自带 Node 24；用户的录像 Review、实际试用和研究价值反馈另行记录。

完整真实 DTCO Campaign 使用 Pack 5、DeepSeek V4 Flash 和指定 Site，完成 51 个参考节点及 45 个 Job，形成有证据支持的负结果。时钟周期规则通过，完整约束检查有两类未达标条件；不宣称 Fmax/PPA 收益或物理签核通过。前三路空选择源于模型程序对输入结构的理解错误，不能解释为没有优化机会。

原 Campaign 的附加支路被 ready 探索节点的控制缺陷拒绝，该失败保留。修复沿用现有 Fabric，允许无在途作业的 ready 探索节点增加支路，并阻止其绕过支路直接结案。独立 L2 与真实模型 L4 验证该控制路径，未重复 EDA；不能据此称原 Campaign 已执行那条支路。

模型实际读取了每路完整的有限研究视图，程序读取完整 raw 数据。只读审计核对了视图到 raw/矿工代码的身份、实际写入和执行的代码 hash、最终输出及删减候选后的响应。它没有把“捕获输入”写成“模型在聊天中读完 raw 文件”。归档的 60 份材料与重启记录均核验通过。

独立审阅 Agent 在 Catsights 副屏完成普通编码、真实 Run/代码/报告/资产查看，以及一次五分钟知识复用 Run：在任何实验节点前暂停，读取原归档，记录 `claims=[]` 分析，取消并重启读回。该 study 有 0 实验 Job、0 EDA；Site 的工作区准备和归档文件 I/O 仍发生。取消产生的 bookkeeping 节点不计作执行过实验。

## 证据与测试范围

- [组合技术证据](technical-evidence.json)：原始 L5 失败门槛、完整负结果、独立 L4 与 16 项离线审计分开记录。
- [独立 Agent 审阅](pls26-final-review.md)与[UI / 录像元数据](ui-evidence.json)：真实操作、重启、接受/拒绝及源文件身份。
- [本地回归](local-regression/README.md)：完整组 463/465；两项测试时限修正后分别复验通过。没有把分项复验写成整组重新全绿。
- [Pack 5 封板](pack5/evidence.json)及[单节点真实工具预检](pack5/utilization-probe.json)。
- [已修复阻塞与原失败](blocker-fixes/README.md)：部分 fork 回溯、目录选择器、打包 Node 选择、模型停滞、密度和增长控制问题。

主任务负责集成与验收；常规实现/测试使用 Terra/Medium。最终只读审计新建任务时显式请求 Sol/High，运行时身份未暴露；原独立审阅 Agent 的实际模型/effort 也未核验，不据此宣称已测得开发 quota 节省。真实产品模型基线为 DeepSeek V4 Flash。

## 试用与限制

发布包、SHA-256 和源码见 [GitHub Releases](https://github.com/lluzi/hima_harness_reforge_polishing/releases)。本机另有读取现有凭据、打开保留历史 Home 的专用启动器；本地录屏和完整研究报告通过交付消息提供，不上传公开仓库。

通用发行包不含凭据、私有 Site/PDK 输入或研究资产。应用采用 ad-hoc 签名，尚无商业签名或公证；其他系统/架构未认证。知识复用证明历史引用和控制可操作，不是第二次 PPA 实验。原始模型错误与试验局限仍可回查，用户后续反馈作为下一开发前沿。

发行源为 `207d22f`，见[发行附件与远端 hash](release.json)。最后的取消词条改为中性 `cancelled`，已在发行 App 上实际核对；操作录屏仍保留验收候选的原画面。PLS-18 #19 与 PLS-26 #29 已关闭，父规格 #1 保留用于接续用户试用反馈。
