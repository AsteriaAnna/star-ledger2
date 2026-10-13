# 按用户任务定位代码

仅在修改对应行为时读相关行。依据 [Phase 4](../archive/research-20261013/phase4-engineering-handoff.md)；2026-10-13 对照 main@5123b0d，表内十个关键入口文件与审查基线 63ab2e2 的 Git blob 相同。此核对不是重新运行功能验收；后续改动同步维护受影响的行。路径相对 app/，按符号搜索，不依赖压缩文件的行号。

| 用户任务 | 实际入口与调用路径 | 关键边界 |
| --- | --- | --- |
| 手动记账 | apps/web/src/main.ts 的 newRecord / commandFrom → store.business → packages/accounting/business.ts → AccountingService → Web store.mutate/write | 当前未经过独立 application 服务；Web 保存为 IndexedDB，不是另一套 SQLite 实现 |
| 文件导入 | main.ts importFile、importer.ts → import-v2-flow.ts → packages/application/import-service.ts / 提交规划器 → executeBatch → 保存 | 账务与处理结果的提交完整；准备阶段快照另存 |
| 截图 | main.ts capture → ocr.ts / importer.ts parseScreenshot → captured-record.ts saveCapturedRecord → mutate | 草稿、来源证据、正式账务分开；重复/版本检查后，账务与完成状态一起保存 |
| 编辑、删除、恢复 | main.ts 详情/回收站 → detail-editor.ts / detail-edit.ts → application 编辑或 transaction-lifecycle.ts 规划器 → mutate | 不仅改金额或 deleted_at；维护资金、消费和关联退款，保护过期提交 |
| 同步与恢复 | main.ts → cloud-sync.ts → Web store.synchronizeEncrypted → PortableSyncEngine / 投影 → IndexedDB 与 CloudBase provider | 模拟 GitHub/SQLite 测试不能证明真实 CloudBase；不直接覆盖 ops、清空 pending 或静默挑冲突赢家 |
| 统计 | main.ts analysis / total / categoryData / balance → analytics 或页面聚合 | 余额与消费各有来源；不能改一处就声称全站统一；统计结果不另存为账务事实 |

## 按改动保护

- 账务：安全整数分；完整 command_id/index/size 原子保存；SUCCESS/PENDING/FAILED 的资金与消费效果经业务命令改变。
- 亲情卡/他人代付计本人消费但不扣本人账户；负债与资产符号不同；内部转账、还款本金不重复计消费；提现费与本金分开。
- 分摊合计等于总额；退款不超可退额度；删除恢复维护关联；来源原文不被编辑覆盖；余额由基准和有效资金变化计算。
- AccountingService 是提交基础，不是完整业务校验器；规划器会使用它。financialIssues 无报错不等于所有规则被覆盖。
- main.ts / store.ts 多函数压在长行，先定位完整符号与调用者，避免盲目字符串替换。按当前任务做必要的小范围整理，不先拆全仓。

验证入口按 [开发命令](../../README.md) 选择；浏览器测试须对应本次构建。代码、浏览器、真实样例、云端、真机证据分开。
