# 1.0 基线与恢复发布

2026-09-26 改造天空分布之前的版本已保存并推送为 Git 标签
[`v1.0.0`](https://github.com/Yun532/LACT-observation-plan/tree/v1.0.0)，
对应提交 `cf996afa48989162e25bb44f6c97986c0a0eb964`。
该标签固定保存代码和公开资源，不包含私有二期源表、浏览器本地目录或观测任务。

## 将网站恢复到 1.0

1. 打开仓库 [Actions → Test, build and deploy](https://github.com/Yun532/LACT-observation-plan/actions/workflows/deploy.yml)。
2. 点击 **Run workflow**，工作流分支保持 **main**。
3. 将 **revision** 从 `main` 改为 `v1.0.0`，再运行。
4. 等待 `build` 和 `deploy` 成功，刷新 [网站](https://yun532.github.io/LACT-observation-plan/)。

这里使用 main 上的工作流读取指定版本的源代码，重新测试、构建并发布。
无需删除新代码或强制改写 main；只恢复网站当前发布的版本。
手动运行时必须选择 main，否则工作流只构建而不会发布。

恢复期间不要同时触发其他发布；若有已排队或正在运行的 main 发布，先在 Actions 取消它们，再执行恢复。
之后再次推送 main 会自动发布 main 的新版本。
如需返回最新版本，以同样步骤将 revision 填为 `main`。
普通 push 构建事件中的准确提交 `github.sha`，不会误用回退版本。

浏览器中的私有目录与计划保存在本地，切换发布版本不会将其上传，也不以 Git 标签备份它们。
后续版本如改变本地存储格式，需要单独检查兼容性，不能仅凭代码回退保证旧版本能读取新格式。
