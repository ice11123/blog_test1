import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { adminReturnUrl, decryptSecret, encryptSecret, isAllowedOrigin, safePublishedPath, validatePost } from '../src/index.js';

const env = {
  ALLOWED_ORIGIN: 'https://ice11123.github.io',
  GITHUB_OWNER: 'ice11123',
  GITHUB_REPO: 'blog_test1',
  GITHUB_BRANCH: 'main',
  GITHUB_OAUTH_CLIENT_ID: 'client',
  GITHUB_OAUTH_CLIENT_SECRET: 'secret',
  SESSION_SECRET: 'session-secret',
  SESSIONS: { get: async () => null, put: async () => {} },
};

test('固定 OAuth 回跳地址，不接受外部 returnTo', () => {
  assert.equal(adminReturnUrl(env), 'https://ice11123.github.io/blog_test1/admin/');
});

test('只允许博客 Origin', () => {
  assert.equal(isAllowedOrigin(new Request('https://worker.test', { headers: { Origin: env.ALLOWED_ORIGIN } }), env), true);
  assert.equal(isAllowedOrigin(new Request('https://worker.test', { headers: { Origin: 'https://evil.example' } }), env), false);
});

test('publishedPath 拒绝目录穿越并接受规范文章路径', () => {
  assert.equal(safePublishedPath('src/content/blog/demo/post.mdx'), 'src/content/blog/demo/post.mdx');
  assert.throws(() => safePublishedPath('src/content/blog/../README.md'), /旧文章路径无效/);
  assert.throws(() => safePublishedPath('src/content/blog/demo/../post.md'), /旧文章路径无效/);
});

test('文章日期和格式校验', () => {
  const post = validatePost({ title: '标题', description: '描述', pubDate: '2026-08-12', body: '# 正文', format: 'mdx', tags: [] });
  assert.equal(post.pubDate, '2026-08-12');
  assert.throws(() => validatePost({ title: '标题', description: '描述', pubDate: '2026-02-31', body: '# 正文', format: 'mdx' }), /日期无效/);
  assert.throws(() => validatePost({ title: '标题', description: '描述', pubDate: '2026-08-12', body: '# 正文', format: 'txt' }), /文章格式无效/);
  assert.throws(() => validatePost({ title: '', description: '描述', pubDate: '2026-08-12', body: '# 正文', format: 'mdx' }), /字段无效/);
  assert.throws(() => validatePost({ title: '标题', description: '描述', pubDate: '2026-08-12', body: '# 正文', format: 'mdx', tags: [1] }), /标签数据无效/);
});

test('OAuth token 加密后可以恢复且不会明文存储', async () => {
  const encrypted = await encryptSecret('github-token', env.SESSION_SECRET);
  assert.doesNotMatch(encrypted, /github-token/);
  assert.equal(await decryptSecret(encrypted, env.SESSION_SECRET), 'github-token');
  await assert.rejects(() => decryptSecret(encrypted, 'wrong-secret'), /会话已失效/);
});

test('未登录 auth/me 返回 401 且不泄露会话', async () => {
  const response = await worker.fetch(new Request('https://worker.test/auth/me', { headers: { Origin: env.ALLOWED_ORIGIN } }), env);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).ok, false);
});

