import { deleteMoment, newId, putMoment } from '../../../core/db';
import { esc } from '../../../core/dom';
import { displayUserName, userAvatarKey } from '../../../core/prefs';
import type { Character, Moment } from '../../../core/types';
import { avatarHTML } from '../../../ui/avatar';
import { line } from '../../../ui/icons';
import { pickPhoto } from '../../../ui/photo-crop';
import { momentTime } from './moment-time';

/* ==========================================================================
   朋友圈

   结构照微信：一条条动态，左边头像，右边名字 + 正文 + 图 + 时间 + 赞/评论。
   风格照本项目：黑白灰、描边、不填色；卡片圆角用 QQ 那一档。

   为什么不做「封面图 + 我的头像」那块：
     微信放封面是为了展示个人形象，而本项目的「我」板块已经在做这件事了。
     一块假封面（没有真照片）只是多占 160px，把动态挤到折叠线以下。

   为什么一条动态最多 4 张图：
     图片以 data URL 直接存在记录里（和角色头像同一思路，不为图片建表）。
     9 张大图会让单条记录到几 MB，每次渲染都要整条读出来，
     低端机会明显卡。4 张（2×2 网格）是这个取舍下的上限，够用了。
   ========================================================================== */

/** 一条动态最多几张图 */
export const MAX_IMAGES = 4;

/** 作者 id 解析成人名 / 头像。'me' 走用户身份，其余走角色表 */
interface AuthorView {
  name: string;
  avatar: string;
}

function authorOf(authorId: string, characters: Map<string, Character>): AuthorView {
  if (authorId === 'me') {
    return {
      name: displayUserName(),
      avatar: avatarHTML(displayUserName(), 44, userAvatarKey()),
    };
  }
  const character = characters.get(authorId);
  if (!character) {
    // 角色被删了，动态还在 —— 不删用户的内容，只是名字说不出来了
    return { name: '已删除的角色', avatar: avatarHTML('?', 44) };
  }
  return {
    name: character.name || '未命名',
    avatar: avatarHTML(
      character.name || '未命名',
      44,
      character.avatarKey,
      character.avatarFrame,
    ),
  };
}

/** 图片网格：1 张放大，2/4 张两列，3 张三列 */
function imagesHTML(images: string[]): string {
  if (images.length === 0) return '';
  const count = Math.min(images.length, MAX_IMAGES);
  return `<div class="mo-images mo-images--${count}">${images
    .slice(0, count)
    .map(
      (src) =>
        `<span class="mo-images__item"><img src="${esc(src)}" alt="" loading="lazy" decoding="async"></span>`,
    )
    .join('')}</div>`;
}

/** 点赞那一行：谁赞了。人数多时后面加「等 N 人」 */
function likesHTML(likes: string[], characters: Map<string, Character>): string {
  if (likes.length === 0) return '';
  const names = likes.map((id) => authorOf(id, characters).name);
  const shown = names.slice(0, 4);
  const rest = names.length - shown.length;
  const text = rest > 0 ? `${shown.join('、')} 等 ${names.length} 人` : shown.join('、');
  return `<p class="mo-likes">${line('heart', 12)}<span>${esc(text)}</span></p>`;
}

function commentsHTML(
  moment: Moment,
  characters: Map<string, Character>,
): string {
  if (moment.comments.length === 0) return '';
  return `<div class="mo-comments">${moment.comments
    .map((comment) => {
      const name = authorOf(comment.authorId, characters).name;
      return `<p class="mo-comment"><span class="mo-comment__name">${esc(name)}</span>：${esc(comment.text)}</p>`;
    })
    .join('')}</div>`;
}

