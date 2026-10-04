# 星账个人版 CloudBase 部署

环境：xingzhang-dev-d0g4a950c6f1204d1，上海 ap-shanghai。管理授权使用 CloudBase CLI 设备码登录；不要把管理员凭据放进前端或 Git。

## 云函数

在本目录执行：

```sh
npx --package=@cloudbase/cli@3.8.5 tcb login --flow device
npx --package=@cloudbase/cli@3.8.5 tcb functions:deploy star-ledger-sync --runtime Nodejs20.19 --install-dependency true
```

部署前在该环境创建传统文档数据库集合 `star_ledger_private`，应用 `database.rules.json`（客户端直接读写均禁止）。函数须为事件函数，经 SDK 调用；不要创建公开 HTTP 写入口。核查登录用户函数调用权限，拒绝匿名；服务端使用实际运行环境 uid 生成命名空间。

云函数依赖使用 Node 入口的 @cloudbase/js-sdk 3.10.1，锁文件在函数目录。函数存储 opaque 密文和索引元数据，初始密钥包不可覆盖。

## 网站

从 app 目录 `npm ci && npm run build:web`，然后本目录：

```sh
npx --package=@cloudbase/cli@3.8.5 tcb hosting:deploy ../web-dist / --env-id xingzhang-dev-d0g4a950c6f1204d1 --verify
```

不要加 prune。部署前确认该环境静态托管已开启且没有其他应保留的站点；认证添加实际站点域名。静态构建目前不包含本地 OCR 字库/内核，P15 未达标，不承诺无 VPN。

## 必须真实验收

用户名密码登录；未登录及 A 请求 B 命名空间拒绝；本机保存后同步；另一设备登录同账户恢复消费/退款/预算/别名；离线记账后联网不重记；备份/旧 GitHub 只读迁移后新云恢复。真实验收前只标记本地实现和协议测试通过。
