# 当前源码契约验证

原真实 ATCS 保持 source32a/Mac08；本页只记录后续代码与测试，整个 U1–U10 仍进行中。

| 增量 | 提交 | 主分支资格 |
| --- | --- | --- |
| Campaign 文件/输入/预算/旧命令拒绝 | d02c7d0f | 21 PASS；真实取消关闭与会话消失；复核接受 |
| Markdown 已写、JSON 尚未写时崩溃恢复 | 55e4ec94 | 新例及最近 3 例共 4 PASS；同身份/摘要/一次业务执行 |
| raw shutdown 不能替代 native finalization | 4e9f73d8 | 6 PASS，保留真实 Host 正例 |
| 接受的原生退出请求等待实际边界 | d03c74b1 | 11 PASS；构建/类型/边界通过；独立复核接受 |
| Guide 项目读取/控制隔离 | 6d3ff730 | 3 PASS；权限矩阵及实际 PG human origin |
| 人工计时与真实人类请求计数 | 5de5bb91 | 会话/Guide 7 PASS +最近控制 10 PASS；重启值/来源/请求 book 相同；独立复核接受 |
| Job 统计读取当前事实序号 | 489a63c4 | exit/revision/报告中断 3 PASS；原 0!=1 反例保留 |
| 同 Run 已知失败修复与公开诊断 | 25901a05 | 7 PASS；owner revise 保留原预算/截止线，原日志/失败原因可读，引用限上游；独立复核接受 |

上述都是零产品模型/SSH/EDA 的局部验证；开发助手 quota 未逐请求测量。原完整 local 一次运行仍为 954 / 713 PASS / 238 FAIL / 3 SKIP，不把局部结果拼为全套 PASS。剩余有效契约逐条对账，不能删除业务、权限、预算、实际资源关闭或历史字节要求。

新 Mac11 资格见 U9-native-qualification；最终 Linux 新源码资格、新 Mac 非管理员账户/原生 Linux 硬件、未闭合语料及正常 release/Pack seal 仍待完成。没有改变原 ATCS 的 best-effort、Goal false、UNKNOWN collateral 或 adoption LIMITED。
