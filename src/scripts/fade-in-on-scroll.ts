// 防止 dev 模式下视图过渡导致脚本重复执行
if (!(window as any).__fadeInOnScrollLoaded) {
  (window as any).__fadeInOnScrollLoaded = true;

let observer: IntersectionObserver | null = null;
let ticking = false;
let pendingAdd: Element[] = [];
let pendingRemove: Element[] = [];

function flush() {
  pendingAdd.forEach((el) => el.classList.add('visible'));
  pendingRemove.forEach((el) => el.classList.remove('visible'));
  pendingAdd = [];
  pendingRemove = [];
  ticking = false;
}

document.addEventListener('astro:page-load', () => {
  if (observer) {
    observer.disconnect();
    pendingAdd = [];
    pendingRemove = [];
    ticking = false;
  }

  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        pendingAdd.push(entry.target);
      } else {
        pendingRemove.push(entry.target);
      }
    });

    if (!ticking) {
      ticking = true;
      requestAnimationFrame(flush);
    }
  }, {
    threshold: 0.05,
    rootMargin: '0px 0px 40px 0px',
  });

  const fadeElements = document.querySelectorAll<HTMLElement>(
    '.fade-down-on-scroll, .fade-up-on-scroll, .fade-left-on-scroll, .fade-right-on-scroll, .fade-scale-on-scroll, .fade-only-on-scroll'
  );

  fadeElements.forEach((el) => observer!.observe(el));
});

}
