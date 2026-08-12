# 管理台同步到 GitHub 的接口约定

管理台目前默认只把草稿保存到浏览器 `localStorage`。只有配置 `PUBLIC_ADMIN_SYNC_API_URL` 后，“同步到正式网站”按钮才会启用。

## 为什么需要独立后端

Astro 输出的是公开静态文件，浏览器代码中的任何 GitHub Token 都能被访问者读取。因此不能让管理台直接调用 GitHub API。推荐使用 Cloudflare Workers（或同等服务）作为后端，并把 GitHub App 私钥放入服务端 Secret。

后端至少应完成以下校验：

- 通过 GitHub OAuth 或自己的登录机制确认用户身份；
- 只允许 GitHub 用户 `ice11123`；
- 只允许仓库 `ice11123/blog_test1` 和分支 `main`；
- 校验文章字段长度、日期和文件路径，拒绝目录穿越；
- 使用 GitHub App 的最小 `Contents: Read and write` 权限提交文件；
- 不把 Token、私钥或明文密码返回给前端。

## 请求

```http
POST YOUR_ADMIN_SYNC_API_URL
Content-Type: application/json
```

```json
{
  "repository": "ice11123/blog_test1",
  "branch": "main",
  "post": {
    "id": "开始/欢迎使用.mdx",
    "title": "欢迎使用",
    "description": "文章描述",
    "pubDate": "2026-08-12",
    "updatedDate": "2026-08-12",
    "dir1": "开始",
    "dir2": "",
    "tags": ["演示"],
    "body": "# 正文",
    "format": "mdx"
  }
}
```

后端应将内容转换为仓库中的 `src/content/blog/<安全路径>.<md|mdx>`，并使用 `draftToMarkdown` 同等规则生成 frontmatter。删除文章应单独设计受保护的 DELETE 接口，不能通过普通文章提交请求实现。

## 成功响应

```json
{
  "ok": true,
  "commitSha": "YOUR_COMMIT_SHA",
  "commitUrl": "https://github.com/ice11123/blog_test1/commit/YOUR_COMMIT_SHA"
}
```

失败时建议返回 `4xx/5xx` 和不包含敏感信息的 `message` 字段。管理台会显示该消息。

## 前端配置

在构建环境中设置：

```env
PUBLIC_ADMIN_SYNC_API_URL=YOUR_DEPLOYED_SYNC_API_URL
```

不要把 GitHub Personal Access Token、GitHub App 私钥或真实服务端密码写入 `.env` 的 `PUBLIC_` 变量，也不要提交到仓库。

