const API = 'https://api.github.com';
const SESSION_TTL = 60 * 60 * 24 * 7;
const SESSION_PREFIX = 'session:v2:';
const DEFAULT_ADMIN_PATH = '/blog_test1/admin/';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      if (!isAllowedOrigin(request, env)) return new Response('Forbidden', { status: 403 });
      return cors(new Response(null, { status: 204 }), env, request);
    }

    try {
      if (url.pathname === '/auth/github' && request.method === 'GET') return githubLogin(url, env);
      if (url.pathname === '/auth/callback' && request.method === 'GET') return await githubCallback(request, url, env);
      if (url.pathname === '/auth/me' && request.method === 'GET') return await authMe(request, env);
      if (url.pathname === '/api/sync' && request.method === 'POST') return await syncPost(request, env);
      return cors(json({ ok: false, message: 'Not found' }, 404), env, request);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : 'Server error';
      if (!(error instanceof HttpError)) console.error(error);
      return cors(json({ ok: false, message }, status), env, request);
    }
  },
};

function githubLogin(url, env) {
  requireEnv(env, ['GITHUB_OAUTH_CLIENT_ID', 'SESSION_SECRET']);
  const state = crypto.randomUUID();
  const auth = new URL('https://github.com/login/oauth/authorize');
  auth.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID);
  auth.searchParams.set('redirect_uri', new URL('/auth/callback', url).toString());
  auth.searchParams.set('scope', 'public_repo');
  auth.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: auth.toString(),
      'Set-Cookie': cookie('oauth_state', state, 600, { httpOnly: true, sameSite: 'Lax' }),
      'Cache-Control': 'no-store',
    },
  });
}

async function githubCallback(request, url, env) {
  try {
    requireEnv(env, ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET', 'SESSION_SECRET']);
    const stateCookie = getCookie(request.headers, 'oauth_state');
    const state = url.searchParams.get('state');
    if (!stateCookie || !state || stateCookie !== state) return oauthError('Invalid OAuth state', 400);
    const code = url.searchParams.get('code');
    if (!code) return oauthError('Missing OAuth code', 400);

    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_OAUTH_CLIENT_ID, client_secret: env.GITHUB_OAUTH_CLIENT_SECRET, code }),
    });
    const tokenData = await tokenResponse.json();
    const token = tokenData?.access_token;
    if (!token) return oauthError('OAuth token exchange failed', 502);

    const user = await githubFetch('/user', token);
    if (user?.login !== env.GITHUB_OWNER) return oauthError('该 GitHub 账号没有管理权限', 403);

    const sessionId = crypto.randomUUID();
    const csrfToken = crypto.randomUUID();
    await env.SESSIONS.put(`${SESSION_PREFIX}${sessionId}`, JSON.stringify({ token, login: user.login, csrfToken }), { expirationTtl: SESSION_TTL });

    const response = new Response(null, { status: 302, headers: { Location: adminReturnUrl(env), 'Cache-Control': 'no-store' } });
    response.headers.append('Set-Cookie', clearCookie('oauth_state'));
    response.headers.append('Set-Cookie', cookie('blog_session', sessionId, SESSION_TTL, { httpOnly: true, sameSite: 'None' }));
    return response;
  } catch (error) {
    console.error(error);
    return oauthError('OAuth callback failed', 502);
  }
}

async function authMe(request, env) {
  requireOrigin(request, env);
  const session = await readSession(request, env);
  return cors(json(session ? { ok: true, login: session.login, csrfToken: session.csrfToken } : { ok: false }, session ? 200 : 401), env, request);
}

async function syncPost(request, env) {
  requireOrigin(request, env);
  const session = await readSession(request, env);
  if (!session || session.login !== env.GITHUB_OWNER) return cors(json({ ok: false, message: '请先使用授权账号登录 GitHub' }, 401), env, request);
  const csrfToken = request.headers.get('X-CSRF-Token') || '';
  if (!session.csrfToken || csrfToken !== session.csrfToken) throw new HttpError(403, 'CSRF 校验失败');

  let payload;
  try {
    payload = await readJsonBody(request, 300_000);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, '请求体不是有效 JSON');
  }

  const post = validatePost(payload?.post);
  const ext = post.format === 'md' ? 'md' : 'mdx';
  const parts = [post.dir1, post.dir2].filter(Boolean).map(safeSegment);
  const rawName = post.id?.split('/').pop()?.replace(/\.(md|mdx)$/i, '') || post.title;
  const name = safeSegment(rawName);
  const filePath = `src/content/blog/${[...parts, `${name}.${ext}`].join('/')}`;
  const previousPath = post.publishedPath ? safePublishedPath(post.publishedPath) : null;
  const content = draftMarkdown(post);

  const encodedFilePath = encodePath(filePath);
  const existing = await githubFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodedFilePath}`, session.token, { ref: env.GITHUB_BRANCH });
  const body = { message: `更新文章：${post.title}`, content: toBase64(content), branch: env.GITHUB_BRANCH, ...(existing?.sha ? { sha: existing.sha } : {}) };
  const result = await githubFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodedFilePath}`, session.token, { method: 'PUT', body });

  if (previousPath && previousPath !== filePath) {
    const previous = await githubFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodePath(previousPath)}`, session.token, { ref: env.GITHUB_BRANCH });
    if (previous?.sha) {
      await githubFetch(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${encodePath(previousPath)}`, session.token, { method: 'DELETE', body: { message: `移除文章旧路径：${post.title}`, sha: previous.sha, branch: env.GITHUB_BRANCH } });
    }
  }

  return cors(json({ ok: true, commitSha: result.commit?.sha, commitUrl: result.commit?.html_url, path: filePath }), env, request);
}

