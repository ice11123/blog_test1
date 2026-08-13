const REQUEST_TIMEOUT_MS = 15_000;
const GITHUB_API = 'https://api.github.com';
const REPOSITORY = 'ice11123/blog_test1';
const BRANCH = 'main';

function initPublicStatus(): void {
  const root = document.querySelector<HTMLElement>('[data-public-status]');
  if (!root || root.dataset.bound === 'true') return;
  root.dataset.bound = 'true';
  const endpoint = (root.dataset.statusEndpoint || '').replace(/\/$/, '');

  const setCard = (name: string, state: string, value: string, detail = '', link = '') => {
    const card = root.querySelector<HTMLElement>(`[data-public-card="${name}"]`);
    if (!card) return;
    card.dataset.state = state;
    const labels: Record<string, string> = { ok: '正常', error: '异常', waiting: '等待', checking: '检测中' };
    const stateNode = card.querySelector<HTMLElement>('[data-card-state]');
    const valueNode = card.querySelector<HTMLElement>('[data-card-value]');
    const detailNode = card.querySelector<HTMLElement>('[data-card-detail]');
    const anchor = card.querySelector<HTMLAnchorElement>('[data-card-link]');
    if (stateNode) stateNode.textContent = labels[state] || state;
    if (valueNode) valueNode.textContent = value;
    if (detailNode) detailNode.textContent = detail;
    if (anchor) {
      if (link) { anchor.href = link; anchor.hidden = false; }
      else { anchor.removeAttribute('href'); anchor.hidden = true; }
    }
  };

  const formatTime = (value?: string | null) => {
    if (!value) return '暂无更新时间';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? '暂无更新时间' : date.toLocaleString('zh-CN', { hour12: false });
  };

  const refreshFromGitHub = async () => {
    try {
      const [refResponse, runsResponse] = await Promise.all([
        fetch(`${GITHUB_API}/repos/${REPOSITORY}/git/ref/heads/${BRANCH}`, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
        fetch(`${GITHUB_API}/repos/${REPOSITORY}/actions/workflows/deploy.yml/runs?branch=${BRANCH}&per_page=1`, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }),
      ]);
      if (!refResponse.ok) throw new Error('repository status failed');
      const ref = await refResponse.json();
      const sha = typeof ref?.object?.sha === 'string' ? ref.object.sha : '';
      if (!sha) throw new Error('repository SHA missing');
      setCard('repository', 'waiting', REPOSITORY, `${BRANCH} · ${sha.slice(0, 7)} · GitHub 直连降级`, `https://github.com/${REPOSITORY}/commit/${sha}`);

      if (!runsResponse.ok) {
        setCard('deployment', 'waiting', 'Worker 不可用，部署状态待刷新', '仓库 HEAD 已通过 GitHub 直连读取');
        return;
      }
      const runs = await runsResponse.json();
      const run = Array.isArray(runs?.workflow_runs) ? runs.workflow_runs[0] : null;
      if (!run) {
        setCard('deployment', 'waiting', '暂无部署记录', 'GitHub 直连降级');
        return;
      }
      const status = run.status !== 'completed' ? 'pending' : run.conclusion === 'success' ? 'success' : 'failure';
      if (status === 'success') setCard('deployment', 'waiting', '最近部署成功', `${formatTime(run.updated_at)} · GitHub 直连降级`, run.html_url || '');
      else if (status === 'pending') setCard('deployment', 'waiting', '正在构建或排队', `${formatTime(run.updated_at)} · GitHub 直连降级`, run.html_url || '');
      else setCard('deployment', 'error', '最近部署失败', formatTime(run.updated_at), run.html_url || '');
    } catch {
      setCard('repository', 'error', '仓库状态不可用', 'Worker 与 GitHub 公共 API 均无法连接');
      setCard('deployment', 'error', '部署状态不可用', 'Worker 与 GitHub 公共 API 均无法连接');
    }
  };

  const refresh = async () => {
    setCard('frontend', 'ok', '首页脚本已初始化', '公开状态模块工作正常');
    if (!endpoint) {
      setCard('worker', 'error', '未配置 Worker API', '缺少 PUBLIC_ADMIN_SYNC_API_URL');
      setCard('repository', 'waiting', '等待 Worker 配置', '目标：ice11123/blog_test1 main');
      setCard('deployment', 'waiting', '等待仓库状态', '暂未读取 Pages 部署');
      return;
    }
    ['worker', 'repository', 'deployment'].forEach((key) => setCard(key, 'checking', '正在检测', '请稍候'));
    try {
      const response = await fetch(`${endpoint}/api/public-status`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && !body.stale) throw new Error('status failed');
      const stale = body.stale === true;
      setCard('worker', stale ? 'waiting' : 'ok', stale ? '缓存状态可用' : 'Worker 与 KV 正常', `检测于 ${formatTime(body.checkedAt)}`);
      if (body.repository?.ok) {
        const sha = String(body.repository.headSha || '').slice(0, 7);
        setCard('repository', stale ? 'waiting' : 'ok', `${body.repository.owner}/${body.repository.name}`, `${body.repository.branch} · ${sha}${stale ? ' · 数据暂未刷新' : ''}`, body.repository.commitUrl || '');
      } else {
        setCard('repository', 'error', '仓库连接失败', '无法读取 main 分支');
      }
      const deployment = body.deployment || {};
      if (deployment.status === 'success') setCard('deployment', stale ? 'waiting' : 'ok', '最近部署成功', formatTime(deployment.updatedAt), deployment.url || '');
      else if (deployment.status === 'pending') setCard('deployment', 'waiting', '正在构建或排队', formatTime(deployment.updatedAt), deployment.url || '');
      else if (deployment.status === 'unknown') setCard('deployment', 'waiting', '暂无部署记录', formatTime(deployment.updatedAt));
      else setCard('deployment', 'error', '最近部署失败', formatTime(deployment.updatedAt), deployment.url || '');
    } catch {
      setCard('worker', 'error', 'Worker 无法连接', '请稍后重新检测');
      setCard('repository', 'checking', '正在尝试 GitHub 直连', 'Worker 不可用，启用公共只读降级');
      setCard('deployment', 'checking', '正在尝试 GitHub 直连', 'Worker 不可用，启用公共只读降级');
      await refreshFromGitHub();
    }
  };

  root.querySelector('[data-public-status-refresh]')?.addEventListener('click', () => { void refresh(); });
  void refresh();
}

document.addEventListener('DOMContentLoaded', initPublicStatus);
document.addEventListener('astro:page-load', initPublicStatus);
