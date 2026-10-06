# Mac 试用发布与 U10 验收入口

当前试用包已通过普通发布入口生成；ATCS 0.4.0 的方法由原生工具封板。U9 已关闭，U10 仍开放，最终用户签收尚未取得。Linux 不在本轮范围内。

## 试用入口

- App：`.hima-tmp/dbos-migration/u10/mac-release-02/HimaHarness.app`。
- 普通启动：同目录 `launch-hima-trial.command`。启动前应先正常结束其他 HimaHarness App；模型认证沿用既有环境变量。
- App 版本 `0.3.0-trial.35`，源码 `fd9cb10c979544394305669f33a9d5a913762c6c`。
- artifactDigest：`dfae0348263ca07c043f3a8386088ac9790a8e44fbf63750d08a24e7615e83db`。
- manifest SHA256：`d6fae9494811095618bed3b518a3eb598f8cf1c32fb30b9ca60ca5734c661230`。

这是本机可用的普通试用发布候选，尚未向 GitHub 上传 release 资产，也未声称商业签名或用户认可。完整结构化证据见 [发布记录](actual-run/mac-trial-publication.json)。

## 发布机制与验证

在保留的作者 Home 中，完整本地 residual Run `run-c3d71089-6450-49f2-8db1-98c5c4c6d8f5` 以 `test` 身份完成五个任务、报告、归档及产物检查。供应商与模型使用明确 stand-in，零模型 API、SSH 和商业 EDA。原有真实业务 Campaign 没有被改写为测试 Run。

该 Run 暴露了实际发布缺口：DBOS 已记录结束，Pack 检查工具/命令仍读取旧 Ledger，误报“未启动”。修正在既有 Pack 模块内完成，两入口读取同一当前事实，保留同步历史检查与客户已发布 Pack 的可携带封板。最小反例先失败，最终对应 Host 文件 2/2 通过，11.983 秒；适用历史检查 3/3，6.116 秒。原额外旧入口失败保留。构建、完整类型、seam 与 boundary 通过；独立 ce-code-review 无发现。简化只去掉了非 DBOS 路径的一次重复读取。

升级前先用原可执行字节正常收束；保留版本不符的启动拒绝。之后从同一结束 Run 经 `hima_pack_check` / `hima_pack_release` 生成 `VERSION.yml`，覆盖 354 文件。伪造 Ending 被拒绝且不写 seal；恢复真实 Ending 后发布成功，新增业务 Job 为零。方法 digest 仍为 `ede79ecaf59981fa8107962298b5c2c12ce01bb00b8862118b4738a177f3c83e`。`contract.status` 仍是 development；方法完整性封板不等于更广泛业务成熟度。

普通 packager 实际 Node/PG/Host 及包校验通过。原生材料报告核对本包与已接受的固定源码、通知、重建和替换证据：raw1/effective0；未重新做不变库的重建。

封板后另以普通 `campaign` 身份通过完整本地 residual 路径：五任务、一次工程启动、一次 Reader、交付下载/重建、报告/归档及原 deadline workflow 结束。163 个编译文件与上述 Mac 包逐字节相同。供应商/模型仍为 stand-in，不是新 GUI 或商业 EDA；原 U8 输出未覆盖。准确 Run、耗时与证据目录见结构化发布记录。

桌面命令退出0，17.29秒，完成私有 Home、旧 Home 拒绝、准备、正常退出和重开。本次发现原有 `customer-demo-kit` App（PID11056）已运行；预检失败后仍启动了验证，这是执行上的失误。因此该次不计作符合单 App 规则的隔离 GUI 验收。测试所属 App 已退出，演示 App 保留；原 Mac11 生命周期与 source32a 独立真实 GUI 证据保持各自身份，不冒充本次重测。

## 用户需要验收的结果

原真实 DeepSeek/OpenCode/XTop ATCS 已在正常 Mac App 路径完成五任务、交付打开/下载和资源收束，无开发者救援或人工 completion。Hold 109 个违例清零；Setup 从28改善至18，Goal 仍为 false。四项 broader collateral 与 regression 为 UNKNOWN，原生结果为 prediction-only，不能作为物理采用或签核。

最终四项结论与工程材料保持在 [原真实验收](README.md)及 [acceptance.json](acceptance.json)。用户签收决定针对 Mac 迁移和可运行的业务交付，不应把 Timing 残余改成 PASS。