async function readSession(request, env) {
  const id = getCookie(request.headers, 'blog_session');
  if (!id) return null;
  const raw = await env.SESSIONS.get(`${SESSION_PREFIX}${id}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function githubFetch(path, token, options = {}) {
  const requestUrl = new URL(API + path);
  if (options.ref) requestUrl.searchParams.set('ref', options.ref);
  const { ref: _ref, ...requestOptions } = options;
  const response = await fetch(requestUrl, {
    ...requestOptions,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'blog-test1-admin-api',
      ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
      ...(requestOptions.headers || {}),
    },
    body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub API failed (${response.status})`);
  return response.json();
}

function validatePost(post) {
  if (!post || typeof post !== 'object') throw new HttpError(400, '文章数据无效');
  for (const key of ['title', 'description', 'pubDate', 'body']) {
    const max = key === 'body' ? 200_000 : 2_000;
    if (typeof post[key] !== 'string' || post[key].length > max) throw new HttpError(400, `字段无效：${key}`);
  }
  for (const key of ['dir1', 'dir2', 'updatedDate', 'id', 'publishedPath']) {
    if (post[key] !== undefined && typeof post[key] !== 'string') throw new HttpError(400, `字段无效：${key}`);
  }
  for (const key of ['pubDate', 'updatedDate']) {
    if (post[key] !== undefined && !isIsoDate(post[key])) throw new HttpError(400, `日期无效：${key}`);
  }
  if (!['md', 'mdx'].includes(post.format)) throw new HttpError(400, '文章格式无效');
  if (post.dir1?.length > 200 || post.dir2?.length > 200 || post.publishedPath?.length > 500) throw new HttpError(400, '目录或路径过长');
  const tags = Array.isArray(post.tags) ? post.tags.filter((x) => typeof x === 'string' && x.length <= 100).slice(0, 50) : [];
  return { ...post, tags };
}

function draftMarkdown(post) {
  return `---\ntitle: ${JSON.stringify(post.title)}\ndescription: ${JSON.stringify(post.description)}\npubDate: ${post.pubDate}\n${post.updatedDate ? `updatedDate: ${post.updatedDate}\n` : ''}${post.dir1 ? `dir1: ${JSON.stringify(post.dir1)}\n` : ''}${post.dir2 ? `dir2: ${JSON.stringify(post.dir2)}\n` : ''}tags: [${post.tags.map((x) => JSON.stringify(x)).join(', ')}]\n---\n\n${post.body.trim()}\n`;
}

function safeSegment(value) {
  const result = String(value || '').trim().replace(/[^\p{L}\p{N}._-]/gu, '-');
  if (!result || result === '.' || result === '..') throw new HttpError(400, '路径无效');
  return result;
}

function safePublishedPath(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (!normalized.startsWith('src/content/blog/') || parts.some((part) => !part || part === '.' || part === '..') || !/\.(?:md|mdx)$/i.test(normalized)) throw new HttpError(400, '旧文章路径无效');
  return normalized;
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

async function readJsonBody(request, maxBytes) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new HttpError(413, '请求体过大');
  if (!request.body) throw new HttpError(400, '请求体不是有效 JSON');

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, '请求体过大');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, '请求体不是有效 JSON');
  }
}

function requireEnv(env, keys) {
  for (const key of keys) if (!env[key] || env[key].includes('YOUR_')) throw new Error(`服务端缺少配置：${key}`);
}

function getCookie(headers, name) {
  const raw = headers?.get('Cookie') || '';
  return raw.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}

function cookie(name, value, maxAge, options = {}) {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; SameSite=${options.sameSite || 'Lax'}; Secure${options.httpOnly ? '; HttpOnly' : ''}`;
}

function clearCookie(name) { return `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure; HttpOnly`; }
function oauthError(message, status) { const response = new Response(message, { status, headers: { 'Cache-Control': 'no-store' } }); response.headers.append('Set-Cookie', clearCookie('oauth_state')); return response; }
function adminReturnUrl(env) { return new URL(DEFAULT_ADMIN_PATH, env.ALLOWED_ORIGIN).href; }
function isAllowedOrigin(request, env) { return request.headers.get('Origin') === env.ALLOWED_ORIGIN; }
function requireOrigin(request, env) { if (!isAllowedOrigin(request, env)) throw new HttpError(403, '请求来源不被允许'); }

function cors(response, env, request) {
  const headers = new Headers(response.headers);
  headers.set('Vary', 'Origin');
  if (isAllowedOrigin(request || new Request('https://invalid.local'), env)) headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  return new Response(response.body, { status: response.status, headers });
}

function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }); }
function encodePath(value) { return encodeURIComponent(value).replaceAll('%2F', '/'); }
function toBase64(value) { const bytes = new TextEncoder().encode(value); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }

export { adminReturnUrl, isAllowedOrigin, readJsonBody, safePublishedPath, validatePost };
