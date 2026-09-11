# [PLS-05] 开始前展示 Pack/Site 静态匹配与可行动的输入错误

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-03
Blocked by: #3

## 目标与开工条件

可在当前基线实施；当前接口的 Goal 仍以已支持的数值语义为限。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

基线为 `b4ac9d9360ad6da68b5fd2824621ba6edab7408b` 的本地 polishing 导入。实施前核对导入清单和当前差异；仅 GitHub clone 尚不保证已含本地源码。Prototype 与旧 himaharness 保持只读。路径为本仓库相对路径。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `packages/harness/src/packs.ts` | checkPack / PackCheck / installedPacks / goalParametersOf |
| `packages/harness/src/remote.ts` | startChoices / workbenchPage / startCampaignOperation |
| `packages/harness/src/workbench.ts` | renderStartForm / START_FORM |
| `packages/harness/src/card-labels.ts` | startForm / startKnobField |
| `packages/harness/src/fabric.ts` | startRun 保持最终验证权威 |

## 修改内容

1. 在现有工作台选择 Pack/Site 后展示已有 checkPack 的静态匹配结果；复用现有 page/HTTP namespace，不创建独立预检组件或第二校验器。
2. 空 Pack、空 Site、坏 Pack、缺少绑定、wrapper/规则不匹配均有用户可行动提示。失败条目关联输入或准备责任；不将静态 fit 显示成真实 SSH/许可证/EDA 已就绪。
3. Pack/Site 变化时仅采用匹配当前选择的响应，保留仍适用的输入；请求过程中阻止同一表单重复提交，失败后可修正。服务端 startRun 仍重新校验，不能依赖 UI 的旧结果。
4. 暂不抽象通用 Goal 表单：正式 Pack 的实际 Goal 若无法表达，PLS-08 先记录确切字段/语义，再局部扩展已有表单。

## 验收标准

- [ ] 各静态不匹配用例在 L2 不创建 Run、不发 Job；有效选择后能正常启动。
- [ ] 两个快速切换的 Pack/Site 响应倒序返回时，表单不会显示或提交旧选择的策略。
- [ ] 表单拒绝保留输入和明确原因；首次空 home 有准备入口说明。
- [ ] 所有新增 HTTP 读取仍受既有 session/Origin fence；明确请求错误、Site 配置问题与内部错误。

## 分级测试

- L0/L1：已有声明/参数边界。
- L2：真实 HTTP 下空/坏/不匹配/有效/过时选择与拒绝无副作用矩阵。
- L3：一条合法提交与一条修正错误后提交；UI 响应竞争需在真实页面验证一次，数值组合留 L1/L2。
- L4：静态检查不需真实 Site；真实就绪检查另行显式执行。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不新增通用表单框架，不承诺任意 Site，暂不建立多客户配置平台。

## 回滚

恢复表单与既有 route 投影；保持原 startRun 验证入口。
