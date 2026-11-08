import {
  getCharacter,
  getWorld,
  listBranches,
  listWorldbooks,
  newId,
  putCharacter,
} from '../../core/db';
import { esc, find, must } from '../../core/dom';
import { ensureWorlds, resolveBranch } from '../../core/worlds';
import type { Character, CharacterPhoto } from '../../core/types';
import { avatarImage } from '../../ui/avatar';
import { line } from '../../ui/icons';
import { blankCharacter } from './shared';
import { pickPhoto } from './photo-crop';
import './characters.css';

/* ==========================================================================
   角色档案（编辑）

   版面（用户 2026-10-31 晚定）：
     人物形象参考（可多张，左滑切换）→ 名字 / 关系 / 小世界
     → 基本信息 + 人设（合成一块）
     → 更多设置（默认收起：开场白、示例对话）
     → 保存

   照片不是「头像」，是给生图/视频用的形象参考；第一张顺手当列表头像。
   备注栏已按用户要求删掉。
   ========================================================================== */

/** 老数据只有一张 avatarKey，这里补成 photos 数组 */
function characterPhotos(character: Character): CharacterPhoto[] {
  if (character.photos && character.photos.length > 0) {
    return character.photos.map((photo) => ({ ...photo }));
  }
  if (character.avatarKey) {
    return [
      {
        id: 'legacy-photo',
        src: character.avatarKey,
        ratio: character.photoRatio ?? '1:1',
        prompt: '',
      },
    ];
  }
  return [];
}

function openingRowHTML(value: string, index: number): string {
  return `
    <div class="opening" data-opening-row>
      <div class="opening__head">
        <span class="opening__label">开场白 ${index + 1}</span>
        <button class="opening__del" type="button" data-remove-opening
                aria-label="删除这个开场白">${line('trash', 16)}</button>
      </div>
      <textarea class="input textarea" data-opening rows="4"
                placeholder="第一次聊天时，从这句话或这个场景开始">${esc(value)}</textarea>
    </div>`;
}

function collectOpenings(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLTextAreaElement>('[data-opening]')]
    .map((area) => area.value)
    .filter((value) => value.trim().length > 0);
}

