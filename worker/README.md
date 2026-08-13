# Cloudflare Worker 管理 API

Worker 负责 GitHub OAuth 和管理台文章发布。GitHub OAuth token 只保存在 Worker KV，会话通过 HttpOnly Cookie 传递给本站管理台。

## OAuth 配置

GitHub Developer Settings → OAuth Apps：

1. Homepage URL：`https://ice11123.github.io/blog_test1/`
2. Authorization callback URL：`https://YOUR_WORKER_DOMAIN/auth/callback`

## 部署

在 `worker/` 目录执行：

```powershell
npx wrangler login
npx wrangler secret put GITHUB_OAUTH_CLIENT_ID
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler deploy
```

不要把 OAuth Secret、Session Secret、GitHub Token 写入仓库。

## 运行约束

- 仅允许 Origin `https://ice11123.github.io`。
- 仅允许 GitHub 用户 `ice11123`。
- 仅写入 `ice11123/blog_test1/main`。
- `/api/sync` 需要 HttpOnly Cookie 和 `X-CSRF-Token`。
- OAuth 回调固定到 `/blog_test1/admin/`，不接受任意 `returnTo`，不会把 session token 放进 URL。

## Pages 配置

在仓库 Actions Variables 中配置：

```text
PUBLIC_ADMIN_SYNC_API_URL=https://YOUR_WORKER_DOMAIN
```
