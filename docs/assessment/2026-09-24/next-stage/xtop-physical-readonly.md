# #55：trial30 物理检查的只读核查与有界 Innovus 资格

第一步没有恢复 trial30 的暂停 Run，也没有调用 EDA/模型。通过只读 SSH 将 trial30 的 g001/g010 报告复制到忽略提交的 `.hima-tmp/issue-audit-2026-09-24/`，核对远端与本地 SHA-256，然后以开发版 XTop 1.0.8 的 Reader 解析完整文件。原始报告不提交到 GitHub。第二步根据安装在 Site 的 Innovus 23.14 `innovusTCR/verifyConnectivity.html`，确认 `-error` 默认上限为 1000、达到上限即停止报告；在**独立**资格目录中用 `-error 1000000` 和相同的 `-noAntenna` 重新检查原输入及 g009 数据库。原 trial30 Run、DB 与报告未被修改。

| 保留报告 | g001 SHA-256 | g010 SHA-256 | Reader 结论 |
| --- | --- | --- | --- |
| Innovus `verify_drc -limit 1000000` | `85d984acdd71f643ad670a2290cce63575545d0a1892929a1606bddcfbbc9c80` | `37b939e4c54e71192f9d591feb1b38a1dcf64d44ebf98ce219a763c1d0c8ba8a` | 两份完整字节各有一个 `Total Violations : 72799 Viols.` footer；Reader 得到 72,799，低于声明的 1,000,000 上限。 |
| Innovus `verifyConnectivity -noAntenna` | `ec3e2185e1986c0ee5eb3fe021d3ecf7d18d9921e114843a67ebe70262f0ae52` | `61c70663c097683c0ca4bef806b2d6382f746e4634876a16ea27f724eb0d1e30` | 两份都只显示 `1000 Problem(s)` 与 `1000 total info(s) created`；没有可证明的完整计数界，状态必须为 `unknown`。 |

不能从“g001 与 g010 均打印 1000 条”推出没有新增连通性错误，因为两份输出均可能被同一个上限截断。也不能从 DRC 数相同推出全部物理质量相同。当前 `physical-check` manifest 仍声明 `coverage: unknown`，因此即使 DRC 可计数，best-DB 资格仍不得晋级。Reader 的红色反例为无法识别实际 DRC footer；修正后 XTop Python 23/23 与 Pack contract 2/2 通过，并在两份完整实际文件上独立得到以上结果。

## 有界真实工具结果

第一次、第二次资格脚本在设计恢复阶段分别因错误使用 `.enc` 内部相对路径和把 `.enc` 脚本当作数据库目录而失败，没有执行检查；各自 console/log 保留。第三次改为 manifest 中确有的 `input.enc.dat`，只读恢复成功。独立 Innovus 命令均以 30 分钟超时限制，实际成功的单次运行约 6–8 分钟；不进行 ECO、route 或 `saveDesign`。

| 数据库 | 检查 | 完整报告 SHA-256 | 结果 |
| --- | --- | --- | --- |
| 原输入 `input.enc.dat`（脚本 SHA `9bd8c465…fc38`） | `verifyConnectivity -noAntenna -error 1000000` | `17f23c6c1c993437bdb696b8fd57bc8fb6e1afd3e5c2a9228fbb4c23d3dc97c3` | 3,465 条，低于显式上限；脚本 SHA `7ee1d78a…7176`。 |
| g009 `closed.enc.dat`（脚本 SHA `fa712ec1…0d5`） | 同一连通性命令 | `f5cf602b4f313a34081c5b68e83ed1d8ccf01e6af8130c066ffc6e6fdfd27b91` | 3,465 条，逐项比较新增 0、消失 0；脚本 SHA `cb782f74…e81e`。 |
| 原输入 `input.enc.dat` | `verify_drc -limit 1000000` | `a1cd503c476e8ecf15b10c9554cb77180867b6c8a95469cc28de3d6b5fe989cc` | 72,799 条，低于显式上限；脚本 SHA `ade4380f…c9`。 |
| g009 `closed.enc.dat` | 原 Run 同一 DRC 检查 | `a652120c1a908372473f3ed750759dcf7c5ee1e9fa79dafb1368c5978ab1c93d` | 72,799 条，逐项比较新增 0、消失 0。 |

新 XTop 1.0.9 开发方法用 `physical-check/2` 声明显式双上限；Reader 逐项核对命令、摘要、实际错误条数和报告 SHA，并以违规类型/网络/坐标的完整身份集合证明无新增错误。即使总数不变，只要出现新坐标，候选仍被拒绝。相对物理参考固定在原 g000 基线和已采用的 best，拒绝代不能为下一代“洗白”新错误；后继候选只有比合格参考更优，才能成为新 best。无命令头的合成零计数、检查范围参数改变、报告条目数与 footer 不同均保持 unknown 或拒绝。上述各条都有红绿反例。只有两份报告均未触限且来源、时序情景与数据库身份满足原门槛时，新 best 才有资格采用。XTop Python 29/29、Pack contract 3/3 通过；后者两次启动真实本地 Host，并在隔离的 XTop 图变体中由 Fabric 的观察节点实际运行 Pack Reader。Reader 被单文件装载，因而独立重新核对保留物理报告，不执行可写的 Campaign flow 副本。实际文件的本地 Reader/物理资格函数复核得到表中数值。Host 路径证明本地观察机制，不冒充商业 EDA 链已通过 Fabric。

**边界：** 原设计本身有 72,799 个 DRC 和 3,465 个连通性问题；这是相对基线无新增的资格证据，绝不是 clean signoff。我们未用新 Pack 重跑 trial30 Campaign，也未改变它保留的 best DB。Empyrean 许可证执行前后均为 `selected=new`，没有启动 XTop/QuaLib API，也没有切换到 `old`。#55 尚需新方法的完整数据库/PrimeTime 证据组合验收；真实工具阶段不等同完整业务 Campaign。

开发与复核使用用户选择的 GPT-6 Sol / high，两项独立复核检查仓库标准与 #55 规格。两次审查发现的旧代物理洗白、合成报告误认、检查参数不同口径，以及合格但较慢的候选误采用都已由独立反例复现后修正；开发 token/成本没有按本切片的可靠计量值。首次完整 local 回归在发现这些缺口后于第 34 项中断，不计为通过；修正后的完整本地回归需单独取得终态。
