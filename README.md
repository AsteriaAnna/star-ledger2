# 星账

本地优先的个人记账项目。GitHub 管理源码；目标网站、认证和云端数据统一使用上海 CloudBase。电脑侧重 Excel/CSV 批量导入与对账，手机侧重支付详情截图记账，两端共用账务规则。

## 接手入口

1. [当前状态与代码/云端证据](app/docs/project-status.md)
2. [唯一执行计划：M1–M7](app/docs/m1-m7-execution-plan.md)
3. [旧需求对照：保留、取消、待讨论](app/docs/plan-reconciliation.md)
4. [用户任务与系统职责契约](app/docs/responsibility-contract.md)
5. [文档目录](app/docs/README.md) 与 [开发说明](app/README.md)

**当前暂停功能开发。** 2026-10-05 用户要求先整理状态与计划，之后逐项讨论功能并提供测试案例。不得仅凭旧计划自行开发、合并注册代码或部署新版本。

## 仓库与线上是不同状态

- `main`：已验证的个人版代码基线，产品代码基线 `6bf4a99`；后续文档提交不表示应用升级。
- `feature/account-onboarding` / [草稿 PR #17](https://github.com/AsteriaAnna/star-ledger2/pull/17)：受邀注册代码，产品代码基线 `2d25e15`；服务端真实注册已验收，网页注册路由与完整浏览器流程未验收。
- `wip/cloud-recovery-20261005`：未完成恢复工作，保留但不能作为已交付能力。
- `legacy-duo/`：旧双人包，仅供只读参考，不参与构建；新双人权限和账务设定未确认。

[CloudBase 测试地址](https://xingzhang-dev-d0g4a950c6f1204d1-1428502724.tcloudbaseapp.com/)：最近记录为此前部署的个人版；尚未部署 PR #17 新网页。本轮没有实时复查站点或云配置。

GitHub Pages 工作流仍存在，是待整理的历史发布机制，不能作为当前产品发布入口。旧 GitHub 同步适配器仅保留为历史实现/测试，不用于新的用户账本。

原始账单、截图、邀请码、密码和密钥不进入仓库。构建产物由 `app/` 生成，不手改、不提交。
