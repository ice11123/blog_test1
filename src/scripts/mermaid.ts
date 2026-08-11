// 防止 dev 模式下视图过渡导致脚本重复执行
if (!(window as any).__mermaidLoaded) {
  (window as any).__mermaidLoaded = true;

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';

function readCSS(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function isThemeCSSReady(): boolean {
  return readCSS('--accent').length > 0;
}

function getMermaidConfig() {
  return {
    theme: 'base' as const,
    themeVariables: {
      primaryColor: readCSS('--accent'),
      primaryTextColor: readCSS('--foreground-light'),
      primaryBorderColor: readCSS('--accent-dark'),
      secondaryColor: readCSS('--muted'),
      tertiaryColor: readCSS('--muted-light'),
      lineColor: readCSS('--border'),
      textColor: readCSS('--foreground'),
      mainBkg: readCSS('--background-dark'),
      nodeBorder: readCSS('--accent-dark'),
      clusterBkg: readCSS('--muted-dark'),
      clusterBorder: readCSS('--border'),
      titleColor: readCSS('--foreground-light'),
      edgeLabelBackground: readCSS('--background-dark'),
      nodeTextColor: readCSS('--foreground'),
    },
    fontFamily: readCSS('--font-family') || 'inherit',
    flowchart: { useMaxWidth: true, htmlLabels: true },
    sequence: { useMaxWidth: true },
    gantt: { useMaxWidth: true },
    journey: { useMaxWidth: true },
    class: { useMaxWidth: true },
    state: { useMaxWidth: true },
    er: { useMaxWidth: true },
    pie: { useMaxWidth: true },
  };
}

let mermaidLoaded = false;
let mermaidLoading = false;
let renderCounter = 0;
let renderGen = 0;

function hasDiagrams(): boolean {
  return document.querySelectorAll('pre.mermaid').length > 0;
}

async function loadMermaid(): Promise<boolean> {
  if (mermaidLoaded) return true;
  if (mermaidLoading) return false;
  mermaidLoading = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = MERMAID_CDN;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Mermaid CDN load failed'));
      document.head.appendChild(script);
    });
    mermaidLoaded = true;
    return true;
  } catch (err) {
    console.error('Failed to load Mermaid:', err);
    mermaidLoading = false;
    return false;
  }
}

// 等待主题 CSS 加载完毕（CSS 变量有值才算就绪）
function waitForThemeCSS(): Promise<void> {
  return new Promise((resolve) => {
    if (isThemeCSSReady()) {
      resolve();
      return;
    }
    let attempts = 0;
    const maxAttempts = 50;
    const check = () => {
      attempts++;
      if (isThemeCSSReady()) {
        resolve();
      } else if (attempts < maxAttempts) {
        requestAnimationFrame(() => setTimeout(check, 100));
      } else {
        resolve();
      }
    };
    check();
  });
}

async function render() {
  if (!hasDiagrams()) return;

  await waitForThemeCSS();

  if (!(await loadMermaid())) return;

  const mermaid = (window as any).mermaid;
  if (!mermaid) return;

  // 递增渲染代数，用于取消正在进行的旧渲染
  const gen = ++renderGen;

  mermaid.initialize(getMermaidConfig());

  const diagrams = document.querySelectorAll<HTMLElement>('pre.mermaid');
  for (const el of diagrams) {
    // 如果有新渲染启动，退出当前循环
    if (renderGen !== gen) return;
    if (el.hasAttribute('data-processed')) continue;
    try {
      renderCounter++;
      const id = `mermaid-svg-${renderCounter}`;
      // 首次渲染从 textContent 读取原始代码并保存；后续重渲染从属性读取
      const originalCode = el.getAttribute('data-mermaid-code');
      const code = originalCode ?? (el.textContent || '');
      if (!originalCode) {
        el.setAttribute('data-mermaid-code', code);
      }
      const { svg } = await mermaid.render(id, code);
      // 渲染完成后再次检查代数（避免覆盖新渲染的结果）
      if (renderGen !== gen) return;
      el.innerHTML = svg;
      el.setAttribute('data-processed', 'true');
    } catch (err) {
      console.error('Mermaid render error:', err);
    }
  }
}

// 主题变化时重渲染
let observer: MutationObserver | null = null;

function watchTheme() {
  if (observer) return;
  observer = new MutationObserver(() => {
    const diagrams = document.querySelectorAll<HTMLElement>('pre.mermaid');
    for (const el of diagrams) {
      el.removeAttribute('data-processed');
    }
    render();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}

// 仅在页面存在 Mermaid 图表时初始化，避免无意义的 Observer 和监听器
if (hasDiagrams()) {
  render();
  watchTheme();

  document.addEventListener('astro:page-load', () => {
    render();
  });
}

}