test('health 检查 Worker 与 KV 且不返回敏感配置', async () => {
  const response = await worker.fetch(new Request('https://worker.test/health', { headers: { Origin: env.ALLOWED_ORIGIN } }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.match(body.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(JSON.stringify(body), /secret|token|client/i);
});

test('health 拒绝非法 Origin，KV 不可用时返回安全的 503', async () => {
  const forbidden = await worker.fetch(new Request('https://worker.test/health', { headers: { Origin: 'https://evil.example' } }), env);
  assert.equal(forbidden.status, 403);
  const broken = await worker.fetch(new Request('https://worker.test/health', { headers: { Origin: env.ALLOWED_ORIGIN } }), { ...env, SESSIONS: null });
  assert.equal(broken.status, 503);
  assert.deepEqual(Object.keys(await broken.json()).sort(), ['checkedAt', 'ok']);
});

test('api/status 未登录返回 401', async () => {
  const response = await worker.fetch(new Request('https://worker.test/api/status', { headers: { Origin: env.ALLOWED_ORIGIN } }), env);
  assert.equal(response.status, 401);
});

test('api/status 返回仓库 HEAD 与最近部署且不泄露 token', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/git/ref/heads/main')) return Response.json({ object: { sha: '0123456789abcdef' } });
    if (target.includes('/actions/workflows/deploy.yml/runs')) return Response.json({ workflow_runs: [{ status: 'completed', conclusion: 'success', updated_at: '2026-08-13T10:00:00Z', html_url: 'https://github.com/ice11123/blog_test1/actions/runs/1' }] });
    return new Response('not found', { status: 404 });
  };
  try {
    const tokenCipher = await encryptSecret('github-token', env.SESSION_SECRET);
    const sessionEnv = { ...env, SESSIONS: { get: async () => JSON.stringify({ tokenCipher, login: env.GITHUB_OWNER, csrfToken: 'csrf-ok' }), put: async () => {} } };
    const response = await worker.fetch(new Request('https://worker.test/api/status', { headers: { Origin: env.ALLOWED_ORIGIN, Cookie: 'blog_session=session-id' } }), sessionEnv);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.login, 'ice11123');
    assert.equal(body.repository.headSha, '0123456789abcdef');
    assert.equal(body.deployment.status, 'success');
    assert.doesNotMatch(JSON.stringify(body), /github-token|tokenCipher|csrf-ok/);
  } finally { globalThis.fetch = originalFetch; }
});

test('api/status 将进行中的部署归类为 pending', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('/git/ref/heads/main')) return Response.json({ object: { sha: 'head-sha' } });
    if (target.includes('/actions/workflows/deploy.yml/runs')) return Response.json({ workflow_runs: [{ status: 'in_progress', conclusion: null, updated_at: '2026-08-13T10:00:00Z', html_url: 'https://github.com/run' }] });
    return new Response('not found', { status: 404 });
  };
  try {
    const tokenCipher = await encryptSecret('github-token', env.SESSION_SECRET);
    const sessionEnv = { ...env, SESSIONS: { get: async () => JSON.stringify({ tokenCipher, login: env.GITHUB_OWNER, csrfToken: 'csrf-ok' }), put: async () => {} } };
    const response = await worker.fetch(new Request('https://worker.test/api/status', { headers: { Origin: env.ALLOWED_ORIGIN, Cookie: 'blog_session=session-id' } }), sessionEnv);
    assert.equal((await response.json()).deployment.status, 'pending');
  } finally { globalThis.fetch = originalFetch; }
});

test('api/status 仓库失败时仍返回可展示的安全状态', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('upstream failed', { status: 500 });
  try {
    const tokenCipher = await encryptSecret('github-token', env.SESSION_SECRET);
    const sessionEnv = { ...env, SESSIONS: { get: async () => JSON.stringify({ tokenCipher, login: env.GITHUB_OWNER, csrfToken: 'csrf-ok' }), put: async () => {} } };
    const response = await worker.fetch(new Request('https://worker.test/api/status', { headers: { Origin: env.ALLOWED_ORIGIN, Cookie: 'blog_session=session-id' } }), sessionEnv);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.repository.ok, false);
    assert.equal(body.repository.headSha, null);
    assert.equal(body.deployment.status, 'failure');
    assert.doesNotMatch(JSON.stringify(body), /upstream failed|github-token/);
  } finally { globalThis.fetch = originalFetch; }
});

test('错误 Origin 的预检请求被拒绝', async () => {
  const response = await worker.fetch(new Request('https://worker.test/api/sync', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }), env);
  assert.equal(response.status, 403);
});

