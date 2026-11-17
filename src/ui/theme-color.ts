/* ==========================================================================
   顶部那条状态栏（灵动岛旁边那块）的颜色

   问题：浏览器/WebView 在页面之上还有一条自己的状态栏区（含灵动岛、系统时钟）。
   它的颜色由 <meta name="theme-color"> 决定，写在 index.html 里是死的 #fafafa。
   于是进了聊天 APP（顶栏是 QQ 蓝）之后，最上面那条还是白的，
   跟下面的顶栏明显分层 —— 看着像「手机上贴了块别的屏」。

   做法：每次换屏之后，**去量页面最顶部实际是什么颜色**，把这一个颜色
   同时写给 theme-color 和 <html> 的底色。这样：
     · 状态栏 → 和顶栏同一个颜色，连成一片
     · 页面到底后回弹露出的那点区域 → 也是同一个颜色，不是突兀的白/蓝边

   为什么去「量」而不是各页面自己报颜色：
     聊天 APP 的顶栏色来自美化配置（用户可以改成任意颜色），
     聊天室的顶栏走 --surface，桌面走 --bg —— 三种来源。
     让每个页面自己记得上报一次，迟早会漏掉一个，然后又是一条错色的边。
     量一次计算样式，永远跟屏幕上看到的那个色一致。
   ========================================================================== */

/** index.html 里写死的那份，量不到时用它兜底 */
const FALLBACK = '#fafafa';

/** rgba(...) / rgb(...) → #rrggbb；带透明度的一律不算数（量到的不是实色就往上找） */
function toHex(color: string): string | null {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(
    color.trim(),
  );
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : Number(match[4]);
  if (!(alpha > 0.98)) return null;
  const hex = (value: string): string => {
    const n = Math.max(0, Math.min(255, Math.round(Number(value))));
    return n.toString(16).padStart(2, '0');
  };
  return `#${hex(match[1]!)}${hex(match[2]!)}${hex(match[3]!)}`;
}

function meta(): HTMLMetaElement {
  const found = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (found) return found;
  const el = document.createElement('meta');
  el.name = 'theme-color';
  document.head.appendChild(el);
  return el;
}

export function setThemeColor(color: string): void {
  const value = /^#[0-9a-f]{6}$/i.test(color) ? color : (toHex(color) ?? FALLBACK);
  const tag = meta();
  if (tag.content !== value) tag.content = value;
  if (document.documentElement.style.backgroundColor !== value) {
    document.documentElement.style.backgroundColor = value;
  }
}

/** 回到「没进任何 APP」时的默认色 */
export function resetThemeColor(): void {
  setThemeColor(FALLBACK);
}

/**
 * 量一次屏幕最顶端那一块到底是什么颜色。
 *
 * 从页面正中、离顶 2px 的位置往下扎，逐个祖先找第一个不透明的底色。
 * 用 elementFromPoint 而不是「约定每个页面传一个元素进来」，
 * 是因为它天然处理了浮层、固定定位、圆角切出来的缝隙这些情况。
 */
export function syncThemeColorFromTop(): void {
  // 锁屏盖着的时候，顶端颜色就是锁屏自己的底色
  const probe = document.elementFromPoint(window.innerWidth / 2, 2);
  let node: Element | null = probe;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    const hex = toHex(bg);
    if (hex) {
      setThemeColor(hex);
      return;
    }
    node = node.parentElement;
  }
  setThemeColor(getComputedStyle(document.body).backgroundColor);
}
