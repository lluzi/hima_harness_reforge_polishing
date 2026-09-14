# Agent代操作审阅，非真人认可

状态：Phase 1 普通编码试用通过；PLS-26 后续的完整 pilot 资产、知识复用、重启读回与录像审阅仍未执行。

## Fixed candidate Phase 1

2026-09-13，在指定的 fixed candidate
`/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release/fixed-candidate/HimaHarness.app`
中，通过 `Internal Testing Notice` 后，`Add workspace` 打开了产品内的 `Select Workspace Directory`
选择器。用其 `Edit path` 输入并打开预先提供的
`/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release/reviewer-general-fixed/workspace`；
工作区列为 `workspace`，界面显示模型为 `DeepSeek-V4-Flash`、`High`。

在同一普通对话中，请求用两条内联 timing 场景创建、执行 Python 脚本，并禁止 Site、EDA 与
Campaign。Agent 创建了 `timing_analysis.py`，界面显示实际命令 `python3 timing_analysis.py`
（Python 3.9.6）及退出码 0。输出将 A 判为 PASS（0.08 相对裕量），B 判为 FAIL（-0.0333），
并将 B 标作更紧。通过产品内文件标签检查了完整脚本：它含内联数据、`periodns > 0` 检查、
`setupwns / periodns` 计算和明确的 PASS/FAIL 条件。

Agent 还明确说明该符号规则与“更紧”指标只是本试用选择，未验证为 STA 语义，且忽略时钟不确定性、
OCV 与库/多角落 derate。这足以证明一次本地工作区内的正常对话、文件创建、执行、输出和限制说明
可从界面理解；不证明 signoff、DTCO 收益、远端工具或研究价值。

## Recording retest

此前的功能性 Phase 1 通过时没有保存可交付录像，故单独重做一次真实 UI 编码任务以供录像校验。
在同一 fixed candidate 的产品内目录选择器中再次输入并打开既有 reviewer-general-fixed 工作区，随后
新建会话；模型选择器仍显示 `DeepSeek-V4-Flash`、`High`。约 20:33 开始到同一分钟完成，界面报告
13 秒、1 turn、3 steps。

请求新的三场景合成样本脚本并执行。实际经界面写入和运行的文件名为
`timinganalysisrecorded.py`。检查原生持久化会话后，收到的用户消息中已经没有下划线；
当前证据指向 CUA 输入保真问题，不能归因为产品或模型改名。后续含路径或特殊符号的输入采用粘贴并在发送前读回确认。
该文件仍是新的、独立的本地文件。UI 显示命令
`python3 timinganalysisrecorded.py` 和 A PASS、B FAIL、C PASS 的实际输出；检查文件标签确认三条
内联样本、零或正 PASS 的规则、归一化裕量排序和标准库限定。回复明确说明合成样本与指标选择不构成
真实 STA/signoff、时钟/路径/角落或 hold 结论；未使用 Site、EDA、远端服务或 Campaign。

实施者已核验本轮录像自然结束后成功保存：`pls26-coding-recorded.mov`，540.17 秒，
1280×860，H.264，无音轨，77,549,975 字节；SHA-256：
`9f140933b9335aae792e4e254f612bd6dce485e472140bffbc08c53c2bfca415`。
已抽取并检查目录选择、对话和代码画面；录像只作本地交付，不上传公开仓库。

## Earlier attempts (retained, not the current result)

首次 CUA 以非唯一的 `HimaHarness.app` 名称解析，错误启动了旧的未签名副本；
该副本的启动失败不用于评价当前候选。随后仅连接指定路径的 signed candidate，成功通过
`Internal Testing Notice` 并进入 DeepSeek Harness 初始界面。

在正确候选中，尝试通过实际 `Add workspace` 和 `Choose workspace` 控件选择预先提供的
reviewer-general 工作区。普通点击、坐标点击和焦点键盘操作均未打开路径选择器；界面始终
显示 `Choose workspace`，消息发送按钮保持禁用。没有用环境变量、后端接口或源码方式绕过。
因此无法开始规定的普通内联样本编码任务，也无法确认模型选择、生成文件或执行输出。

首次错误副本中，启动页曾显示
`The hima profile did not start`；页面给出的唯一诊断为 `dsh exited early with 0`。
因此没有出现初始 Continue notice、模型标识、工作区选择或对话入口。

在上述失败尝试中，未发送模型消息，未创建或修改试用工作区，未运行远端 Site、EDA 或 Campaign，也未关闭应用。
这些失败曾阻断 PLS-26 Phase 1 的 UI 操作；它们不构成关于模型能力、编码能力、DTCO
研究、知识复用、重启读回或真人认可的结论。待实施者修复并重新提供可进入产品的候选窗口后，应从
普通内联样本编码任务重新开始此 Phase。
