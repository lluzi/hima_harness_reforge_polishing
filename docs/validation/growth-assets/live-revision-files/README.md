# 真实远程版本保留

`scripts/live-check-revision-files.ts` 经真实 SSH、现有 Site/Permit，在唯一新建的授权 polishing-runs 子目录上验证 workspace 输入前后版本、已完成 Workshop 不改写、新 Workshop 只接收已批准版本和重放幂等。10/10，3.650 秒；零模型、零 EDA、零 Job，没有删除或影响既有作业。

首次测试在连接前因临时 Site 文件布局不符合 loader 约定失败；修正 fixture 后本次通过。这里直接验证公开 Workspace/Permit/Channel 接口；Campaign 回溯和真实 fork 的旧结果复用由 L2 另行验证，不能把这次字节检查叫作远程完整 Campaign。
