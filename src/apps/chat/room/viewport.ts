/* ==========================================================================
   聊天室的视口与软键盘自适应

   这是整个项目最容易出玄学 bug 的一块，所以单独成文件，
   并且把「为什么这么做」写在这里，而不是散在 chat.ts 里。

   ---------- 问题 ----------

   Android 上键盘弹起时，浏览器有三种完全不同的表现：

     1) 缩小布局视口（interactive-widget=resizes-content）
     2) 只缩「视觉视口」(visualViewport)，布局视口不动
     3) 只把键盘盖上来，什么都不通知 —— 目前这台设备就是这种

   第 3 种最坑：没有事件、没有 resize，只能靠定时对表。

   ---------- 做法 ----------

   整页钉成 fixed，高度取「所有能问到的可见高度里最小的那个」，
   再按 visualViewport.offsetTop 对齐。

   为什么取最小值：这三个值谁先变不一定。只要有一个变小了，我们就跟上；
   三个都不变，才真的没信号（那就是第 3 种，靠定时器兜）。

   为什么键盘高度要「记住」：键盘是动画着长出来的，而且是分好几帧长。
   如果在动画中间量到 180px 就停，底栏会卡在半路。所以只记最大值。
   ========================================================================== */

export interface ViewportDeps {
  /** 被钉成 fixed 的那个容器（.chat-page） */
  page: HTMLElement;
  /** 输入框：只有它聚焦时才算「键盘真的起来了」 */
  input: HTMLTextAreaElement;
  /** 抽屉：抽屉开着时键盘高度不参与计算 */
  drawer: HTMLElement;
  /** 视口变了要滚到底 */
  onSettled: () => void;
}

export interface Viewport {
  /** 手动同步一次（比如发完消息） */
  sync: () => void;
  /** 当前软键盘高度，加号面板复用它，保证切换时底栏高度不跳 */
  keyboardHeight: () => number;
  /** 拆掉监听（路由切走时调用） */
  dispose: () => void;
}

/** 三个来源里取最小的那个可见高度 */
function visibleHeight(): number {
  const list = [window.innerHeight, document.documentElement.clientHeight];
  const visual = window.visualViewport?.height;
  if (typeof visual === 'number' && visual > 0) list.push(visual);
  const usable = list.filter((value) => value > 0);
  return usable.length > 0 ? Math.min(...usable) : window.innerHeight;
}

export function watchViewport(deps: ViewportDeps): Viewport {
  const { page, input, drawer } = deps;

  /** 首次量到的完整高度，用来判断键盘有没有起来 */
  let tallest = 0;
  let keyboard = 0;
  let watchTimer = 0;
  let disposed = false;

  const sync = (): void => {
    if (disposed) return;

    const height = visibleHeight();
    const offset = window.visualViewport?.offsetTop ?? 0;

    // 只记最大值：键盘动画长出来的过程中，高度是单调变小的
    if (tallest === 0 || height > tallest) tallest = height;

    page.style.height = `${Math.round(height)}px`;
    page.style.top = `${Math.round(offset)}px`;

    // 120px 是经验阈值：键盘最矮也有一百多，而地址栏收起只有几十
    const keyboardOpen = tallest - height > 120;

    if (keyboardOpen && document.activeElement === input && drawer.hidden) {
      keyboard = tallest - height;
      page.style.setProperty('--chat-keyboard-height', `${Math.round(keyboard)}px`);
    }

    // 键盘收起动画期间只补足剩余高度，避免键盘和面板重复占位
    page.style.setProperty('--chat-keyboard-overlap', `${Math.max(0, Math.round(tallest - height))}px`);

    if (page.classList.contains('is-keyboard') !== keyboardOpen) {
      page.classList.toggle('is-keyboard', keyboardOpen);
    }

    deps.onSettled();
  };

  /**
   * 第 3 种浏览器一次都不通知，所以聚焦期间定时对表，失焦就停。
   * 150ms 是「跟得上但不费电」的折中：太快会让低端机掉帧，
   * 太慢会让底栏明显晚一拍。
   */
  const startWatching = (): void => {
    window.clearInterval(watchTimer);
    watchTimer = window.setInterval(sync, 150);
  };

  const stopWatching = (): void => {
    window.clearInterval(watchTimer);
    watchTimer = 0;
  };

  window.addEventListener('resize', sync);
  window.addEventListener('orientationchange', sync);
  window.visualViewport?.addEventListener('resize', sync);
  window.visualViewport?.addEventListener('scroll', sync);

  /**
   * 注意：聊天页面自己也会在 input 上绑 focus / blur，
   * 那两处管的是「关抽屉、滚到底」这类业务动作，和这里的「开始/停止对表」无关。
   * 两个监听并存是有意的，不要合并 —— 合并会把业务逻辑漏进这个纯技术模块。
   */
  input.addEventListener('focus', startWatching);
  input.addEventListener('blur', stopWatching);

  sync();

  return {
    sync,
    keyboardHeight: () => keyboard,
    dispose: () => {
      disposed = true;
      stopWatching();
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      window.visualViewport?.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('scroll', sync);
      input.removeEventListener('focus', startWatching);
      input.removeEventListener('blur', stopWatching);
    },
  };
}