export async function mountCharacterEdit(root: HTMLElement, id: string): Promise<void> {
  let character: Character;

  if (id === 'new') {
    character = blankCharacter();
    // 新角色落在当前小世界 + 当前时间线
    const world = await ensureWorlds();
    const branch = await resolveBranch(world);
    character.worldId = world.id;
    character.branchId = branch?.id;
  } else {
    const found = await getCharacter(id);
    if (!found) {
      root.innerHTML = `
        <div class="page">
          <header class="topbar">
            <button class="topbar__back jelly" type="button" data-go="/character" aria-label="返回">${line('back', 22)}</button>
            <h1 class="topbar__title">找不到</h1>
          </header>
          <p class="field__note">这个角色已经不在了，可能刚被删掉。</p>
        </div>`;
      return;
    }
    character = found;
  }

  const isNew = id === 'new';
  const world = character.worldId ? await getWorld(character.worldId) : undefined;
  const branches = world ? await listBranches(world.id) : [];
  const branch = branches.find((b) => b.id === character.branchId);

  const books = await listWorldbooks();
  const mounted = new Set(character.worldbookIds ?? []);

  const openings =
    [character.firstMes, ...character.alternateGreetings].filter((text) => text.trim().length > 0);
  const openingRows = openings.length > 0 ? openings : [''];

  const persona = [character.description, character.personality, character.scenario]
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join('\n\n');

  const shortId = character.id.replace(/-/g, '').slice(0, 6).toUpperCase();
  const worldLine = world
    ? `${esc(world.name)}${branch ? ` · ${esc(branch.name)}` : ''}`
    : '小世界1 · 主线';

  let photos = characterPhotos(character);
  let current = 0;

  root.innerHTML = `
    <div class="page page--dossier">
      <header class="topbar">
        <button class="topbar__back jelly" type="button" data-go="/character" aria-label="返回">${line('back', 22)}</button>
        <h1 class="topbar__title">角色档案</h1>
        ${isNew ? '' : `<button class="topbar__action jelly" type="button" data-go="/chat/${esc(character.id)}"
                aria-label="和 TA 聊天">${line('chat', 22)}</button>`}
      </header>

      <section class="gallery">
        <div class="gallery__track" id="c-track"></div>
        <div class="gallery__bar">
          <span class="gallery__count" id="c-gallery-count"></span>
          <div class="gallery__actions">
            <button class="gallery__prompt-toggle" type="button" id="c-prompt-toggle"
                    aria-expanded="false">提示词</button>
            <button class="gallery__add" type="button" id="c-add-photo">＋ 加照片</button>
          </div>
        </div>
        <div class="gallery__prompt" id="c-photo-prompt-box" hidden>
          <label class="field">
            <span class="field__label">这张图的提示词（生图用，可空）</span>
            <textarea class="input textarea" id="c-photo-prompt" rows="2"
                      spellcheck="false"
                      placeholder="比如：白色小狐狸，粉色耳尖，Q 版手绘，柔光"></textarea>
          </label>
          <button class="gallery__remove" type="button" id="c-remove-photo">删除这张</button>
        </div>
      </section>

      <section class="dossier">
        <div class="dossier__info">
          <p class="dossier__id">CHAR-${shortId}</p>
          <h2 class="dossier__name" id="c-title">${esc(character.name || '未命名')}</h2>
          <p class="dossier__relation" id="c-relation-line">
            ${esc(character.relationToUser?.trim() || '还没写和你的关系')}
          </p>
          <p class="dossier__world">${worldLine}</p>
          ${world ? `<button class="dossier__link" type="button" data-go="/world/${esc(world.id)}">小世界设定</button>` : ''}
        </div>
      </section>

      <section class="fold">
        <button class="fold__head" type="button" data-fold aria-expanded="true">
          基本信息<span class="fold__chevron">${line('chevron', 16)}</span>
        </button>
        <div class="fold__body">
          <label class="field">
            <span class="field__label">姓名</span>
            <input class="input" id="c-name" type="text" autocomplete="off"
                   spellcheck="false" value="${esc(character.name)}" placeholder="角色叫什么">
          </label>

          <div class="field-row">
            <label class="field">
              <span class="field__label">昵称</span>
              <input class="input" id="c-nickname" type="text" autocomplete="off"
                     spellcheck="false" value="${esc(character.nickname ?? '')}" placeholder="小名 / 外号">
            </label>
            <label class="field">
              <span class="field__label">和我的关系</span>
              <input class="input" id="c-relation" type="text" autocomplete="off"
                     spellcheck="false" value="${esc(character.relationToUser ?? '')}"
                     placeholder="男朋友 / 哥哥 / 同事">
            </label>
          </div>

          <label class="field">
            <span class="field__label">人设</span>
            <textarea class="input textarea" id="c-persona" rows="10"
                      spellcheck="false"
                      placeholder="先写人物信息：长什么样、什么身份、经历过什么。&#10;&#10;换行写性格：几个词或几句话。&#10;&#10;再换行写场景：你们在哪儿、怎么认识的。">${esc(persona)}</textarea>
            <span class="field__hint">一段就行，用空行分成人物信息 / 性格 / 场景三段。这段会进提示词。</span>
          </label>
        </div>
      </section>

      <section class="fold">
        <button class="fold__head" type="button" data-fold aria-expanded="false">
          世界书<span class="fold__chevron">${line('chevron', 16)}</span>
        </button>
        <div class="fold__body" hidden>
          ${
            books.length === 0
              ? `<p class="field__hint">还没有世界书。写一本「提到什么才补上什么」的设定，再回来挂上。</p>
                 <button class="btn" type="button" data-go="/settings/lore">去写一本</button>`
              : `<p class="field__hint">挂上的书<strong>只对这个角色生效</strong>。没挂就不进提示词。</p>
                 <div class="book-pick">
                   ${books
                     .map(
                       (book) => `
                     <label class="nav-item">
                       <span class="nav-item__text">
                         <span class="nav-item__title">${esc(book.name)}</span>
                         <span class="nav-item__sub">${book.entries.length} 个条目${book.note.trim() ? ` · ${esc(book.note)}` : ''}</span>
                       </span>
                       <span class="nav-item__tail">
                         <span class="switch">
                           <input type="checkbox" data-book="${esc(book.id)}" ${mounted.has(book.id) ? 'checked' : ''}>
                           <span class="switch__track"></span>
                         </span>
                       </span>
                     </label>`,
                     )
                     .join('')}
                 </div>
                 <button class="btn" type="button" data-go="/settings/lore">管理世界书</button>`
          }
        </div>
      </section>

      <section class="fold">
        <button class="fold__head" type="button" data-fold aria-expanded="false">
          更多设置<span class="fold__chevron">${line('chevron', 16)}</span>
        </button>
        <div class="fold__body" hidden>
          <p class="field__hint">不写开场白也行。写多个就是从不同情景开始，像 IF 线。</p>
          <div class="opening-list" id="c-openings">
            ${openingRows.map((text, index) => openingRowHTML(text, index)).join('')}
          </div>
          <button class="btn" type="button" id="c-add-opening">＋ 加一个开场白</button>

          <label class="field opening__example">
            <span class="field__label">示例对话</span>
            <textarea class="input textarea" id="c-mesexample" rows="5"
                      spellcheck="false"
                      placeholder="给模型看的说话风格示范。不同例子之间用 &lt;START&gt; 隔开">${esc(character.mesExample)}</textarea>
            <span class="field__hint">可选。写几轮示范能明显改善说话口气。</span>
          </label>
        </div>
      </section>

      <div class="row-actions row-actions--main">
        <button class="btn btn--primary jelly" type="button" id="c-save">
          ${isNew ? '创建' : '保存'}
        </button>
      </div>
      <p class="field__note" id="c-save-result"></p>
    </div>`;

  /* ---------- 人物形象参考：多张、左滑切换 ---------- */
  const track = must<HTMLElement>(root, '#c-track');
  const countLabel = must<HTMLElement>(root, '#c-gallery-count');
  const promptInput = must<HTMLTextAreaElement>(root, '#c-photo-prompt');
  const removeButton = must<HTMLButtonElement>(root, '#c-remove-photo');
  const promptBox = must<HTMLElement>(root, '#c-photo-prompt-box');
  const promptToggle = must<HTMLButtonElement>(root, '#c-prompt-toggle');

  const syncGallery = (): void => {
    const photo = photos[current];
    const total = photos.length;
    countLabel.textContent =
      total === 0
        ? '还没有照片'
        : total === 1
          ? '1 / 1'
          : `${current + 1} / ${total} · 左滑看下一张`;
    promptInput.value = photo?.prompt ?? '';
    promptInput.disabled = !photo;
    removeButton.disabled = !photo;
    promptToggle.disabled = !photo;
    if (total === 0) {
      promptBox.hidden = true;
      promptToggle.setAttribute('aria-expanded', 'false');
    }
  };

  const renderTrack = (): void => {
    if (photos.length === 0) {
      track.innerHTML = `
        <div class="gallery__slide gallery__slide--empty">
          <span>放一张人物参考图</span>
        </div>`;
      syncGallery();
      return;
    }

    track.innerHTML = photos
      .map((photo, index) => {
        const src = avatarImage(photo.src);
        return `
          <figure class="gallery__slide" data-photo-index="${index}">
            <img src="${esc(src ?? '')}" alt="人物形象参考 ${index + 1}">
          </figure>`;
      })
      .join('');

    syncGallery();
    // 重建后滚回当前这张（不用 scrollTo，老 WebView 上也有兼容问题）
    requestAnimationFrame(() => {
      track.scrollLeft = track.clientWidth * current;
    });
  };

  track.addEventListener('scroll', () => {
    if (photos.length === 0) return;
    const width = track.clientWidth || 1;
    const next = Math.min(photos.length - 1, Math.max(0, Math.round(track.scrollLeft / width)));
    if (next === current) return;
    current = next;
    syncGallery();
  });

  promptToggle.addEventListener('click', () => {
    promptBox.hidden = !promptBox.hidden;
    promptToggle.setAttribute('aria-expanded', String(!promptBox.hidden));
  });

  promptInput.addEventListener('input', () => {
    const photo = photos[current];
    if (photo) photo.prompt = promptInput.value;
  });

  must(root, '#c-add-photo').addEventListener('click', () => {
    void (async () => {
      const result = await pickPhoto();
      if (!result) return;
      photos.push({
        id: newId(),
        src: result.dataUrl,
        ratio: result.ratio,
        prompt: '',
      });
      current = photos.length - 1;
      renderTrack();
    })();
  });

  removeButton.addEventListener('click', () => {
    if (photos.length === 0) return;
    photos.splice(current, 1);
    current = Math.max(0, Math.min(current, photos.length - 1));
    renderTrack();
  });

  renderTrack();

  /* ---------- 实时同步名字和关系 ---------- */
  const nameInput = must<HTMLInputElement>(root, '#c-name');
  const relationInput = must<HTMLInputElement>(root, '#c-relation');

  nameInput.addEventListener('input', () => {
    must<HTMLElement>(root, '#c-title').textContent = nameInput.value.trim() || '未命名';
  });

  relationInput.addEventListener('input', () => {
    must<HTMLElement>(root, '#c-relation-line').textContent =
      relationInput.value.trim() || '还没写和你的关系';
  });

  /* ---------- 开场白：加 / 删 / 重新编号 ---------- */
  const openingList = must<HTMLElement>(root, '#c-openings');

  const renumber = (): void => {
    openingList.querySelectorAll<HTMLElement>('[data-opening-row]').forEach((row, index) => {
      const label = row.querySelector<HTMLElement>('.opening__label');
      if (label) label.textContent = `开场白 ${index + 1}`;
    });
  };

  openingList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-remove-opening]');
    if (!button) return;
    const row = button.closest<HTMLElement>('[data-opening-row]');
    if (!row) return;
    row.remove();
    if (openingList.querySelectorAll('[data-opening-row]').length === 0) {
      openingList.innerHTML = openingRowHTML('', 0);
    }
    renumber();
  });

  must(root, '#c-add-opening').addEventListener('click', () => {
    const count = openingList.querySelectorAll('[data-opening-row]').length;
    openingList.insertAdjacentHTML('beforeend', openingRowHTML('', count));
    const added = openingList.lastElementChild?.querySelector<HTMLTextAreaElement>('[data-opening]');
    added?.focus();
  });

  /* ---------- 折叠卡片 ---------- */
  root.querySelectorAll<HTMLElement>('[data-fold]').forEach((head) => {
    head.addEventListener('click', () => {
      const expanded = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', String(!expanded));
      const body = head.nextElementSibling;
      if (body instanceof HTMLElement) body.hidden = expanded;
    });
  });

  /* ---------- 保存 ---------- */
  const read = (selector: string): string =>
    find<HTMLTextAreaElement | HTMLInputElement>(root, selector)?.value ?? '';

  must(root, '#c-save').addEventListener('click', () => {
    void (async () => {
      const result = must<HTMLElement>(root, '#c-save-result');

      const name = nameInput.value.trim();
      if (!name) {
        result.textContent = '名字不能空着。';
        result.className = 'field__note is-bad';
        return;
      }

      const openingValues = collectOpenings(root);

      // 当前这张的提示词以输入框为准（防止有输入事件没接住）
      const activePhoto = photos[current];
      if (activePhoto) activePhoto.prompt = promptInput.value;

      character.name = name;
      character.nickname = read('#c-nickname').trim();
      character.relationToUser = relationInput.value.trim();
      character.description = read('#c-persona');
      // 人设合成一段了，旧的两个字段不再单独维护
      character.personality = '';
      character.scenario = '';
      character.firstMes = openingValues[0] ?? '';
      character.alternateGreetings = openingValues.slice(1);
      character.mesExample = read('#c-mesexample');
      character.worldbookIds = [
        ...root.querySelectorAll<HTMLInputElement>('[data-book]'),
      ]
        .filter((box) => box.checked)
        .map((box) => box.dataset.book ?? '')
        .filter((bookId) => bookId.length > 0);
      character.updatedAt = Date.now();

      character.photos = photos;
      character.avatarKey = photos[0]?.src;
      character.photoRatio = photos[0]?.ratio ?? '1:1';

      try {
        await putCharacter(character);
        if (isNew) {
          location.hash = `/character/${character.id}`;
          return;
        }
        result.textContent = '已保存。';
        result.className = 'field__note is-ok';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.textContent = `保存失败：${message}`;
        result.className = 'field__note is-bad';
      }
    })();
  });
}
