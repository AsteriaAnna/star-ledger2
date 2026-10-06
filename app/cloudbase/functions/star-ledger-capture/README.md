# 识别服务存储适配（K05a，未部署）

当前只有服务端SQL适配 `postgres.cjs`，没有正式 `index.main`、SDK初始化、图片上传接口或TokenHub调用。不可将此目录直接部署成可用识别函数。

与 `packages/application/remote-capture.ts` 配合：调用方从经验证的运行时身份取得UID；用户请求体不能提供UID/owner。SQL执行函数应由CloudBase Manager SDK的executePGSql注入，使用函数调用期间凭据，不从网页取得管理员密钥。运行查询固定Role=service_role；迁移另用管理角色。

执行 `cloudbase/migrations/003-capture-task-and-result.sql` 前先实时检查上海环境、数据库、现有表及service_role属性。它是单条DO块，适配ExecutePGSql单语句限制，不按分号拆开。建两张隔离表，不修改注册或同步表。客户端角色无权限；结果表仅SELECT/INSERT，应用不改写原始提取。

READY状态必须与完整CaptureEvidence一次SQL提交。普通replace保持结果引用不变；新结果只能publish。发布前公共服务检查租约/attempt/到期、内容指纹与提取证据哈希；版本CAS拒绝迟到响应。任务、图片指纹与请求版本不可因重试改成另一个输入。

该仓库故意不实现客户端账本提交：云结果保存与本机账务提交属于不同数据库，不能承诺同一事务。完成本机账务使用已有capture-import流程；后续可靠领取/回执协议单独落实。

2026-10-06 20:43用户转交真实PG并发、权限/回滚复测通过，见docs/2026-10-06-capture-pg-retest-accepted.md。仓库本地测试仍属于服务与SQL契约替身，不应与该云端报告混称。

## 2026-10-06真实验收修正

真实API对普通DML仅提供AffectedRows，不提供RETURNING行；create/replace使用0/1计数。SELECT有payload列而Rows:null是空结果。003后必须再应用004-capture-service-role-privileges.sql，避免建表默认ACL遗留service_role全权限；有效权限用capture-privilege-audit.sql复读。真实整改复测最终功能9/9、有效权限48/48通过；源码与部署边界仍见docs/2026-10-06-capture-pg-retest-accepted.md。


全局建表默认ACL仍会授予三角色额外权限。未来迁移新表必须先显式REVOKE旧授权再GRANT最小权限，并审计有效权限；本轮只修两张识别表，没有修改全局默认ACL。PG子项通过不等于可部署整个识别函数，保持不推进真实图片调用。
