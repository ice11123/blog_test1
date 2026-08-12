const API = 'https://api.github.com';
const SESSION_TTL = 60 * 60 * 24 * 7;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), env);
    try {
      if (url.pathname === '/auth/github') return githubLogin(url, env);
      if (url.pathname === '/auth/callback') return githubCallback(request, url, env);
      if (url.pathname === '/auth/me') return authMe(request, env);
      if (url.pathname === '/api/sync' && request.method === 'POST') return syncPost(request, env);
      return cors(json({ ok: false, message: 'Not found' }, 404), env);
    } catch (error) {
      return cors(json({ ok: false, message: error instanceof Error ? error.message : 'Server error' }, 500), env);
    }
  },
};

function githubLogin(url, env) {
  requireEnv(env, ['GITHUB_OAUTH_CLIENT_ID', 'SESSION_SECRET']);
  const state = crypto.randomUUID();
  const redirect = url.searchParams.get('returnTo') || env.ALLOWED_ORIGIN + '/blog_test1/admin/';
  const auth = new URL('https://github.com/login/oauth/authorize');
  auth.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID);
  auth.searchParams.set('redirect_uri', new URL('/auth/callback', url).toString());
  auth.searchParams.set('scope', 'repo');
  auth.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: { Location: auth.toString(), 'Set-Cookie': cookie('oauth_state', `${state}.${b64url(redirect)}`, 600) } });
}

async function githubCallback(request, url, env) {
  requireEnv(env, ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', 'SESSION_SECRET']);
  const stateCookie = getCookie(request.headers, 'oauth_state');
  const state = url.searchParams.get('state');
  if (!stateCookie || !state || stateCookie.split('.')[0] !== state) return new Response('Invalid OAuth state', { status: 400 });
  const code = url.searchParams.get('code');
  if (!code) return new Response('Missing OAuth code', { status: 400 });
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: env.GITHUB_OAUTH_CLIENT_ID, client_secret: env.GITHUB_OAUTH_CLIENT_SECRET, code }) });
  const token = (await tokenResponse.json()).access_token;
  if (!token) return new Response('OAuth token exchange failed', { status: 502 });
  const user = await githubFetch('/user', token);
  if (user.login !== env.GITHUB_OWNER) return new Response('该 GitHub 账号没有管理权限', { status: 403 });
  const sessionId = crypto.randomUUID();
  await env.SESSIONS.put(`session:${sessionId}`, JSON.stringify({ token, login: user.login }), { expirationTtl: SESSION_TTL });
  const packed = stateCookie.split('.')[1];
  const returnTo = packed ? atob(packed.replace(/-/g, '+').replace(/_/g, '/')) : env.ALLOWED_ORIGIN + '/blog_test1/admin/';
  return new Response(null, { status: 302, headers: { Location: returnTo, 'Set-Cookie': cookie('blog_session', sessionId, SESSION_TTL, true) } });
}

async function authMe(request, env) {
  const session = await readSession(request, env);
  return cors(json(session ? { ok: true, login: session.login } : { ok: false }, session ? 200 : 401), env);
}

async function syncPost(request, env) {
  const session = await readSession(request, env);
  if (!session || session.login !== env.GITHUB_OWNER) return cors(json({ ok: false, message: '请先使用授权账号登录 GitHub' }, 401), env);
  const payload = await request.json();
  const post = validatePost(payload?.post);
  const ext = post.format === 'md' ? 'md' : 'mdx';
  const parts = [post.dir1, post.dir2].filter(Boolean).map(safeSegment);
  const name = safeSegment(post.id?.split('/').pop()?.replace(/\.(md|mdx)$/i, '') || post.title);
  const filePath = `src/content/blog/${[...parts, `${name}.${ext}`].join('/')}`;
  const content = draftMarkdown(post);
  const existing = await githubFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodeURIComponent(filePath).replaceAll('%2F', '/')}`, session.token, { branch: env.GITHUB_BRANCH });
  const body = { message: `更新文章：${post.title}`, content: toBase64(content), branch: env.GITHUB_BRANCH, ...(existing?.sha ? { sha: existing.sha } : {}) };
  const result = await githubFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodeURIComponent(filePath).replaceAll('%2F', '/')}`, session.token, { method: 'PUT', body });
  return cors(json({ ok: true, commitSha: result.commit?.sha, commitUrl: result.commit?.html_url, path: filePath }), env);
}

async function readSession(request, env) { const id = getCookie(request.headers, 'blog_session'); if (!id) return null; const raw = await env.SESSIONS.get(`session:${id}`); return raw ? JSON.parse(raw) : null; }
async function githubFetch(path, token, options = {}) { const response = await fetch(API + path, { ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'blog-test1-admin-api', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }, body: options.body ? JSON.stringify(options.body) : undefined }); if (response.status === 404) return null; if (!response.ok) throw new Error(`GitHub API failed (${response.status})`); return response.json(); }
function validatePost(post) { if (!post || typeof post !== 'object') throw new Error('文章数据无效'); for (const key of ['title', 'description', 'pubDate', 'body']) if (typeof post[key] !== 'string' || post[key].length > 200000) throw new Error(`字段无效：${key}`); if (!['md', 'mdx'].includes(post.format)) throw new Error('文章格式无效'); return { ...post, tags: Array.isArray(post.tags) ? post.tags.filter((x) => typeof x === 'string').slice(0, 50) : [] }; }
function draftMarkdown(post) { return `---\ntitle: ${JSON.stringify(post.title)}\ndescription: ${JSON.stringify(post.description)}\npubDate: ${post.pubDate}\n${post.updatedDate ? `updatedDate: ${post.updatedDate}\n` : ''}${post.dir1 ? `dir1: ${JSON.stringify(post.dir1)}\n` : ''}${post.dir2 ? `dir2: ${JSON.stringify(post.dir2)}\n` : ''}tags: [${post.tags.map((x) => JSON.stringify(x)).join(', ')}]\n---\n\n${post.body.trim()}\n`; }
function safeSegment(value) { const result = String(value || '').trim().replace(/[^\p{L}\p{N}._-]/gu, '-'); if (!result || result === '.' || result === '..') throw new Error('路径无效'); return result; }
function requireEnv(env, keys) { for (const key of keys) if (!env[key] || env[key].includes('YOUR_')) throw new Error(`服务端缺少配置：${key}`); }
function getCookie(headers, name) { const raw = headers?.get('Cookie') || ''; return raw.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name}=`))?.slice(name.length + 1) || ''; }
function cookie(name, value, maxAge, httpOnly = false) { return `${name}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax${httpOnly ? '; HttpOnly; Secure' : ''}`; }
function cors(response, env) { const headers = new Headers(response.headers); headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || '*'); headers.set('Access-Control-Allow-Credentials', 'true'); headers.set('Access-Control-Allow-Headers', 'Content-Type'); headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS'); return new Response(response.body, { status: response.status, headers }); }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }
function b64url(value) { return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function toBase64(value) { const bytes = new TextEncoder().encode(value); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
