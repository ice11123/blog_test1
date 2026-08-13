// 防止 dev 模式下视图过渡导致脚本重复执行
if (!(window as any).__sidebarCollapseLoaded) {
  (window as any).__sidebarCollapseLoaded = true;

// 右侧栏：折叠按钮绑定 + 状态同步
// HtmlHead.astro 负责初始同步（<head> 中同步执行，避免 FOUC）
// 此脚本负责按钮点击后的状态切换和视图过渡后的重新同步

const STORAGE = 'blog-sidebar-collapsed';
const mobileViewport = window.matchMedia('(max-width: 760px)');

function syncCollapse() {
  if (mobileViewport.matches) {
    document.documentElement.classList.add('sidebar-collapsed');
    return;
  }
  const stored = localStorage.getItem(STORAGE);
  const collapsed = stored === 'true';
  if (collapsed) {
    document.documentElement.classList.add('sidebar-collapsed');
  } else {
    document.documentElement.classList.remove('sidebar-collapsed');
  }
}

function initCollapse() {
  const btn = document.getElementById('toggleSidebarBtn');
  if (!btn) return;

  function toggle() {
    document.documentElement.classList.toggle('sidebar-collapsed');
    const nowCollapsed = document.documentElement.classList.contains('sidebar-collapsed');
    localStorage.setItem(STORAGE, String(nowCollapsed));
  }

  btn.removeEventListener('click', toggle);
  btn.addEventListener('click', toggle);
}

syncCollapse();
initCollapse();

// 视图过渡后重新同步状态并重新绑定按钮
document.addEventListener('astro:after-swap', () => {
  syncCollapse();
  initCollapse();
});

mobileViewport.addEventListener('change', syncCollapse);

}
