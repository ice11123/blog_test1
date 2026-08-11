# 离子怪的博客

基于 Astro 构建的静态个人博客，部署在 GitHub Pages：

<https://ice11123.github.io/blog_test1/>

## 本地开发

环境要求：Node.js 22.12 或更高版本、pnpm 11。

```bash
pnpm install
pnpm run dev
pnpm run check
pnpm run build
pnpm run preview
```

## 添加文章

在 `src/content/blog/` 下创建 Markdown 或 MDX 文件。文件夹会自动成为文章分类：

```md
---
title: '文章标题'
description: '文章摘要'
pubDate: '2026-08-11'
tags: ['标签']
---

正文内容
```

## DIY 入口

- `src/consts.ts`：站点名称、作者、GitHub 用户名和分类排序。
- `src/styles/themes/`：六套主题颜色。
- `src/components/`：布局、博客卡片、搜索和 MDX 组件。
- `src/content/blog/`：文章内容。
- `astro.config.mjs`：域名与 GitHub Pages 子路径。

## 功能

- 文件夹分类、标签和全文模糊搜索
- 三栏响应式布局及可折叠侧栏
- 六套明暗主题
- KaTeX 数学公式、Mermaid 图表和代码高亮
- RSS、Sitemap、robots.txt 和 JSON-LD
- GitHub 数据组件及站点统计
- Plot3D、Bilibili、MiniBrowser、Spoiler、FriendLinks 等 MDX 组件

## 源码来源与授权

本项目基于 [user1-cloud/user1-cloud.github.io](https://github.com/user1-cloud/user1-cloud.github.io) 的源码进行迁移和修改，感谢原作者提供源码并授权公开使用、修改和发布。

原项目的文章、个人资料、联系方式、社交账号、友情链接、图片资源及 Git 历史均未迁移。

本仓库暂未提供面向第三方的开源许可证。除上述原作者授权外，未经许可请勿复制、修改或再发布本仓库代码。
