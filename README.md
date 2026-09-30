# 星账 · 个人账本（单人版）

本地优先的个人记账网页应用，同一地址自动适配电脑与手机。支持记账、账户管理、消费分析、截图识别、微信 / 支付宝账单导入核验、备份，以及可选的 GitHub 加密同步。

## 目录

| 路径 | 说明 |
| --- | --- |
| `app/` | 单人版源码（npm workspaces：domain / accounting / storage / sync / analytics / platform，前端在 `app/apps/web/`） |
| `legacy-duo/` | 双人版整包，已退役，仅作页面风格等设计参考，不参与构建 |
| `.github/workflows/deploy.yml` | 构建并部署到 GitHub Pages |

原始微信 / 支付宝账单文件在仓库外的工作区目录 `../原始账单数据/`，不入库。

## 开发

```sh
cd app
npm ci
npm run dev:web          # 本地开发
npm test                 # 账务 / 同步测试
npm run typecheck:web    # 类型检查
npm run build:web        # 产出 web-dist/（GitHub Actions 会调用）
```

## 发布

推送 `main` 分支后，GitHub Actions 自动构建 `app/` 并把 `web-dist/` 发布到 GitHub Pages 根路径。需在仓库 Settings → Pages 中把 Source 设为 **GitHub Actions**。
