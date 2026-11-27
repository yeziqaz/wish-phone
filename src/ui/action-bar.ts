import './action-bar.css';
import { esc } from '../core/dom';

/* ==========================================================================
   浮层小工具条（action bar）

   用途：长按一条消息、一张卡片时，在它旁边浮出一小排命令。
   参考 Apple HIG《Context menus》（2026-11-08 取回原文）：
     · 「提供一个项目的相关功能，且不弄乱界面」—— 所以它默认隐藏
     · 「条目要少：太长会难扫读、难滚动」—— 所以条目按 5 列折行，不做横向滚动
     · 「不可用的条目不显示，而不是变灰」
     · 「最常用的放在手指起手最近处」—— 顺序由调用方给
     · 「必须在主界面里也有同样的入口」—— 所以行内操作条不能删

   放在 ui/ 而不是某个 app 里，因为角色卡、世界书以后要复用同一套。

   用法：
     const picked = await openActionBar({ anchor: bubbleEl, items: [...] });
     picked 为 null 表示用户点了别处、或滑走了。
   ========================================================================== */

export interface ActionBarItem {
  id: string;
  label: string;
  /** 已经画好的内联 SVG 源码，用 ui/icons 的 line() */
  icon: string;
  /** 危险动作（删除），文字走 --danger */
  danger?: boolean;
}

export interface ActionBarConfig {
  /** 贴着谁浮出来。用它的 getBoundingClientRect 定位 */
  anchor: HTMLElement;
  items: ActionBarItem[];
}

const EDGE = 8; // 离屏幕边缘至少留这么多
const GAP = 8; // 工具条与锚点之间的距离

export function openActionBar(config: ActionBarConfig): Promise<string | null> {
  return new Promise((resolve) => {
    if (config.items.length === 0) {
      resolve(null);
      return;
    }

    const root = document.createElement('div');
    root.className = 'action-bar';
    root.setAttribute('role', 'menu');
    root.innerHTML = config.items
      .map(
        (item) => `
        <button class="action-bar__item${item.danger ? ' is-danger' : ''}" type="button"
                role="menuitem" data-act-id="${esc(item.id)}">
          <span class="action-bar__icon">${item.icon}</span>
          <span class="action-bar__label">${esc(item.label)}</span>
        </button>`,
      )
      .join('');

    document.body.appendChild(root);

    /* ---------- 定位 ----------
       默认浮在锚点上方；上方放不下就翻到下方。
       横向以锚点中线对齐，再钳进屏幕内，避免贴边被切掉。

       量尺寸用 offsetWidth / offsetHeight，不能用 getBoundingClientRect：
       浮层此刻还带着 transform: scale(0.94)（等 is-open 才到 1），
       rect 量到的是缩小后的尺寸，定位会系统性偏 6%。 */
    const place = (): void => {
      const box = config.anchor.getBoundingClientRect();
      const barW = root.offsetWidth;
      const barH = root.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      let top = box.top - barH - GAP;
      let below = false;
      if (top < EDGE) {
        // 上方不够：翻到下方
        top = box.bottom + GAP;
        below = true;
      }
      // 下方也放不下（极少见）：贴底
      if (top + barH > vh - EDGE) {
        top = Math.max(EDGE, vh - EDGE - barH);
        below = false;
      }

      let left = box.left + box.width / 2 - barW / 2;
      left = Math.min(Math.max(EDGE, left), vw - EDGE - barW);

      // 从锚点那一侧长出来：在锚点上方就贴着自己底边放大，翻到下方就改贴顶边
      root.style.transformOrigin = below ? 'center top' : 'center bottom';
      root.style.top = `${Math.round(top)}px`;
      root.style.left = `${Math.round(left)}px`;
    };

    // 先量一次尺寸（此时不可见但已挂载），再定位，最后才显示，避免闪一下
    place();
    requestAnimationFrame(() => {
      place();
      root.classList.add('is-open');
    });

    /* ---------- 关闭 ---------- */
    const close = (result: string | null): void => {
      root.classList.remove('is-open');
      document.removeEventListener('pointerdown', onOutside, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      const done = (): void => {
        root.remove();
        resolve(result);
      };
      root.addEventListener('transitionend', done, { once: true });
      // 动画被系统关掉时兜底
      window.setTimeout(done, 260);
    };

    // 点工具条外面就关。用捕获阶段，赶在别人的点击处理之前。
    const onOutside = (event: Event): void => {
      if (!root.contains(event.target as Node)) close(null);
    };

    // 列表一滚，工具条就对不上锚点了，直接收起来（微信、Telegram 也是这么做的）
    const onScroll = (event: Event): void => {
      if (!root.contains(event.target as Node)) close(null);
    };

    const onResize = (): void => close(null);

    root.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-act-id]');
      if (!button) return;
      close(button.dataset.actId ?? null);
    });

    // 下一帧再挂外部监听，否则「触发长按的那一次抬手」会立刻把它关掉
    requestAnimationFrame(() => {
      document.addEventListener('pointerdown', onOutside, true);
      window.addEventListener('resize', onResize);
      window.addEventListener('scroll', onScroll, true);
    });
  });
}
