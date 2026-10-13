# app/ 工作入口

继承 [仓库规则](../AGENTS.md)。本目录是个人版当前源码，legacy-duo/ 只作历史参考。

任务开始时核对分支及工作区；按任务读取 [产品方向](docs/product/direction.md)、[状态](docs/project-status.md)、[唯一计划](docs/m1-m7-execution-plan.md) 和 [AI 工作方式](docs/engineering/ai-workflow.md)。旧日期报告提供证据，不是待办或禁止开发的持续指令。

代码职责：packages/domain、accounting 保存账务规则与不变量；packages/application、importing 负责流程、来源和去重；packages/analytics 使用统一资金及消费口径；packages/storage、sync、platform 处理保存、加密、同步和平台边界；apps/web 处理页面与输入适配；cloudbase/ 处理云函数和配置。不要在 main.ts 重新实现账务规则。

每个可验收任务说明入口、修改范围、相关测试及真实环境结果。账务改变须验证 Transaction、BalanceMovement、ConsumptionEffect 及刷新后的余额/统计。按需运行 npm test、npm run typecheck、npm run typecheck:web、npm run check:platform、npm run build:web 和对应浏览器脚本；确认脚本检查的是当前入口，模拟云端不当作真实同步。

PR #17 受邀注册与 PR #18 截图能力仍为草稿，不能仅凭 CI 或标题整包合并。不要修改/部署其他任务的 WIP 或提交私人数据。完成后更新事实状态；不以文档提交冒充产品代码或云端升级。
