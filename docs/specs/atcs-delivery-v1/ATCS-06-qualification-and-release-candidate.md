# ATCS-06 — 真实工具资格与固定发布候选

状态：blocked-on-INTEGRATION_READY  
依赖：ATCS-03（M1）  
产出：一个可交给 bounded Campaign 的固定候选

## 前置

- 所有 L0/L2 通过，main/Pack/wrapper 候选 bytes 固定；
- `empyrean-license status` 被记录，无 QuaLib Job；切换到 `empyrean-license old`；
- XTop、QuaLib 不同时使用；
- 每个 qualification 使用新的、隔离的 server work directory；
- 不触碰 Foundation/PDK/read-only inputs 和历史 Campaign。

## 资格矩阵

1. **PrimeTime**：baseline 四 scenario read/link/update/report，验证 clean/violated/precision/report grammar。
2. **StarRC**：一个导出 DEF 的每 corner command，验证 SPEF identity 和 NAME_MAP parser。
3. **Innovus**：restore baseline、一个受限 ECO、route-preserving apply/export、DRC/connectivity readback。
4. **XTop worker**：带 library/STA/site/eco context，执行 query→falsifier→一个 mutation→dump→export→close。
5. **XTop replay**：从相同 base 重放该 Contribution，验证 delta/ops/ECO 一致或诚实 mismatch。

每项记录命令、工具版本、开始/结束、exit、输入/输出 hash、license time、未知和限制。失败保留证据，回到
最低 parser/template/wrapper seam；不启动 Campaign 调试。

## 发布候选

资格全部通过后：

1. 安装新 immutable wrapper，不替换旧版；
2. 生成绑定 Pack digest 的 Operator binding；
3. 运行 native TEST path，但尚不 seal 正式 release；
4. 打包版本隔离 App candidate；
5. 运行 no-model/no-Desktop/no-commercial preflight，核对 App/Pack/Site/Permit/binding/input identities；
6. 编写 ATCS-07 的英文 human-like tester manual。

## 验收

- 五项资格均针对最终候选 bytes；任一 bytes 变化使相应资格 stale。
- XTop transcript 展示真实 timing context、typed commands、one mutation、receipts 和 clean close。
- candidate App 冷启动可发现 Pack/Site，Preparation 在创建 Run 前给出准确 ready/blocked。
- 资格不声称 timing closure 或 ATCS 优于 control。

