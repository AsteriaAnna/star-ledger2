# K05a整改复测：真实PG子项通过，阶段仍部分通过

记录时间：2026-10-06 20:43（北京时间）。来源：用户转交已连接CloudBase MCP的Codex完整报告；本会话归档和对齐状态，没有独立执行云端复查。对应R03/C02/C05/C06/M5.1-O/F。

## 验收边界

环境xingzhang-dev-d0g4a950c6f1204d1 / ap-shanghai，PostgreSQL 17.11。
源码cf2492dfd90383fbc2962ffbfcb95b4fc5f25bde，分支feature/capture-foundation-20261005。真实executePGSql注入当前CapturePostgresRepository和RemoteCaptureService；queue/cancel没有用手写SQL代替。

报告结论：功能9/9、有效权限48/48通过。**PG存储子项真实可用，K05a阶段仍按用户要求标部分通过**；不表示图片→模型→导入闭环、K05或页面完成。不推进真实图片调用。

## 迁移、权限与请求证据

仅应用004-capture-service-role-privileges.sql，单条DO/admin角色：RequestId `7ac052c7-6614-4dfe-bdfd-55151a72f6d6`，AffectedRows=0，ExecutionTimeMs=9。迁移DDL计数0不是失败，不使用仓库DML的0/1判据套用迁移。

运行capture-privilege-audit.sql：RequestId `d585ba0e-ec8e-41e7-a27b-7b91f490fb18`；48项actual/expected一致，不一致0。

| 角色/表 | 实际有效权限 |
| --- | --- |
| service_role / task | SELECT、INSERT、UPDATE |
| service_role / result | SELECT、INSERT |
| anon、authenticated / 两表 | 8项权限全部无权限 |

service_role对result的UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN，以及task的DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN均无权限。

超额授权源为pg_default_acl类型r：cloudbase_admin_postgres_45ay1vm6和cloudbase_postgres_postgres_45ay1vm6预置三角色关系全权限，003建表时自动套用。最新报告明确anon/authenticated/service_role均无父角色成员关系，故004撤销后没有继承残留；该结论更新首轮报告中不完整的成员关系描述。

全局default ACL未改、仍存在。以后每次建新表都必须明确REVOKE现有授权再GRANT所需项，并复读有效权限；不能以新增GRANT推断旧权限已消失。现有注册/其他表不因本项整改改权。

## 功能结果（报告最终9/9）

| 项 | 最终实测结果 |
| --- | --- |
| queue与幂等 | 首次成功，同ID/同图返回同任务，异图拒绝CAPTURE_TASK_ID_COLLISION |
| 未命中与隔离 | 不存在/跨用户/跨账本get/result/read返回null，不再报返回形状错误 |
| 并发CAS | 同版本两repo.replace并发严格一true一false |
| 取消与迟到 | service.cancel真实落库v4 CANCELLED，旧worker被CAPTURE_VERSION_CONFLICT拒绝 |
| publish落败 | 返回false，结果0行 |
| publish成功 | READY与完整证据共同可读，单SQL/CTE |
| 注入失败 | task/result整体回滚，仍ANALYZING v3、结果0行 |
| 客户端访问 | anon/authenticated的SELECT/INSERT/UPDATE/DELETE全部拒绝 |

合法DML形状为Columns:null、Rows:null、AffectedRows:0或1；SELECT返回payload列和行数组，空集Rows:null已归一。首轮Test E因验收脚本FAIL迁移漏token误报STALE_CAPTURE_WORKER，补token后最终重跑通过，属于脚本问题，不新增仓库缺陷。

## 清理与未改动

synthetic-k05a-probe前缀task/result都归零，注入触发器/函数均0。清理使用管理角色先result后task，没有为service_role增权。注册/同步/认证/正式Handler/托管未修改；截图函数未部署，没有真实用户/真实图/模型调用。

## 当前停止点

本轮只归档证据、更新计划与接手文档，无产品代码修改、无新增测试执行或云端动作。原“等待PG整改复测”门槛已得到上述报告满足，不应在下个对话重复修复Bug A/B或重新跑同一轮验收。

阶段仍部分通过。图片私密上传、服务端凭证/预算、worker与超时、可靠领取回执、TTL清理、页面及真机仍未完成。后续可讨论K05b设计与非真实图片验证；保持本轮“不推进真实图片调用”的停止点。
