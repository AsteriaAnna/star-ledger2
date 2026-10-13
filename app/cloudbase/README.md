# CloudBase 状态与操作边界

本页记录云端技术线索，使用前核对实际配置与当前代码。工作安排见 [当前工作](../docs/current.md)，旧阶段暂停指令不再生效。

环境xingzhang-dev-d0g4a950c6f1204d1，上海ap-shanghai，实际只有PostgreSQL。GitHub只管理源码。

## 注册

产品代码在feature/account-onboarding / 2d25e15 / 草稿PR #17，main没有注册实现。PostgreSQL注册表与两份迁移已记录落库；正式函数直接受邀注册、重复拒绝及真实密码登录已通过。完整步骤与限制见 [注册说明](README-registration.md)。HTTP注册路由与网页端未完成，不用当前旧网页证明注册闭环。

## 同步尚未可部署为有效服务

star-ledger-sync源码仍使用js-sdk文档集合star_ledger_private，而该环境没有文档实例。旧“先创建集合/应用database.rules.json”的步骤已撤出本说明；需要适配PG并真实验收，不安装pg_doc、不创建另一环境。保留旧代码与规则文件作为待改实现，不表示当前可部署。

cloudbaserc.json同步timeout=30是旧模板，实际体验版记录上限3秒。模板配置不是云端事实，部署前核对SDK鉴权/真实用户上下文、SQL权限与Handler。密文、索引元数据与密钥包访问边界和更新协议均需设计；不能复制注册表权限就称同步安全。

## 网站与发布

构建命令从app目录执行npm ci与npm run build:web，产物app/web-dist。最近云端为旧个人版，包含同源OCR资源；PR #17网页未部署。不能整包删除根目录；必须保留__auth/与cloud-admin/，index.html直接在根目录。托管或配置变更须对应具体部署任务。

## 真实退出门槛

网页受邀注册/登录/会话、账号隔离、真实云端双设备往返/离线重试/冲突、备份与新设备及密码恢复分别验证。OCR真实截图、Android分享和手机国内网络另行验收，测试数和CloudBase网站能打开不能替代。

历史操作与请求证据保留在docs日期报告；[历史部署清单](../docs/archive/pre-reset-20261013/repository-and-cloud-state.md)列明上次结果和需复查项。管理员凭据、邀请码、密码与恢复密钥不进入仓库或日志。
