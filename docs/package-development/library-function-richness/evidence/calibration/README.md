# LFR-FW-01 calibration corpus / 校准语料

状态：**FW-T0 PASS；语料身份已冻结，代理校准尚未开始。**

本目录是 Library Function Richness Framework 的开发证据，不是
`custom-cell-fmax-dtco` HimaPack 的交付内容。它只保存路径、SHA-256、字节数、紧凑事实和明确缺口；
AES RTL、foundry Library、47-Cell predicted Liberty、商业网表、报告、数据库及日志均未复制到 Git。

机器可读入口是 [`corpus.v1.json`](corpus.v1.json)。其自哈希覆盖除
`corpusIdentitySha256` 自身以外的完整 canonical JSON。`validate_corpus.py` 独立复算语料和 RTL
集合身份，并拒绝缺失的商业证据类别、被混同的两轮条件或任何标成已提交的原始材料。

## 冻结范围

两轮均使用：

- `aes_cipher_top` 和同一组 7 个 RTL 文件；
- 同一份 Site 约束，clock period 为 0.5 ns，DC uncertainty 为 0.25 ns；
- 同一 foundry `.lib` / `.db`；
- 同一份 47-Cell predicted Liberty；
- DC 采用 21 个候选、307 个实例。

它们不是同条件重复试验：

| 条件/结果 | 首轮 clean low-gain | 修正压力后的负结果 |
| --- | ---: | ---: |
| APR uncertainty | 0.125 ns | 0.175 ns |
| CTS policy | 旧版未限制为 DCCK-only | Site 声明的 DCCK-only |
| generated final WNS | -0.019 ns | -0.058 ns |
| route 保留定制实例 | 250 | 222 |
| matched Fmax 变化 | +0.192678% | -0.179211% |

因此 FW-04 必须把 mapping proxy 与 physical correction 分开校准，不能把两轮的 sign 差异归因于
Library 本身，也不能把两轮拼成一个同条件样本。

## 证据覆盖与缺口

每轮都有 hash-bound 的 predicted Liberty、DC adoption record、generated PNR record、最终数据库
timing paths、最终数据库 census/verify record 和 matched comparison record。清单还引用本机被
`.gitignore` 排除的 retained evidence index，以便当前开发环境复核来源关系。

仍然缺少：

1. 首轮 PNR record 早于 routed-netlist CTS master 审计，没有冻结可独立复算的 post-route netlist；
2. 尚无固定 Yosys/ABC 版本产生的 mapping、adoption、mapped netlist 或 proxy timing；
3. 原始商业材料只保留在 Site 或 ignored local evidence 中，纯仓库测试只能证明身份与结构。

这些缺口是 FW-02～FW-04 的输入，不是 FW-01 的通过项。FW-01 没有运行 Yosys、ABC、LC、DC、
Innovus、模型或 Desktop。

## 最小验证

```bash
python3 docs/package-development/library-function-richness/evidence/calibration/validate_corpus.py
python3 docs/package-development/library-function-richness/evidence/calibration/validate_corpus.py \
  --verify-local-retained
python3 -m unittest discover \
  -s docs/package-development/library-function-richness/evidence/calibration \
  -p 'test_*.py'
```

---

Status: **FW-T0 PASS; corpus identities are frozen, proxy calibration has not started.**

This directory is development evidence for the Library Function Richness Framework. It is not
shipped HimaPack content. Git contains only locators, SHA-256 identities, byte counts, compact facts
and explicit gaps. AES RTL, the foundry Library, the 47-Cell predicted Liberty, commercial netlists,
reports, databases and logs remain on the Site or in ignored local evidence storage.

Both trials used the same seven-file `aes_cipher_top` RTL set, Site constraint bytes, 0.5 ns clock,
0.25 ns DC uncertainty, foundry Library and 47-Cell predicted Liberty. DC adopted the same 21
candidates as 307 instances. They are not repeated measurements under one condition: APR uncertainty
changed from 0.125 ns to 0.175 ns and CTS changed from the legacy unrestricted policy to the
Site-declared DCCK-only policy. The first run retained 250 custom route instances and improved matched
Fmax by 0.192678%; the corrected run retained 222 and changed matched Fmax by -0.179211%.

FW-04 must therefore calibrate mapping behavior separately from physical correction. It must not
attribute the sign change to the Library alone or pool these trials as identical-condition samples.
The known gaps above remain explicit inputs to FW-02 through FW-04. No Yosys, ABC, LC, DC, Innovus,
model or Desktop process was run for FW-01.
