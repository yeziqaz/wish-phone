/* ==========================================================================
   聊天室的两项媒体能力：画一张（生图）、读出来（TTS）

   单独成文件的原因：
     它们是「呼叫 AI 的另一种能力」，和文本对话不是同一件事。
     混在 room.ts 里，会让「发消息」这条主线被两个大函数隔断。

   为什么要传依赖而不是直接抓：
     这俩都要动界面（占位气泡、打字指示、禁用发送键），
     但那些元素属于 room.ts。用 deps 传进来，这里就不必知道页面结构。
   ========================================================================== */

import { esc } from '../../../core/dom';
import type { Character, Conversation, Message } from '../../../core/types';
import { avatarHTML } from '../../../ui/avatar';

import { SetupError, callImage, callSpeech } from '../../../ai/call';
import { newId, putConversation, putMessage } from '../../../core/db';
import { avatarDecorOf } from '../beauty/render';

export interface MediaDeps {
  character: Character;
  conversation: Conversation;
  /** 消息数组，直接改（它是 room.ts 的那份引用） */
  messages: Message[];
  /** 被钉成 fixed 的消息流容器 */
  list: HTMLElement;
  drawer: HTMLElement;
  sendButton: HTMLButtonElement;
  context: { appId: string; roleId: string };
  /** 是否正忙 —— 传 getter 而不是值，因为它随时在变 */
  isBusy: () => boolean;
  setBusy: (value: boolean) => void;
  showTyping: () => void;
  hideTyping: () => void;
  showError: (message: string, setup: boolean) => void;
  scrollToBottom: () => void;
  describeError: (error: unknown) => string;
}

/** 画一张：拿最后一条用户消息当提示词 */
export async function drawImage(deps: MediaDeps): Promise<void> {
  if (deps.isBusy()) return;

  const prompt =
    [...deps.messages].reverse().find((item) => item.role === 'user')?.content?.trim() ?? '';

  if (!prompt) {
    deps.showError('先说一句话，我照它画。', false);
    return;
  }

  deps.drawer.hidden = true;
  deps.setBusy(true);
  deps.sendButton.disabled = true;
  deps.showTyping();

  // 生图慢，先占一个「画布」，拿到地址再换成真图
  const holder = document.createElement('div');
  holder.className = 'msg-row msg-row--assistant';
  holder.innerHTML = `
    <div class="msg-avatar">${avatarHTML(
      deps.character.name || '未命名',
      36,
      deps.character.avatarKey,
      deps.character.avatarFrame,
      avatarDecorOf('wuli'),
    )}</div>
    <div class="msg-content">
      <div class="msg-image is-loading" data-image-slot>正在画…</div>
    </div>`;
  deps.list.append(holder);
  deps.scrollToBottom();

  try {
    const result = await callImage({ prompt }, deps.context);

    const slot = holder.querySelector<HTMLElement>('[data-image-slot]');
    if (slot) {
      slot.classList.remove('is-loading');
      slot.innerHTML = `<img src="${esc(result.url)}" alt="${esc(result.prompt)}" loading="lazy" />`;
    }

    const message: Message = {
      id: newId(),
      conversationId: deps.conversation.id,
      role: 'assistant',
      content: result.prompt,
      createdAt: new Date().toISOString(),
      extra: { imageUrl: result.url, rewritten: result.rewritten },
    };
    deps.messages.push(message);
    await putMessage(message);
    deps.conversation.updatedAt = Date.now();
    await putConversation(deps.conversation);

    // 模型改写过程序画师的提示词时，如实说一声
    if (result.rewritten) {
      const note = document.createElement('p');
      note.className = 'msg-image__note';
      note.textContent = '这幅画按改写后的描述画的。';
      holder.querySelector('.msg-content')?.append(note);
    }
    deps.scrollToBottom();
  } catch (error) {
    // 失败就把占位删掉 —— 留一个空画布比报错更让人困惑
    holder.remove();
    deps.showError(deps.describeError(error), error instanceof SetupError);
  } finally {
    deps.hideTyping();
    deps.setBusy(false);
    deps.sendButton.disabled = false;
  }
}

/** 读出来：读最后一条 AI 回复 */
export async function speakLast(deps: MediaDeps): Promise<void> {
  if (deps.isBusy()) return;

  const last = [...deps.messages].reverse().find((item) => item.role === 'assistant');
  if (!last?.content?.trim()) {
    deps.showError('还没有可以读的回复。', false);
    return;
  }

  deps.drawer.hidden = true;
  deps.setBusy(true);
  deps.showTyping();

  try {
    const blob = await callSpeech({ text: last.content }, deps.context);
    deps.hideTyping();

    // Blob URL 必须自己回收，否则每一次朗读都会漏一份内存
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    audio.onended = () => URL.revokeObjectURL(audioUrl);
    audio.onerror = () => URL.revokeObjectURL(audioUrl);
    await audio.play();
  } catch (error) {
    deps.hideTyping();
    deps.showError(deps.describeError(error), error instanceof SetupError);
  } finally {
    deps.setBusy(false);
  }
}
