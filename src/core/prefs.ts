import { getSetting, setSetting } from './db';

/**
 * 全局偏好 —— 那些「一行开关」就能表达的东西。
 *
 * 为什么单独一个文件：设置页要**写**它、桌面要**读**它，
 * 而 features 之间不许互相 import（AGENTS.md 铁律 3）。放 core/ 两边都能用。
 *
 * 另外这里刻意不使用 DOM 的 addEventListener / CustomEvent ——
 * core/ 要能在没有 DOM 的环境里跑（铁律 1），所以自己写了个极简订阅。
 */

/** 桌面顶部状态栏（时间 / 信号 / 电量）的开关 */
export const SHOW_STATUS_BAR_KEY = 'showStatusBar';

type Listener = () => void;

const listeners = new Set<Listener>();

/** 订阅「偏好变了」。返回取消订阅的函数 */
export function onPrefsChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(): void {
  for (const fn of listeners) fn();
}

/** 内存里的一份，给同步渲染用。null = 还没加载 */
let statusBar: boolean | null = null;

/** 启动时读一次。没存过就是开 —— 用户没表态时不该「悄悄关掉」 */
export async function loadPrefs(): Promise<void> {
  const value = await getSetting<boolean>(SHOW_STATUS_BAR_KEY);
  const next = value !== false;
  if (next === statusBar) return;
  statusBar = next;
  emit();
}

/** 桌面顶栏该不该显示。还没加载完时默认显示 */
export function statusBarVisible(): boolean {
  return statusBar !== false;
}

export function setStatusBarVisible(on: boolean): void {
  statusBar = on;
  void setSetting(SHOW_STATUS_BAR_KEY, on);
  emit();
}