/** 整页 HTML。空状态由调用方处理 */
export function momentsViewHTML(
  moments: Moment[],
  characters: Map<string, Character>,
): string {
  return `<ul class="mo-list">${moments
    .map((moment) => {
      const author = authorOf(moment.authorId, characters);
      const liked = moment.likes.includes('me');
      const mine = moment.authorId === 'me';
      const social = likesHTML(moment.likes, characters) + commentsHTML(moment, characters);
      return `
        <li class="mo-item" data-mo-id="${esc(moment.id)}">
          <div class="mo-item__avatar">${author.avatar}</div>
          <div class="mo-item__main">
            <p class="mo-item__name">${esc(author.name)}</p>
            ${moment.text ? `<p class="mo-item__text">${esc(moment.text)}</p>` : ''}
            ${imagesHTML(moment.images)}
            <div class="mo-item__foot">
              <span class="mo-item__time">${esc(momentTime(moment.createdAt))}</span>
              <span class="mo-item__acts">
                <button class="mo-act${liked ? ' is-on' : ''}" type="button"
                        data-mo-like aria-pressed="${liked}">
                  ${line('heart', 14)}<span>${liked ? '已赞' : '赞'}</span>
                </button>
                <button class="mo-act" type="button" data-mo-comment>${line('chat', 14)}<span>评论</span></button>
                ${mine ? `<button class="mo-act mo-act--danger" type="button" data-mo-del>删除</button>` : ''}
              </span>
            </div>
            ${social ? `<div class="mo-social">${social}</div>` : ''}
            <div class="mo-comment-box" hidden>
              <input class="mo-comment-input" type="text" maxlength="60"
                     placeholder="说点什么…" spellcheck="false" autocomplete="off">
              <button class="mo-comment-send" type="button">发送</button>
            </div>
          </div>
        </li>`;
    })
    .join('')}</ul>`;
}

/**
 * 挂载朋友圈的交互。
 *
 * @param signal 页面切换时统一取消，避免 listener 越积越多
 *               （上一版「我」板块就是每次重画都往 body 上加一个，会泄漏）
 */
export function mountMomentsView(
  body: HTMLElement,
  moments: Moment[],
  onChange: () => void,
  signal: AbortSignal,
): void {
  /** 删除是两步：第一次点变成「确认删除」，3 秒内再点才真删 */
  let armedId = '';
  let armedTimer = 0;

  const resetArmed = (): void => {
    window.clearTimeout(armedTimer);
    armedId = '';
    body.querySelectorAll<HTMLElement>('[data-mo-del]').forEach((button) => {
      button.textContent = '删除';
      button.classList.remove('is-armed');
    });
  };

  const momentOf = (element: HTMLElement): Moment | undefined => {
    const id = element.closest<HTMLElement>('[data-mo-id]')?.dataset.moId;
    return id ? moments.find((item) => item.id === id) : undefined;
  };

  body.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement;

      /* 点赞：再点一次取消 */
      const likeBtn = target.closest<HTMLElement>('[data-mo-like]');
      if (likeBtn) {
        const moment = momentOf(likeBtn);
        if (!moment) return;
        const next = moment.likes.includes('me')
          ? moment.likes.filter((id) => id !== 'me')
          : [...moment.likes, 'me'];
        void putMoment({ ...moment, likes: next }).then(onChange);
        return;
      }

      /* 评论：就地展开一个输入行，不弹面板 */
      const commentBtn = target.closest<HTMLElement>('[data-mo-comment]');
      if (commentBtn) {
        const item = commentBtn.closest<HTMLElement>('[data-mo-id]');
        const box = item?.querySelector<HTMLElement>('.mo-comment-box');
        const input = box?.querySelector<HTMLInputElement>('.mo-comment-input');
        if (!box || !input) return;
        box.hidden = false;
        input.focus();
        return;
      }

      /* 评论发送 */
      const sendBtn = target.closest<HTMLElement>('.mo-comment-send');
      if (sendBtn) {
        const item = sendBtn.closest<HTMLElement>('[data-mo-id]');
        const moment = item ? momentOf(item) : undefined;
        const input = item?.querySelector<HTMLInputElement>('.mo-comment-input');
        const text = input?.value.trim() ?? '';
        if (!moment || !text) {
          input?.focus();
          return;
        }
        void putMoment({
          ...moment,
          comments: [
            ...moment.comments,
            { id: newId(), authorId: 'me', text, createdAt: Date.now() },
          ],
        }).then(onChange);
        return;
      }

      /* 删除：两步确认 */
      const delBtn = target.closest<HTMLElement>('[data-mo-del]');
      if (delBtn) {
        const moment = momentOf(delBtn);
        if (!moment) return;
        if (armedId !== moment.id) {
          resetArmed();
          armedId = moment.id;
          delBtn.textContent = '确认删除';
          delBtn.classList.add('is-armed');
          armedTimer = window.setTimeout(resetArmed, 3000);
          return;
        }
        resetArmed();
        void deleteMoment(moment.id).then(onChange);
      }
    },
    { signal },
  );

  /* 评论框里按回车直接发。用 keydown 而不是 form —— 这里不需要表单语义 */
  body.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter') return;
      const input = event.target as HTMLElement;
      if (!input.classList.contains('mo-comment-input')) return;
      event.preventDefault();
      input.closest<HTMLElement>('[data-mo-id]')
        ?.querySelector<HTMLElement>('.mo-comment-send')
        ?.click();
    },
    { signal },
  );
}

