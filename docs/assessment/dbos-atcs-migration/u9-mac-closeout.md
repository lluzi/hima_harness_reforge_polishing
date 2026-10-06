# U9 Mac 关单核对

2026-10-05 用户授权：删除 U9/U10 的 Linux 要求，Mac 开发已结束即可关闭 U9。

| 本轮 U9 条件 | 核对结果 |
| --- | --- |
| Mac 原生包及固定身份 | Mac11 source489a63，artifactDigest fb601ae14662d13223d27e7ba3d39d8ff50edcc748aaf7d3da5c54c445700276；manifest/原生报告摘要匹配 |
| 搬移启动、非 root 运行、退出与重开 | Mac11 实际 Host/桌面验证通过；额外账户不声称已测 |
| 切换、历史保持、完整冷备份/恢复、不重复效果 | 原 Mac 包实际 A/B/C、hold、源退休、丢失 Home/Job 目录恢复验证；原失败和定点补验保留；相关源码至当前未变 |
| 当前业务相关可靠性 | 原退出请求等待、报告写入中断、输入/身份/权限/原预算、同 Run 修复及实际资源关闭验证与复核通过 |
| 当前重点业务 | 当前 ATCS 2PASS27.907s，与 Mac11 内163编译文件字节一致；原真实 Mac ATCS 五任务与正常交付保持原身份 |
| 实际依赖材料技术核查 | Mac11 SBOM/通知/来源/实际重建替换绑定，raw1/effective0；不冒充商业签名或正式法律意见 |
| 提交同步 | 实施切片已 push/SHA 核对，本关单规则另行提交同步 |

结论：U9 Mac 开发及技术资格完成，按用户授权关单。Linux 构建/安装/升级/平台报告/硬件/桌面要求从 U9/U10 移除，历史资料保留。U10 继续承担普通 App/Pack 发布封板和最终业务验收；Goal false、UNKNOWN 和 LIMITED 不变。

证据：[原生资格](U9-native-qualification.md)、[源码契约](current-source-contracts.md)、[当前 Mac 交付](mac-current-delivery.md)、[Mac11 身份](actual-run/mac11-root-qualification.json)、[当前 ATCS 字节绑定](actual-run/mac11-atcs-current-code-qualification.json)。

GitHub verification: U9 #92 CLOSED at `2026-10-05T08:52:27Z`; U10 #93 remains OPEN with Mac-only closure criteria.
