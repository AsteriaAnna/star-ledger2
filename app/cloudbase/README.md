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

不要加 prune。部署前确认该环境静态托管已开启且没有其他应保留的站点；认证添加实际站点域名。静态构建包含同源 OCR worker、内核和中英文字库（部署总量约 33 MiB），首次识别只下载当前设备所需资源并缓存；网站首次打开不会预下载全部字库。资源准备后断网重开识别已通过本地浏览器验证。CloudBase 托管、国内无 VPN 和真机尚未验收，P15 未达标。

## 必须真实验收

用户名密码登录；未登录及 A 请求 B 命名空间拒绝；本机保存后同步；另一设备登录同账户恢复消费/退款/预算/别名；离线记账后联网不重记；新账本备份恢复、换设备及密码重置后解锁。真实验收前只标记本地实现和协议测试通过。
