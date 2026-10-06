# 单图识别服务（S1，待部署验收）

已补index.main运行入口、可信UID/试用名单、私密请求图片、TokenHub官方API及PG任务/完整证据保存。先在app执行npm run build:capture生成shared.cjs，再部署整个本目录；直接上传未构建源码缺少依赖。SDK依赖使用package-lock锁定。

部署、Key/名单、超时、网页发布与真实手机验收见[交接](../../../docs/2026-10-06-s1-capture-web-implementation.md)。当前没有部署/实际模型调用，不能宣称服务可用；PG原子性/返回值/权限保持既有验收边界。

运行SQL固定service_role，UID从CloudBase运行时获取，不接受客户端owner/ledgerId。只允许CAPTURE_ALLOWED_UIDS中的现有测试身份，缺配置默认拒绝。TokenHub Key只存服务端。图片最大4MB，仅请求/内存临时传输，没有公开图片URL或云图库。当前一次函数调用内完成识别，租约到期可显式重试，不是独立持久worker调度。

普通DML以AffectedRows判成功，空SELECT的Rows:null归一为空。003/004已在用户转交的真实PG报告中验收，不因S1重复迁移。全局默认ACL仍有历史过宽风险，未来新表须显式REVOKE后最小GRANT与有效权限审计。

云结果与本机账本不跨库事务；Web原子保存正式账务/来源/导入结果/本机回执，云端仍保存READY结果供幂等重取。取消/版本竞争拒绝迟到发布。注册、同步和既有正式函数不在本目录部署范围。
