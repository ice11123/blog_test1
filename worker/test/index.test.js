import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { adminReturnUrl, isAllowedOrigin, safePublishedPath, validatePost } from '../src/index.js';

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
});

test('未登录 auth/me 返回 401 且不泄露会话', async () => {
  const response = await worker.fetch(new Request('https://worker.test/auth/me', { headers: { Origin: env.ALLOWED_ORIGIN } }), env);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).ok, false);
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
  const session = { token: 'github-token', login: env.GITHUB_OWNER, csrfToken: 'csrf-ok' };
  const sessionEnv = { ...env, SESSIONS: { get: async (key) => key === 'session:v2:session-id' ? JSON.stringify(session) : null, put: async () => {} } };
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
  const session = { token: 'github-token', login: env.GITHUB_OWNER, csrfToken: 'csrf-ok' };
  const sessionEnv = { ...env, SESSIONS: { get: async (key) => key === 'session:v2:session-id' ? JSON.stringify(session) : null, put: async () => {} } };
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
  const legacyEnv = { ...env, SESSIONS: { get: async (key) => key === 'session:legacy-id' ? JSON.stringify({ login: env.GITHUB_OWNER, csrfToken: 'csrf' }) : null, put: async () => {} } };
  const response = await worker.fetch(new Request('https://worker.test/auth/me', { headers: { Origin: env.ALLOWED_ORIGIN, Cookie: 'blog_session=legacy-id' } }), legacyEnv);
  assert.equal(response.status, 401);
});
