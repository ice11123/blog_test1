# 现状与排查结论

- 当前提交为 `8d95aba`，工作区初始干净。
- 管理台 `src/scripts/admin-dashboard.ts` 使用 `marked`，会把公式、Mermaid 和所有大写 MDX 组件替换成占位文字；这是实时预览错误的根因。
- 正式站点使用 `remark-math`、`rehype-katex`、`remarkMermaid`、GitHub alerts 和 expressive-code。
- 正式 Mermaid 脚本只扫描全局 `pre.mermaid`，管理台预览需要独立的作用域渲染入口。
- Plot3D 使用 Plotly 和表达式执行，管理台预览不能复用正式组件，应显示安全适配卡。
- 首页当前最大宽度为 900px，模块是顺序纵向排列。
- 用户已确认采用三组语义配对：欢迎+统计/月份图，仓库语言/GitHub语言，贡献墙/近期文章。
- 用户要求后续维护过程持续写入博客仓库；本任务使用 planning-with-files 的 `task_plan.md`、`findings.md`、`progress.md`。
- 浏览器实际检查：KaTeX 已生成，Mermaid 已生成 SVG，Plot3D/Spoiler 安全适配存在，目录与编辑列/预览列高度一致。
- 实际检查发现代码块只剩 `}`；根因是去除 MDX import/export 的正则跨行吞掉了代码块中的 `export function`，必须改为只移除文档开头的 import/export 前缀。
- 首页首次实测在 1280px 下仍受左右博客侧栏挤压，中心仅约 741px、双栏单列约 326px；仅改 `.home-page` 最大宽度无法生效。决定为首页增加 `fullWidth` 布局，隐藏首页侧栏，文章页三栏保持不变。
