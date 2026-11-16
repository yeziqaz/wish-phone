/* ==========================================================================
   长按气泡弹出的浮层工具条

   ---------- 条目顺序 ----------

   按 Apple HIG「最常用的放在手指起手最近处」：
     复制在最左，删除在最右 —— 危险动作要多跨一点，不易误触。
   「重新生成 / 读出来」只给角色消息：用户自己的话没有这两个动作，
   按 HIG「不可用的条目不显示，而不是变灰」。

   ---------- 为什么长按要自己实现 ----------

   浏览器的 contextmenu 在 Android 上行为不一致（有的长按选中文字、
   有的弹系统菜单），而且拿不到「按在哪一行上」。
   所以用 pointerdown + 定时器自己判，同时在长按生效后吞掉紧随的 click，
   不然工具条弹出来的同时行内操作条也会展开，两个浮层打架。

   ---------- 阈值 ----------

   500ms 是 iOS / Android 通用的长按起手阈值；
   移动 10px 以上就当用户是在滑列表，取消长按。
   ========================================================================== */

import { line } from '../../../ui/icons';
import { openActionBar, type ActionBarItem } from '../../../ui/action-bar';

/* 长按判定：500ms 是 iOS / Android 通用的长按起手阈值，
   短于它会和轻点抢，长于 600ms 用户会觉得「怎么没反应」。 */
const LONG_PRESS_MS = 500;

/** 手指挪动超过这个距离，就不算长按了 */
const MOVE_TOLERANCE = 10;

export interface LongPressDeps {
  /** 消息流容器（事件委托挂在它上面） */
  list: HTMLElement;
  /** 最后一条角色消息的 id，用来决定「重新生成」出不出现 */
  lastAssistantId: () => string;
  /** 用户选了「读出来」 */
  onSpeak: () => void;
  /** 其它命令（复制 / 重新生成 / 删除），交给 room.ts 执行 */
  onCommand: (command: string, row: HTMLElement) => void;
  /** 长按生效后要吞掉的那次 click 由这个开关控制 */
  setSuppressClick: (value: boolean) => void;
}

export function installLongPress(deps: LongPressDeps): void {
  let pressTimer = 0;
  let pressedRow: HTMLElement | null = null;
  const pressStart = { x: 0, y: 0 };

  const cancelPress = (): void => {
    window.clearTimeout(pressTimer);
    pressTimer = 0;
    pressedRow = null;
  };

  deps.list.addEventListener('pointerdown', (event) => {
    // 鼠标右键不算长按
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const target = event.target as HTMLElement;
    // 翻译块和行内操作条自己有交互，不在它们身上弹工具条
    if (target.closest('[data-action-note], .msg-actions')) return;

    const row = target.closest<HTMLElement>('.msg-row');
    if (!row || !row.dataset.msgId) return;

    // 正在画的占位气泡没有可操作的内容
    if (target.closest('.msg-image.is-loading')) return;

    pressedRow = row;
    pressStart.x = event.clientX;
    pressStart.y = event.clientY;

    window.clearTimeout(pressTimer);
    pressTimer = window.setTimeout(() => {
      const current = pressedRow;
      cancelPress();
      if (!current) return;

      // 长按已生效：吞掉紧接着那次 click，别让它顺带展开行内操作条
      deps.setSuppressClick(true);

      const isAssistant = current.classList.contains('msg-row--assistant');
      const isLastAssistant = current.dataset.msgId === deps.lastAssistantId();

      const items: ActionBarItem[] = [{ id: 'copy', label: '复制', icon: line('chat', 17) }];
      if (isAssistant && isLastAssistant) {
        items.push({ id: 'retry', label: '重新生成', icon: line('refresh', 17) });
      }
      if (isAssistant) {
        items.push({ id: 'speak', label: '读出来', icon: line('mic', 17) });
      }
      items.push({ id: 'del', label: '删除', icon: line('trash', 17), danger: true });

      void openActionBar({ anchor: current, items }).then((picked) => {
        if (!picked) return;
        if (picked === 'speak') {
          deps.onSpeak();
          return;
        }
        deps.onCommand(picked, current);
      });
    }, LONG_PRESS_MS);
  });

  // 挪动超过阈值就当是在滑列表，取消长按
  deps.list.addEventListener('pointermove', (event) => {
    if (!pressTimer) return;
    if (
      Math.abs(event.clientX - pressStart.x) > MOVE_TOLERANCE ||
      Math.abs(event.clientY - pressStart.y) > MOVE_TOLERANCE
    ) {
      cancelPress();
    }
  });

  deps.list.addEventListener('pointerup', cancelPress);
  deps.list.addEventListener('pointercancel', cancelPress);
  // 一开始滚动列表就不该再弹工具条
  deps.list.addEventListener('scroll', cancelPress, { passive: true });
}
