# 文档目录与优先级

接手顺序：[当前状态](project-status.md) → [唯一执行计划](m1-m7-execution-plan.md) → [旧需求对照](plan-reconciliation.md) → [职责契约](responsibility-contract.md)。[仓库与云清单](repository-and-cloud-state.md)保存分支、部署与需复查项。

最新用户明确修订优先；本文四个当前入口互相分工，只有执行计划决定顺序。发生新决策先更新这些入口，再写有日期的证据，不再向多份旧计划不断追加“当前下一项”。

## 当前需求讨论

- [需求与开发安排讨论稿 v1.3](2026-10-05-requirements-discussion.md)：目前进行到“导入与截图”案例讨论，日期与统计已有初步方向。此文保留候选任务和待决边界，不作为另一份执行计划。

## 当前重要证据

- [K05a最终PG整改复测](2026-10-06-capture-pg-retest-accepted.md)：真实功能9/9、有效权限48/48；PG子项通过，截图阶段仍部分通过。

- [K05a真实PG部分验收与整改](2026-10-06-capture-pg-real-acceptance-and-fixes.md)：真实API返回值和默认ACL修复，当前等待定向复测。

- [CloudBase识别任务/结果基础](2026-10-06-capture-postgres-foundation.md)：源码与真实PG验收指令；当前会话云连接缺失。

- [AI响应→公共导入集成](2026-10-06-capture-response-import-integration.md)：冻结响应回放、分类/任务/原子结果边界；下一项真实识别服务。

- [AI截图基础计划](2026-10-05-ai-capture-development-plan.md)：阶段与验收；[多事件来源](2026-10-06-capture-multi-event-foundation.md)、[正式证据保存与恢复](2026-10-06-capture-ledger-evidence-persistence.md)、[退款跨来源匹配](2026-10-06-refund-cross-source-matching.md)、[删除态与显式恢复](2026-10-06-import-deletion-and-explicit-restore.md)为限定本地实施记录。

- [真实文件导入修复](2026-10-05-import-fixes-progress.md)：169+169样本结果与未完成资金端。
- [改账](m5-2-editing-progress.md)、[退款](m5-3-refund-progress.md)、[来源恢复](m5-1-source-review-progress.md)：限定验收，不等于完整任务通过。
- [服务端受邀注册](2026-10-05-account-onboarding-progress.md)：以末节真实PG/注册/登录验收为准。
- [OCR资源](2026-10-05-ocr-resource-progress.md)、[范围统计](2026-10-05-period-progress.md)：合成/本地证据；真机不足。
- [手机反馈](2026-10-05-mobile-feedback-plan.md)：用户问题，尚未修复。

## 历史设计与进度索引

下列原文保留，顶部已标记历史状态；旧分支/命令/下一步不能作为执行授权。JSON验证记录同样是带版本的证据，本轮不改写其测量结果。

- [2026-10-03-project-review.md](2026-10-03-project-review.md)
- [2026-10-03-responsibility-benchmark.md](2026-10-03-responsibility-benchmark.md)
- [2026-10-04-import-root-cause-review.md](2026-10-04-import-root-cause-review.md)
- [2026-10-04-page-feedback-scope.md](2026-10-04-page-feedback-scope.md)
- [2026-10-04-personal-cloudbase-plan.md](2026-10-04-personal-cloudbase-plan.md)
- [2026-10-04-real-import-reproduction.md](2026-10-04-real-import-reproduction.md)
- [2026-10-05-account-onboarding-progress.md](2026-10-05-account-onboarding-progress.md)
- [2026-10-05-cloud-resources-and-capture-plan.md](2026-10-05-cloud-resources-and-capture-plan.md)
- [2026-10-05-cloudbase-progress.md](2026-10-05-cloudbase-progress.md)
- [2026-10-05-deployment-progress.md](2026-10-05-deployment-progress.md)
- [2026-10-05-import-fixes-progress.md](2026-10-05-import-fixes-progress.md)
- [2026-10-05-maintenance-baseline.md](2026-10-05-maintenance-baseline.md)
- [2026-10-05-mobile-feedback-plan.md](2026-10-05-mobile-feedback-plan.md)
- [2026-10-05-ocr-resource-progress.md](2026-10-05-ocr-resource-progress.md)
- [2026-10-05-period-progress.md](2026-10-05-period-progress.md)
- [accounting-rules.md](accounting-rules.md)
- [decisions.md](decisions.md)
- [development-preview.md](development-preview.md)
- [import-v0.8.md](import-v0.8.md)
- [import-v0.9.md](import-v0.9.md)
- [lifecycle-v0.3.md](lifecycle-v0.3.md)
- [live-validation-record.md](live-validation-record.md)
- [m4-v2-architecture-freeze.md](m4-v2-architecture-freeze.md)
- [m5-1-account-attention-progress.md](m5-1-account-attention-progress.md)
- [m5-1-attention-progress.md](m5-1-attention-progress.md)
- [m5-1-lifecycle-fixes-progress.md](m5-1-lifecycle-fixes-progress.md)
- [m5-1-source-review-progress.md](m5-1-source-review-progress.md)
- [m5-2-editing-progress.md](m5-2-editing-progress.md)
- [m5-3-refund-progress.md](m5-3-refund-progress.md)
- [m5-core-flows-plan.md](m5-core-flows-plan.md)
- [m5-preview-progress.md](m5-preview-progress.md)
- [m5-user-task-progress.md](m5-user-task-progress.md)
- [settlement-resolution-v0.5.md](settlement-resolution-v0.5.md)
- [sync-g2-v0.4.md](sync-g2-v0.4.md)
- [web-release-v0.7.md](web-release-v0.7.md)

## 归档与替代

- [原M1–M7叠加计划](archive/m1-m7-execution-plan.md)
- [原职责契约](archive/responsibility-contract.md)
- [原A–G详细计划](archive/2026-10-05-next-development-plan.md)；旧入口现已改为指向唯一计划。
- [早期G0–G2 README](archive/early-core-readme.md)

没有删除旧证据、运行代码、兼容测试或未完成需求；“干净”体现为入口和优先级明确。Issue状态与文档不一致时记录差异，不仅凭静态检查关闭。
