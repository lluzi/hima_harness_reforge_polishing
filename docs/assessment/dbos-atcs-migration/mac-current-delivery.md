# 当前 Mac 重点业务交付

本轮依用户要求只交付 Mac 可运行的重点业务，不要求 Linux 版。

当前普通试用发布为 [Mac trial release](mac-trial-release.md)，App/Pack 封板已生成；用户最终签收待取得。下列 Mac11 为此前内部候选，保留其原资格与限制。

## 前一内部可运行候选（Mac11，历史资格）

- Mac11 App：`.hima-tmp/dbos-migration/u9/candidate-mac-11/HimaHarness.app`。
- 普通启动入口：同目录 `launch-hima-trial.command`；模型认证沿用已有环境变量，不包含密钥。
- artifactDigest：`fb601ae14662d13223d27e7ba3d39d8ff50edcc748aaf7d3da5c54c445700276`；source489a63；ATCS0.4方法 digest仍为ede79。
- 这是内部可运行候选，未生成正式 Pack VERSION seal，未声称商业签名或用户最终签收。

Mac11 的实际打包、搬移 Host、正常退出/reopen及原生材料 raw1/effective0已验证。当前源码的163个JS/声明文件与App内Harness逐字节一致；本轮完整ATCS本地路径2PASS/0FAIL/0SKIP，27.907秒：每例五Task自动完成，一次工程启动、一次Reader，消息身份、报告/归档、产物打开/下载通过。目标达成和Goalfalse正常交付各有一例，broader UNKNOWN4均保留。供应商/model为明确stand-in，无新模型/SSH/EDA调用；这不能冒充一次新的真实GUI/商业EDA运行。详见[当前代码绑定资格](actual-run/mac11-atcs-current-code-qualification.json)。原U8证据已备份并原字节恢复，当前结果另存。

原source32a/Mac08已经通过普通GUI完成真实DeepSeek/OpenCode/XTop的ATCS任务和交付，正常退出并核实所属资源关闭。真实Goal仍false：Hold清零、Setup18残余；UNKNOWNcollateral与prediction-only采用范围不变。后来仅重验改变的元数据、退出、展示与必要恢复面，没有为整理验收重做商业EDA。

剩余198个原测试对账条目不再作为本轮整体门槛；真实业务/权限/预算/不重复效果/恢复/历史保持仍是要求。额外账户与Linux硬件属于后续环境覆盖，不能标PASS。正式发布封板及用户签收与“当前Mac重点业务可运行”分开记录。
