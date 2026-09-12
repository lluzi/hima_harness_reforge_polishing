# [PLS-17] Pack 升级和分享由 owner 控制并保留客户资产

Part of #1 (https://github.com/lluzi/hima_harness_reforge_polishing/issues/1)

Backlog: POL-07, POL-08
Blocked by: [PLS-13 / #14](https://github.com/lluzi/hima_harness_reforge_polishing/issues/14), [PLS-14 / #15](https://github.com/lluzi/hima_harness_reforge_polishing/issues/15)

## 目标与开工条件

PLS-08 的作者/release 入口与 PLS-13 的方法身份已交接。

完成本任务应达到下列验收行为；ready-for-agent 不解除依赖或外部资源前置条件。

## 代码基线与修改模块

实施基线：先由 PLS-20 把上游 `ca47fa0` 与已交付 polishing `263a073` 整合，再以其已验证的集成提交开工。下列上游新增路径在导入前尚不属于本地运行代码；实施时核对真实符号。源项目与旧 himaharness 保持只读。

| 路径 | 修改或核对的接口/职责 |
| --- | --- |
| `packages/harness/src/packs.ts` | release/安装文件边界及方法版本 |
| `packages/desktop/src/local-site.ts` | 同客户更新保留路径 |
| `packages/harness/src/experience.ts` | 资产迁移与材料 manifest |
| `packages/harness/src/tools.ts` | 上游作者/发布入口的授权动作 |
| `packages/harness/src/remote.ts` | 已有用户确认入口及结果投影 |
| `profiles/hima/cordis.patch.yml` | 已交接的作者流程配置 |

## 修改内容

1. 自动归档或模型提出方法改进只形成候选，不改变默认参考方法；Pack owner/授权作者通过已有作者流程确认后生成新方法版本。
2. 同客户升级保留 run-assets 和旧版本身份；自身迁移可携带资产并验证 hash。
3. 向其他客户/公共来源交付时，默认只包含声明的方法文件；客户显式选择分享的研究材料形成可审阅 manifest。
4. 确认基于实际文件清单与差异；分享操作的内容发生变化时重新呈现该内容，不把以前确认当无限授权。

## 验收标准

- [ ] 未确认候选不会变成默认方法；确认升级后旧 Run 的方法、报告与引用仍可解析。
- [ ] 同客户升级/迁移中断后可恢复，资产不丢失；旧新同名路径冲突不能静默覆盖。
- [ ] 默认公开交付清单中没有客户输入、结果、专有算法、凭据或临时文件；显式选择材料与实际产物逐 hash 对照。
- [ ] 单用户 pilot 复用现有 owner 信任范围，不宣称已经实现企业多租户权限系统。

## 分级测试

- L0/L2：真实目录的升级、迁移、默认排除、显式包含、冲突和中断矩阵。
- L3：一次 owner 审阅差异并确认的关键路径；不把文件组合逐个走窗口。
- L4 模型：仅在改变模型作者工具/schema 时做最小检查；共享/迁移本身不需 EDA。

## 交付证据

记录实际基线/本地 diff、复现与根因、测试命令及退出码、通过/失败/跳过/未跑、耗时和昂贵依赖投入。新增或迁移测试说明旧断言去向；只有当前实际执行的结果可称为本次通过。模型/EDA 未跑不得由 replay 或 stand-in 认证。

## 不在范围内

不建 marketplace、多租户权限服务或自动公共发布，不把 AI 提案视为 owner 批准。

## 回滚

恢复前一默认方法指向，保留所有方法版本及资产；对已导出材料只能记录与修正，不能声称已撤回外部副本。