/* ==========================================================================
   发表动态
   ========================================================================== */

/**
 * 打开发表面板。
 *
 * 没有「保存草稿」—— 一条动态写一半关掉就是不要了，
 * 留草稿反而要多一套清理逻辑。
 */
export function openMomentComposer(onPublished: () => void): Promise<void> {
  return new Promise((resolve) => {
    let images: string[] = [];
    let closed = false;

    const root = document.createElement('div');
    root.className = 'mo-sheet';
    root.innerHTML = `
      <div class="mo-sheet__mask" data-cancel></div>
      <div class="mo-sheet__panel" role="dialog" aria-modal="true" aria-label="发表动态">
        <div class="mo-sheet__grip"></div>
        <header class="mo-sheet__head">
          <h2 class="mo-sheet__title">发表动态</h2>
          <button class="mo-sheet__close" type="button" data-cancel aria-label="关闭">✕</button>
        </header>
        <div class="mo-sheet__body">
          <label class="field">
            <span class="field__label">这一刻的想法</span>
            <textarea class="input textarea mo-sheet__input" rows="4" maxlength="300"
                      spellcheck="false" placeholder="说点什么…"></textarea>
            <span class="field__hint">最多 300 字，也可以只发图。</span>
          </label>
          <div class="mo-sheet__images" id="mo-images"></div>
          <button class="mo-sheet__add" type="button" id="mo-add">＋ 加图</button>
        </div>
        <footer class="mo-sheet__foot">
          <button class="btn btn--primary jelly" type="button" id="mo-publish" disabled>发表</button>
        </footer>
      </div>`;

    const input = root.querySelector<HTMLTextAreaElement>('.mo-sheet__input');
    const imagesBox = root.querySelector<HTMLElement>('#mo-images');
    const addBtn = root.querySelector<HTMLButtonElement>('#mo-add');
    const publishBtn = root.querySelector<HTMLButtonElement>('#mo-publish');

    /** 只有文字或图至少有一个，才让发表 */
    const syncPublish = (): void => {
      if (!publishBtn) return;
      publishBtn.disabled = !(input?.value.trim() || images.length > 0);
    };

    const paintImages = (): void => {
      if (!imagesBox) return;
      imagesBox.innerHTML = images
        .map(
          (src, index) => `
          <button class="mo-thumb" type="button" data-remove="${index}" aria-label="移除第 ${index + 1} 张图">
            <img src="${esc(src)}" alt="">
            <span class="mo-thumb__x">✕</span>
          </button>`,
        )
        .join('');
      if (addBtn) addBtn.hidden = images.length >= MAX_IMAGES;
      syncPublish();
    };

    const finish = (): void => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      root.classList.remove('is-open');
      window.setTimeout(() => {
        root.remove();
        resolve();
      }, 200);
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish();
    };

    root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-cancel]')) {
        finish();
        return;
      }

      const removeBtn = target.closest<HTMLElement>('[data-remove]');
      if (removeBtn) {
        const index = Number(removeBtn.dataset.remove);
        images = images.filter((_, i) => i !== index);
        paintImages();
        return;
      }

      if (target.closest('#mo-add')) {
        void (async () => {
          const photo = await pickPhoto();
          if (!photo || images.length >= MAX_IMAGES) return;
          images = [...images, photo.dataUrl];
          paintImages();
        })();
        return;
      }

      if (target.closest('#mo-publish')) {
        const text = input?.value.trim() ?? '';
        if (!text && images.length === 0) return;
        void (async () => {
          await putMoment({
            id: newId(),
            authorId: 'me',
            text,
            images,
            createdAt: Date.now(),
            likes: [],
            comments: [],
          });
          onPublished();
          finish();
        })();
      }
    });

    input?.addEventListener('input', syncPublish);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(root);
    requestAnimationFrame(() => {
      root.classList.add('is-open');
      input?.focus();
    });
  });
}
