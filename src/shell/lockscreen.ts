import './lockscreen.css';

/* ==========================================================================
   锁屏：大号时钟 + 日期，上滑进入主界面。

   几个刻意的选择：
   - 它是覆盖在路由之上的一层（position: fixed），不是一条路由。
     这样"锁屏"和"当前在哪一屏"互不干扰，将来加「要不要锁屏」的开关也只动这里。
   - 每次打开/刷新应用显示一次。自动锁屏、锁屏密码、背景自定义都留给后面的版本。
   - 手势用 Pointer Events 而不是 Touch Events，鼠标和手指都能拖，
     在电脑浏览器上调试时不用另外写一套。
   ========================================================================== */

const WEEK = ['日', '一', '二', '三', '四', '五', '六'] as const;

/** 拖过屏幕高度的这个比例就算解锁 */
const UNLOCK_RATIO = 0.22;
/** 但至少要拖这么多像素，免得在矮屏上太容易误触 */
const UNLOCK_MIN_PX = 72;

/**
 * 盖上锁屏。onUnlock 在滑出动画结束后调用。
 * 返回一个函数，可以直接把锁屏收掉（外部强制解锁用）。
 */
export function mountLockscreen(onUnlock: () => void = () => {}): () => void {
  const el = document.createElement('div');
  el.className = 'lock';
  el.innerHTML = `
    <div class="lock__time" id="lock-clock">--:--</div>
    <div class="lock__date" id="lock-date"></div>
    <div class="lock__hint">
      <span class="lock__arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
             stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </span>
      <span>上滑解锁</span>
    </div>`;

  document.body.appendChild(el);

  /* ---------- 时钟 ---------- */

  const clock = el.querySelector<HTMLElement>('#lock-clock');
  const date = el.querySelector<HTMLElement>('#lock-date');

  // 只在文字真的变了才写 DOM，否则每秒都在触发排版
  const paint = (node: HTMLElement | null, text: string): void => {
    if (node && node.textContent !== text) node.textContent = text;
  };

  const tick = (): void => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    paint(clock, `${hh}:${mm}`);
    paint(date, `${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK[d.getDay()] ?? ''}`);
  };

  tick();
  const timer = window.setInterval(tick, 1000);

  /* ---------- 上滑手势 ---------- */

  let startY = 0;
  let offset = 0;
  let dragging = false;
  let unlocked = false;

  const threshold = (): number =>
    Math.max(UNLOCK_MIN_PX, window.innerHeight * UNLOCK_RATIO);

  const snapBackTimer = { id: 0 };

  function settle(unlock: boolean): void {
    dragging = false;
    el.classList.remove('lock--dragging');

    if (unlock) {
      unlocked = true;
      el.classList.remove('lock--snapback');
      el.classList.add('lock--leaving');
      el.style.transform = 'translateY(-100%)';

      // transitionend 万一不来（浏览器差异、元素被提前移除），
      // 用定时器兜底 —— 绝不能让用户卡在锁屏上出不来
      let finished = false;
      const done = (): void => {
        if (finished) return;
        finished = true;
        teardown();
        onUnlock();
      };
      el.addEventListener('transitionend', done, { once: true });
      window.setTimeout(done, 900);
      return;
    }

    // 没拖够：弹回去，用果冻曲线，手感是「吸」回去的
    el.classList.add('lock--snapback');
    el.style.transform = '';
    snapBackTimer.id = window.setTimeout(() => {
      el.classList.remove('lock--snapback');
    }, 560);
  }

  function onDown(e: PointerEvent): void {
    if (unlocked) return;
    dragging = true;
    startY = e.clientY;
    offset = 0;
    el.classList.remove('lock--snapback');
    el.classList.add('lock--dragging');
    el.setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent): void {
    if (!dragging || unlocked) return;
    const delta = e.clientY - startY;
    // 向上跟手，向下给阻尼 —— 否则往下拖时整个锁屏会跑出屏幕，很难看
    offset = delta < 0 ? delta : delta * 0.22;
    el.style.transform = `translateY(${offset}px)`;
  }

  function onUp(): void {
    if (!dragging || unlocked) return;
    settle(Math.abs(offset) > threshold());
  }

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);

  // 键盘也能解锁（无障碍与桌面调试）
  function onKey(e: KeyboardEvent): void {
    if (unlocked) return;
    if (e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      settle(true);
    }
  }
  addEventListener('keydown', onKey);

  function teardown(): void {
    unlocked = true;
    window.clearInterval(timer);
    window.clearTimeout(snapBackTimer.id);
    removeEventListener('keydown', onKey);
    el.remove();
  }

  return teardown;
}