test('允许的预检请求返回精确 CORS 和 CSRF 头', async () => {
  const response = await worker.fetch(new Request('https://worker.test/api/sync', {
    method: 'OPTIONS',
    headers: {
      Origin: env.ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-csrf-token',
    },
  }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN);
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.match(response.headers.get('Access-Control-Allow-Headers') || '', /X-CSRF-Token/i);
});

test('同步接口缺少 Cookie 返回 401，错误 CSRF 返回 403', async () => {
  const session = { tokenCipher: await encryptSecret('github-token', env.SESSION_SECRET), login: env.GITHUB_OWNER, csrfToken: 'csrf-ok' };
  const sessionEnv = { ...env, SESSIONS: { get: async (key) => key === 'session:v3:session-id' ? JSON.stringify(session) : null, put: async () => {} } };
  const baseHeaders = { Origin: env.ALLOWED_ORIGIN, 'Content-Type': 'application/json' };
  const missingCookie = await worker.fetch(new Request('https://worker.test/api/sync', { method: 'POST', headers: baseHeaders, body: '{}' }), sessionEnv);
  assert.equal(missingCookie.status, 401);
  const badCsrf = await worker.fetch(new Request('https://worker.test/api/sync', { method: 'POST', headers: { ...baseHeaders, Cookie: 'blog_session=session-id', 'X-CSRF-Token': 'wrong' }, body: '{}' }), sessionEnv);
  assert.equal(badCsrf.status, 403);
});

test('分块或无 Content-Length 的超大请求被拒绝，malformed JSON 返回 400', async () => {
  const tooLarge = new Request('https://worker.test/api/sync', {
    method: 'POST',
    headers: { Origin: env.ALLOWED_ORIGIN, Cookie: 'blog_session=session-id', 'X-CSRF-Token': 'csrf-ok' },
    body: JSON.stringify({ post: { body: 'x'.repeat(300_001) } }),
  });
  const session = { tokenCipher: await encryptSecret('github-token', env.SESSION_SECRET), login: env.GITHUB_OWNER, csrfToken: 'csrf-ok' };
  const sessionEnv = { ...env, SESSIONS: { get: async (key) => key === 'session:v3:session-id' ? JSON.stringify(session) : null, put: async () => {} } };
  const largeResponse = await worker.fetch(tooLarge, sessionEnv);
  assert.equal(largeResponse.status, 413);
  const malformed = new Request('https://worker.test/api/sync', {
    method: 'POST',
    headers: { Origin: env.ALLOWED_ORIGIN, Cookie: 'blog_session=session-id', 'X-CSRF-Token': 'csrf-ok', 'Content-Type': 'application/json' },
    body: '{',
  });
  const malformedResponse = await worker.fetch(malformed, sessionEnv);
  assert.equal(malformedResponse.status, 400);
});

test('旧 session 前缀不会被读取', async () => {
  const legacyEnv = { ...env, SESSIONS: { get: async (key) => key === 'session:v2:legacy-id' ? JSON.stringify({ login: env.GITHUB_OWNER, csrfToken: 'csrf', tokenCipher: 'legacy' }) : null, put: async () => {} } };
  const response = await worker.fetch(new Request('https://worker.test/auth/me', { headers: { Origin: env.ALLOWED_ORIGIN, Cookie: 'blog_session=legacy-id' } }), legacyEnv);
  assert.equal(response.status, 401);
});

test('目标路径冲突返回 409 且不会创建 Git blob', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/git/ref/heads/main')) return Response.json({ object: { sha: 'head-sha' } });
    if (String(url).includes('/contents/src/content/blog/new/post.mdx')) return new Response(JSON.stringify({ sha: 'occupied' }), { status: 200 });
    return new Response('not found', { status: 404 });
  };
  try {
    const tokenCipher = await encryptSecret('github-token', env.SESSION_SECRET);
    const sessionEnv = { ...env, SESSIONS: { get: async () => JSON.stringify({ tokenCipher, login: env.GITHUB_OWNER, csrfToken: 'csrf-ok' }), put: async () => {} } };
    const post = { id: 'post', title: '标题', description: '描述', pubDate: '2026-08-12', body: '# 正文', format: 'mdx', dir1: 'new', dir2: '', tags: [], publishedPath: 'src/content/blog/old/post.mdx' };
    const response = await worker.fetch(new Request('https://worker.test/api/sync', { method: 'POST', headers: { Origin: env.ALLOWED_ORIGIN, Cookie: 'blog_session=session-id', 'X-CSRF-Token': 'csrf-ok', 'Content-Type': 'application/json' }, body: JSON.stringify({ post }) }), sessionEnv);
    assert.equal(response.status, 409);
    assert.equal(calls.some(call => call.url.includes('/git/blobs')), false);
    assert.equal(new URL(calls.find(call => call.url.includes('/contents/')).url).searchParams.get('ref'), 'head-sha');
  } finally { globalThis.fetch = originalFetch; }
});

