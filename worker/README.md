# Cloudflare Workers 管理 API

此 Worker 负责 GitHub 登录和文章发布。它是必要的安全边界：GitHub OAuth Token 只保存在 Worker KV 会话中，不进入 Astro 前端。

## 部署前准备

1. 在 GitHub Developer Settings 创建 OAuth App。
2. Homepage URL 填写 `https://ice11123.github.io/blog_test1/`。
3. Authorization callback URL 填写 `https://YOUR_WORKER_DOMAIN/auth/callback`。
4. 在 Cloudflare 创建 KV Namespace，并将 ID 填入 `wrangler.toml`。
5. 修改 `wrangler.toml` 中的 `YOUR_KV_NAMESPACE_ID_HERE` 和 Worker 名称。

## 部署

在 `worker/` 目录执行：

```powershell
npx wrangler login
npx wrangler secret put GITHUB_OAUTH_CLIENT_ID
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler deploy
```

`SESSION_SECRET` 应使用随机长字符串。不要把 OAuth Secret、Session Secret 或 GitHub Token 写入仓库。

## 连接 Astro 前端

将 Worker 部署地址设置为 GitHub Pages 构建变量：

```text
PUBLIC_ADMIN_SYNC_API_URL=https://YOUR_WORKER_DOMAIN
```

由于该变量以 `PUBLIC_` 开头，它只能是公开的 Worker 地址，不能填写任何 Secret。

## 权限说明

Worker 只接受 GitHub 用户名 `ice11123`，只写入 `ice11123/blog_test1` 的 `main` 分支。GitHub OAuth 的 `repo` scope 仍属于较大权限；正式使用时建议改为 GitHub App，只给目标仓库 Contents 写权限。
