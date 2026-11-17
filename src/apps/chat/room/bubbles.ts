/* ==========================================================================
   聊天室的气泡渲染

   这一块单独成文件，因为它有两条容易搞错的规则，
   埋在 1200 行的 chat.ts 里改一次就要重读一遍：

   规则一：气泡里只放「说出口的话」
     角色的动作 / 心理描写永远剥出去，不管开关开没开。
     开关只控制「要不要多那枚星标」，不控制「剥不剥」。
     这是线上聊天的样子 —— 混在一起就把聊天演成了剧本。

   规则二：气泡样式走 CSS 变量，不写内联
     内联优先级最高，会把用户在美化面板里拖的圆角、颜色全部压死；
     而且几百个气泡各带一长串 style，改一次就要重画全部。
     唯一的例外是渐变 —— 渐变没法用单个变量表达，只能内联。

   拆成纯函数（不吃闭包），所以能单测。
   ========================================================================== */

import { esc } from '../../../core/dom';
import { actionNoteVisible, displayUserName, userAvatarKey } from '../../../core/prefs';
import type { Character, Message } from '../../../core/types';
import { avatarHTML } from '../../../ui/avatar';
import { activeScheme, assetUrl } from '../beauty/store';
import { avatarDecorOf, bubbleStickersHTML } from '../beauty/render';
import { bubbleShapeStyle, readableInkOn } from '../beauty/css';
import type { Participant } from '../beauty/model';
import { parseCharacterAction } from './action';
import { splitIntoBubbles, splitOptionsFor } from './split';
import { timeLabel } from './time';

/**
 * 翻译样式的动作 / 心理块：显示在对话气泡下方。
 *
 * 类似微信/QQ 的翻译结果条：上面是说出口的话，下面是动作或心理描写。
 */
export function actionNoteHTML(text: string): string {
  return `<div class="msg-action-note" data-action-note>
    <p class="msg-action-note__text">${esc(text)}</p>
    <span class="msg-action-note__tag">动作 · 心理</span>
  </div>`;
}

/** 时间分隔条 */
export function timeHTML(iso: string): string {
  return `<div class="chat-time">${esc(timeLabel(iso))}</div>`;
}

export interface BubbleRowOptions {
  message: Message;
  character: Character;
  /** 是不是最后一条角色消息（只有它能「重新生成」） */
  isLastAssistant: boolean;
  /** 是否显示动作/心理翻译块（默认读取全局开关） */
  showActionNote?: boolean;
}

/**
 * 一条消息 → 一行 DOM 字符串。
 *
 * 渐变是唯一需要内联的样式，其余全部交给 .chat-page 上的变量。
 */
/** 气泡的两半样式：cls 是要加的类，style 是内联样式属性 */
interface ShapeStyle {
  cls: string;
  style: string;
}

function gradientStyle(isUser: boolean): ShapeStyle {
  const bubble = isUser
    ? activeScheme().participants.user.bubble
    : activeScheme().participants.wuli.bubble;

  /**
   * 异形气泡走单独一条路。
   *
   * 9-slice 的样式里含图片 URI 和切片值，是拼出来的长字符串，
   * 没法拆成 CSS 变量（详见 css.ts 里的注释）。所以直接内联。
   *
   * 一旦用了异形：
   *   · 渐变让位 —— 图自带填充，再叠渐变会把图盖住看不见
   *   · 加 has-shape 类 —— CSS 靠它把圆角归零、把文字色改回主色
   */
  const shapeStyle = bubbleShapeStyle({ bubble } as Participant, assetUrl);
  if (shapeStyle) {
    // 文字色优先用自定义气泡保存的文字色，否则按气泡底色亮度自动算
    const ink = bubble.bubbleShape.ink || readableInkOn(bubble.fill);
    return {
      cls: ' has-shape',
      style: ` style="--shape-ink:${ink};${shapeStyle}"`,
    };
  }

  if (!bubble.gradientColor) return { cls: '', style: '' };

  const first = `color-mix(in srgb, ${bubble.fill} ${bubble.opacity * 100}%, transparent)`;
  const second = `color-mix(in srgb, ${bubble.gradientColor} ${bubble.opacity * 100}%, transparent)`;
  return {
    cls: '',
    style: ` style="background:linear-gradient(${bubble.gradientAngle}deg,${first},${second})"`,
  };
}

export function bubbleRowHTML(options: BubbleRowOptions): string {
  const { message, character, isLastAssistant, showActionNote = actionNoteVisible() } = options;
  const isUser = message.role === 'user';

  // 双方的嘴脸都要有：自己也有头像，这才像真在聊天
  const avatar = isUser
    ? avatarHTML(displayUserName(), 36, userAvatarKey(), undefined, avatarDecorOf('user'))
    : avatarHTML(
        character.name || '未命名',
        36,
        character.avatarKey,
        character.avatarFrame,
        avatarDecorOf('wuli'),
      );

  const stickers = isUser ? bubbleStickersHTML('user') : bubbleStickersHTML('wuli');

  // 生图消息：正文是提示词，图在 extra.imageUrl
  const imageUrl = typeof message.extra?.imageUrl === 'string' ? message.extra.imageUrl : '';

  // 用户自己写的括号是他自己的口吻，绝不碰
  const parsed =
    !isUser && !imageUrl
      ? parseCharacterAction(message.content)
      : { actionText: null, mainText: message.content };

  // 一轮回复拆成多个气泡：头像只出现一次，气泡在它右边往下排，
  // 像一个人在连着发几条消息。
  //   用户自己的消息不拆（他怎么发就怎么显示）
  //   wuli 也拆，但单条放宽 —— 它要讲清步骤、贴代码
  const pieces = !isUser && !imageUrl ? splitIntoBubbles(parsed.mainText, splitOptionsFor(character)) : [];

  const shape = gradientStyle(isUser);
  const bubble = (text: string): string =>
    `<div class="msg-bubble${shape.cls}" data-bubble${shape.style}>${esc(text)}${stickers}</div>`;

  const body = imageUrl
    ? `<div class="msg-image"><img src="${esc(imageUrl)}" alt="${esc(message.content)}" loading="lazy" /></div>`
    : pieces.length > 1
      ? pieces.map((piece) => bubble(piece)).join('')
      : bubble(parsed.mainText);

  const actionNote =
    showActionNote && parsed.actionText ? actionNoteHTML(parsed.actionText) : '';

  const retry = isLastAssistant
    ? '<button class="msg-action-btn" type="button" data-act="retry">重新生成</button>'
    : '';

  return `<div class="msg-row ${isUser ? 'msg-row--user' : 'msg-row--assistant'}" data-msg-id="${esc(message.id)}">
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-content">
      ${body}
      ${actionNote}
      <div class="msg-actions">
        <button class="msg-action-btn" type="button" data-act="copy">复制</button>
        ${retry}
        <button class="msg-action-btn" type="button" data-act="del">删除</button>
      </div>
    </div>
  </div>`;
}
