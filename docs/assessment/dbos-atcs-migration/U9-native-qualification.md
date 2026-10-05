# U9 原生候选与技术义务检查点

状态：原生候选的本地机制和本节列明的技术义务已验证；U9 整体资格与 U10 未完成。
两个 App 均由源码检查点 `32a03eb4d8b31454d64525d3465566a17768b72e` 构建。
后续测试夹具和外部报告工具的改动没有重写 App、SDK、PG、Pack 或原始 manifest。

| 项目 | macOS arm64 | Linux x64 |
| --- | --- | --- |
| artifact digest | `f3761080797de7cc6d2d85f11eae2f1309514ca68a236d9847b6e043ef92e9a1` | `01050103a69b1940656bb69210bedb2d5915ba2a27fc8992cbdc71b4f2a19326` |
| manifest SHA256 | `521dda9b70fcb2a4688b5541a4e437d8a6d5981b5a425e1d9c765a3446637b1c` | `7877cb1ea287d9812a84a9475690b26297a81817d93a866cdc60d7b44b0d72dd` |
| 对应源码文件 | 1275 | 1305 |
| 实际适用的补充通知 | 131 | 139；输入157中18项仅对应未分发的Darwin包 |
| 与原替换试验的原生对象绑定 | 90；89字节相同，外层程序仅签名不同，程序体及ad-hoc政策相同 | 83全部字节相同 |

Mac08 的完整包校验、实际包内 Node/PG/Host、Pack/PDF、搬移启动通过。
Catsights 上的新 Home、旧 schema Home 不改字节的拒绝、本地 Site/Pack 准备和正常退出通过。
完整 App 搬至含 `#` 和 `%` 的目录后，相同桌面检查通过。第一轮搬移检查错误地在复制
结束前执行，ENOENT 是准备失败，保留 `mac08-desktop-special-path.log`；复制完成后的
`mac08-desktop-special-path-complete.log` 才是通过证据。

实际 Mac08 冷备份组首次4PASS/1FAIL/0SKIP，309.231秒。丢失原Home和Job目录、最终退休
快照、原效果不重复、hold与第三Home续接的完整例通过274.544秒。新增跨版本测试在恢复
后的只读查询中按pnpm逻辑链接加载pg失败；仅将测试的createRequire锚定到真实package.json。
同一包内Node/PG/Harness的该例补验1PASS/0FAIL/0SKIP，30.000秒；原4/1/0不改写。
该一行夹具改动已完成独立定点复核。

Linux为Mac上的Ubuntu22.04 x64模拟用户空间，普通UID10042。原生依赖、搬移（空格和
`#`/`%`）、无全局Node/PG、私有PG身份保留与两次正常退出重开通过。标准Chromium
sandbox启用，CapEff0/Seccomp2；临时内部NIC无外部路由，真实Xvfb连接、WebSocket101、
原生会话和项目权限200/403、Pack知识准备、窗口隐藏重开及两次冷启动通过。
未使用privileged、no-sandbox或全局内核改动。两次完整Workbench/Pack DOM准备探针失败，
该深层交互仍NOT QUALIFIED；不能将连接成功替代完整GUI业务。所属6个临时Home/Workspace、
网络及Hima/PG/renderer进程均已清理，原分发物与最终分发物清单保持。

## 最终许可证技术报告

原始SBOM始终保留libvips的一条提示。外部`hima-final-native-obligations/1`报告核对最终
整个文件清单、原生库/消费者、原试验对象、源码和改动补丁、通知、RIGHTS、真实重建、接口、
替换映射、PNG操作和正常收束记录。它只消解已核对的FFmpeg/libvips技术义务，不依据
qualification文本、approved布尔值或豁免开关。两个实际最终清单的raw unresolved均为1，
effective unresolved均为0，原始文件不修改。

已有重建/替换试验按明确字节等价关系复用，没有再跑库重建、GUI或模型。
Linux早期全导出比较失败保留；实际消费者接口和运行证明单独核对，不将失败历史改成通过。
运行JSON中的临时认证端点不进入公开报告，仅输出必要映射、hash、操作与收束摘要。

报告接口是已有packager的只读路径：

```sh
node scripts/package-trial.mjs --finalize-native-obligations /actual/native/artifact \
  --native-evidence /retained/admitted-evidence.json --report /new/external/report.json
```

输出必须是新的外部文件。真实父目录、App与manifest边界核对加独占创建，防止符号链接、
硬链接或重复报告重写分发物/输入。该风险先复现再修复。主工作区完整打包17例通过6.806秒，
测试类型检查通过；Sol/medium实现，Sol/high专项审查无未关闭发现，零产品模型/EDA调用。

本记录不声明新的Mac非管理员账户安装、原生Linux硬件/物理桌面、未测试GUI业务、
真人签收、正式商业签名、所有未来产品条款或零法律风险。缺少这些证据时不能声称对应
平台交付或整个迁移验收完成。实际App/ATCS业务由U10单独证明。

证据：`.hima-tmp/dbos-migration/u9/packaging/`、`backup/`、`license-binding/`及
`licenses/final-binding-judgment.md`。两个外部报告位于`candidate-mac-08/`和
`packaging/final-linux/`的`final-native-obligations.json`。
