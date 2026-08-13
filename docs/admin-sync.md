# 管理台同步到 GitHub

管理台通过 Cloudflare Worker 完成 GitHub OAuth 和文章提交：

```text
管理台 → GitHub OAuth → Worker HttpOnly Cookie 会话 → GitHub Contents API → main → Pages Actions
```

## 安全边界

- OAuth 回调固定回到 `https://ice11123.github.io/blog_test1/admin/`，不接受外部 `returnTo`。
- GitHub session 只保存在 Worker KV，并通过 `blog_session` HttpOnly Cookie 使用。
- 前端不再保存 bearer session，也不会处理 `admin_token` URL 参数。
- `/auth/me` 返回短期 CSRF token；前端只在当前页面内存保存该 token。
- `/api/sync` 必须带本站 Origin、有效 HttpOnly Cookie 和 `X-CSRF-Token`。
- Worker 只允许 GitHub 用户 `ice11123`，目标仓库为 `ice11123/blog_test1` 的 `main` 分支。

## 部署配置

在 `worker/` 目录执行：

```powershell
npx wrangler login
npx wrangler secret put GITHUB_OAUTH_CLIENT_ID
npx wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler deploy
```

GitHub OAuth App 的 callback URL 必须是：

```text
https://YOUR_WORKER_DOMAIN/auth/callback
```

在仓库 Settings → Secrets and variables → Actions → Variables 中配置：

```text
PUBLIC_ADMIN_SYNC_API_URL=https://YOUR_WORKER_DOMAIN
```

修复会使旧的 `blog-test1-cloud-session-v1` 浏览器 token 失效，首次发布需要重新授权。

## 请求接口

前端请求必须使用 `credentials: "include"`。发布请求还必须带：

```http
Origin: https://ice11123.github.io
X-CSRF-Token: <来自 /auth/me 的 csrfToken>
```

请求体为 `{ "post": ... }`，成功响应包含 `commitSha`、`commitUrl` 和规范化后的 `path`。

## 验证

```powershell
curl.exe -i -X OPTIONS "https://YOUR_WORKER_DOMAIN/api/sync" `
  -H "Origin: https://ice11123.github.io" `
  -H "Access-Control-Request-Method: POST" `
  -H "Access-Control-Request-Headers: content-type,x-csrf-token"

curl.exe -i "https://YOUR_WORKER_DOMAIN/auth/me" `
  -H "Origin: https://ice11123.github.io"
```

OPTIONS 应返回 204，并包含精确的 `Access-Control-Allow-Origin`、`Access-Control-Allow-Credentials: true` 和 `X-CSRF-Token`。
