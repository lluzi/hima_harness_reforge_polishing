# #55：trial30 物理检查报告的只读资格切片

本次没有恢复 trial30 的暂停 Run，也没有调用 Innovus、XTop、QuaLib 或模型。通过只读 SSH 将 trial30 的 g001/g010 报告复制到忽略提交的 `.hima-tmp/issue-audit-2026-09-24/`，核对远端与本地 SHA-256，然后以开发版 XTop 1.0.8 的 Reader 解析完整文件。原始报告不提交到 GitHub。

| 保留报告 | g001 SHA-256 | g010 SHA-256 | Reader 结论 |
| --- | --- | --- | --- |
| Innovus `verify_drc -limit 1000000` | `85d984acdd71f643ad670a2290cce63575545d0a1892929a1606bddcfbbc9c80` | `37b939e4c54e71192f9d591feb1b38a1dcf64d44ebf98ce219a763c1d0c8ba8a` | 两份完整字节各有一个 `Total Violations : 72799 Viols.` footer；Reader 得到 72,799，低于声明的 1,000,000 上限。 |
| Innovus `verifyConnectivity -noAntenna` | `ec3e2185e1986c0ee5eb3fe021d3ecf7d18d9921e114843a67ebe70262f0ae52` | `61c70663c097683c0ca4bef806b2d6382f746e4634876a16ea27f724eb0d1e30` | 两份都只显示 `1000 Problem(s)` 与 `1000 total info(s) created`；没有可证明的完整计数界，状态必须为 `unknown`。 |

不能从“g001 与 g010 均打印 1000 条”推出没有新增连通性错误，因为两份输出均可能被同一个上限截断。也不能从 DRC 数相同推出全部物理质量相同。当前 `physical-check` manifest 仍声明 `coverage: unknown`，因此即使 DRC 可计数，best-DB 资格仍不得晋级。Reader 的红色反例为无法识别实际 DRC footer；修正后 XTop Python 23/23 与 Pack contract 2/2 通过，并在两份完整实际文件上独立得到以上结果。

下一门槛是独立于暂停 Run 的一次有界 Innovus 连通性报告资格：先确定该版本命令能否输出**有明确上限且未触及上限**的完整同口径错误计数，再在隔离工作副本中取得 baseline/candidate 报告。没有覆盖证据则继续不采用。当前 Empyrean 许可证状态为 `selected=new`；本切片未切换它，也没有并发使用 XTop 与 QuaLib API。
