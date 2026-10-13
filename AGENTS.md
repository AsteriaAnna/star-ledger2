# 星账 AI 接手入口

最新用户任务优先。开始先确认当前分支、HEAD、工作区修改和相关 PR；不要把聊天中的本地提交当成远端成果。

先读 [产品方向](app/docs/product/direction.md)、[AI 工作方式](app/docs/engineering/ai-workflow.md) 和 [当前状态](app/docs/project-status.md)。要决定开发顺序时读 [唯一计划](app/docs/m1-m7-execution-plan.md)；仅按任务检索其他历史报告与代码。文档陈述必须区分已实现、限定测试、真实云端、浏览器、真机及用户验收。旧的“暂停开发”记录只对应 2026-10-05，不再限制当前用户授权的工作。

## 项目边界

- app/ 是当前产品源码；legacy-duo/ 是历史参考，不是新双人版需求。
- domain / accounting 负责事件、资金变动、消费效果和不变量；application / importing 负责任务、来源、去重；storage / sync 负责持久化及恢复；apps/web 负责界面与输入适配。不要把账务规则重新堆进 Web 入口。
- 保持 Transaction、BalanceMovement、ConsumptionEffect 一致；余额不得由页面直接写。截图是证据与识别任务，生成候选后由现有账务入口记账。
- 个人账本先行，关系视图基于独立账号、真实账户和资金归属；不虚构情侣共同账户。
- GitHub 管源码；目标云服务为 CloudBase。真实认证、同步、解密及部署分别验收，不能因模拟测试通过而宣称云闭环。
- 不提交原始私人账单、截图、密码、邀请码、Token 或密钥；不要在说明中记录凭据。

## 每个任务的完成判断

说明用户任务和预计改动范围，定位实际入口，做最小可验证修改；运行相关测试、类型和构建检查。对财务变更验证资金与消费结果，对 UI 变更操作真实入口并检查保存与刷新。提交时报告 SHA、运行命令、结果、环境和未验收项。删除旧文件或合并 PR 前按 [AI 工作方式](app/docs/engineering/ai-workflow.md) 核对引用、替代路径和完整差异。

在 app/ 内开发时同时遵守 [app/AGENTS.md](app/AGENTS.md)。部署、云资源或生产数据修改必须基于该任务的授权和当前环境实测。