test('文章改名通过一次 ref PATCH 原子提交', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (target.includes('/contents/src/content/blog/new/post.mdx')) return new Response('not found', { status: 404 });
    if (target.includes('/contents/src/content/blog/old/post.mdx')) return Response.json({ sha: 'old-file' });
    if (target.includes('/git/ref/heads/main')) return Response.json({ object: { sha: 'head-sha' } });
    if (target.includes('/git/commits/head-sha')) return Response.json({ tree: { sha: 'base-tree' } });
    if (target.endsWith('/git/blobs')) return Response.json({ sha: 'blob-sha' });
    if (target.endsWith('/git/trees')) return Response.json({ sha: 'tree-sha' });
    if (target.endsWith('/git/commits')) return Response.json({ sha: 'commit-sha' });
    if (target.includes('/git/refs/heads/main')) return Response.json({ object: { sha: 'commit-sha' } });
    return new Response('not found', { status: 404 });
  };
  try {
    const tokenCipher = await encryptSecret('github-token', env.SESSION_SECRET);
    const sessionEnv = { ...env, SESSIONS: { get: async () => JSON.stringify({ tokenCipher, login: env.GITHUB_OWNER, csrfToken: 'csrf-ok' }), put: async () => {} } };
    const post = { id: 'post', title: '标题', description: '描述', pubDate: '2026-08-12', body: '# 正文', format: 'mdx', dir1: 'new', dir2: '', tags: [], publishedPath: 'src/content/blog/old/post.mdx' };
    const response = await worker.fetch(new Request('https://worker.test/api/sync', { method: 'POST', headers: { Origin: env.ALLOWED_ORIGIN, Cookie: 'blog_session=session-id', 'X-CSRF-Token': 'csrf-ok', 'Content-Type': 'application/json' }, body: JSON.stringify({ post }) }), sessionEnv);
    assert.equal(response.status, 200);
    const treeCall = calls.find(call => call.url.endsWith('/git/trees'));
    assert.deepEqual(treeCall.body.tree.map(item => [item.path, item.sha]), [['src/content/blog/new/post.mdx', 'blob-sha'], ['src/content/blog/old/post.mdx', null]]);
    assert.equal(calls.filter(call => call.method === 'PATCH' && call.url.includes('/git/refs/heads/main')).length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('正式文章删除通过一次 ref PATCH 原子提交', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (target.includes('/contents/src/content/blog/demo/post.mdx')) return Response.json({ sha: 'file-sha' });
    if (target.includes('/git/ref/heads/main')) return Response.json({ object: { sha: 'head-sha' } });
    if (target.includes('/git/commits/head-sha')) return Response.json({ tree: { sha: 'base-tree' } });
    if (target.endsWith('/git/trees')) return Response.json({ sha: 'tree-sha' });
    if (target.endsWith('/git/commits')) return Response.json({ sha: 'commit-sha' });
    if (target.includes('/git/refs/heads/main')) return Response.json({ object: { sha: 'commit-sha' } });
    return new Response('not found', { status: 404 });
  };
  try {
    const tokenCipher = await encryptSecret('github-token', env.SESSION_SECRET);
    const sessionEnv = { ...env, SESSIONS: { get: async () => JSON.stringify({ tokenCipher, login: env.GITHUB_OWNER, csrfToken: 'csrf-ok' }), put: async () => {} } };
    const response = await worker.fetch(new Request('https://worker.test/api/delete', { method: 'POST', headers: { Origin: env.ALLOWED_ORIGIN, Cookie: 'blog_session=session-id', 'X-CSRF-Token': 'csrf-ok', 'Content-Type': 'application/json' }, body: JSON.stringify({ publishedPath: 'src/content/blog/demo/post.mdx', title: '标题' }) }), sessionEnv);
    assert.equal(response.status, 200);
    const treeCall = calls.find(call => call.url.endsWith('/git/trees'));
    assert.deepEqual(treeCall.body.tree, [{ path: 'src/content/blog/demo/post.mdx', mode: '100644', type: 'blob', sha: null }]);
    assert.equal(calls.filter(call => call.method === 'PATCH' && call.url.includes('/git/refs/heads/main')).length, 1);
  } finally { globalThis.fetch = originalFetch; }
});
