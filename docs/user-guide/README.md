# HimaHarness 使用评估资料包

[下载完整资料包 ZIP](../../output/pdf/HimaHarness-Evaluation-Kit-v1.0.zip)。

面向没有项目背景的评估者，固定对应 **v0.2.0-trial.1 / AES DTCO Pack 5**。产品要求、已验证能力和未知范围分别说明。

- [使用评估手册（Markdown）](evaluation-handbook.md)
- [离线阅读版 HTML](evaluation-handbook.html)：下载后用浏览器打开，支持页内导航和打印。
- [PDF 手册](../../output/pdf/HimaHarness-Evaluation-Handbook-v1.0.pdf)：23 页，嵌入中文字体、可点击目录和资料链接。
- [评估记录表](evaluation-worksheet.md) / [HTML](evaluation-worksheet.html)
- [评分 CSV](evaluation-scores.csv)：8 个维度；未评估填 N/A，不当成零分。
- [管理员交接参考](admin-handover.md) / [HTML](admin-handover.html)：交接卡、54 个 legacy 输入字段、权限/预算与恢复职责。

建议交接人先填好管理员卡，评估者按“了解与编码 → 历史阅读和控制 → 获批的真实研究”推进。不具备 Site 条件的人仍可先做普通编码评估。

资料包不含密钥、客户输入、PDK、研究原始材料或本机私有配置。项目组本机的已填写交接卡单独保留，不放进公开分发包。不要把某台机器专用的启动器直接转给陌生机器。

## 文档维护

`evaluation-handbook.md` 是手册正文源；`build_handbook.py` 生成 PDF 和三个离线 HTML，并重新生成空白评分 CSV。填写时先复制记录表，避免覆盖模板。

需要 Python、reportlab 和中文 TrueType 字体。默认使用本机 Arial Unicode；其他环境通过 `HIMA_MANUAL_CJK_FONT` 指定字体。构建文档不会启动 Hima、模型、SSH 或 EDA。

```sh
python3 docs/user-guide/build_handbook.py
```

生成后应重新检查 PDF 页面、目录、链接、字段和练习预期值。验证范围见 [文档校验记录](validation.json)。这次文档编写没有重复产品运行测试。
