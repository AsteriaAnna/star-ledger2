# 星账开发入口

本页只提供目录与命令。工作规则见根目录 [AGENTS.md](../AGENTS.md)，任务状态按需查 [当前工作](docs/current.md)。

网页是当前主要客户端。本地账本存于 IndexedDB；Node/SQLite 用于核心存储验证，Tauri 原生目录是探针。手机截图与电脑文件导入应进入共同账务语义，但多图、真实截图、退款与跨来源去重尚待实测和完善。CloudBase 是目标网站、认证及数据服务；当前真实 PostgreSQL 注册测试不能证明网页注册、同步或新设备恢复已可用。

## 命令

需要 Node.js 24 或以上。在本目录：

~~~sh
npm ci
npm run dev:web
npm test
npm run typecheck
npm run typecheck:web
npm run check:platform
npm run build:web
npm run test:web:imports
~~~

按改动选择验证。test:web:imports 是当前导入浏览器脚本；test:web 是旧交互脚本，不能直接证明现有导入体验。离线 OCR 合成图测试不能代替真实支付截图。浏览器、云端、双设备及真机证据分别记录。生成的 web-dist 不提交。

## 目录

| 路径 | 职责 |
| --- | --- |
| packages/domain、accounting | 事件、金额、资金和消费不变量 |
| packages/application、importing | 用户任务、来源、去重和输入编排 |
| packages/analytics | 余额、消费与期间查询 |
| packages/storage、sync、platform | 本地保存、同步、加密及平台边界 |
| apps/web | 页面、截图/文件适配与 IndexedDB |
| cloudbase | 云函数、SQL 迁移与权限 |
| tests、scripts | 规则回归、浏览器与构建 |
| apps/native-probe、apps/windows、apps/android | 探针和未来平台入口 |
| docs | 当前入口及带日期的历史证据 |

旧分支及其历史说明不能代表 main。CloudBase 部署需核对实际环境；现存 GitHub Pages 工作流不是 CloudBase 发布入口。
