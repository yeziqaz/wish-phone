import { esc } from '../../core/dom';
import type { PhotoRatio } from '../../core/types';

/**
 * 角色照片：选图 → 裁切 → 存成 data URL。
 *
 * 为什么用 data URL 而不是 Blob 表：
 *   第一版只有角色头像这一个地方要存图，data URL 直接跟着角色记录走，
 *   导出导入角色时也不会漏。等图多了（比如相册/朋友圈）再搬去独立的 assets 表。
 *
 * 裁切用的坐标：
 *   stage 是可见的取景框，img 用 transform 平移缩放。
 *   tx / ty 是图片左上角相对取景框的偏移（CSS 像素），scale 是总缩放。
 *   导出时把可见区域换算回原图坐标就行。
 */

export type { PhotoRatio };

export interface PhotoResult {
  dataUrl: string;
  ratio: PhotoRatio;
}

const RATIOS: Record<PhotoRatio, [number, number]> = {
  '1:1': [1, 1],
  '3:4': [3, 4],
  '4:3': [4, 3],
  '9:16': [9, 16],
};

const OUT_LONG_SIDE = 768;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** 让用户选一张图，然后裁。取消返回 null */
export function pickPhoto(): Promise<PhotoResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);

    const finish = (result: PhotoResult | null): void => {
      input.remove();
      resolve(result);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      const url = URL.createObjectURL(file);
      void openCropper(url)
        .then((result) => {
          URL.revokeObjectURL(url);
          finish(result);
        })
        .catch(() => {
          URL.revokeObjectURL(url);
          finish(null);
        });
    });

    input.addEventListener('cancel', () => finish(null));
    input.click();
  });
}

async function openCropper(url: string): Promise<PhotoResult | null> {
  const root = document.createElement('div');
  root.className = 'crop';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '调整照片');

  root.innerHTML = `
    <header class="crop__bar">
      <button class="crop__btn" type="button" data-cancel>取消</button>
      <span class="crop__title">调整照片</span>
      <button class="crop__btn crop__btn--ok" type="button" data-ok>完成</button>
    </header>
    <div class="crop__wrap">
      <div class="crop__stage" id="crop-stage">
        <img class="crop__img" alt="" draggable="false">
      </div>
    </div>
    <div class="crop__ratios" role="group" aria-label="照片比例">
      ${(Object.keys(RATIOS) as PhotoRatio[])
        .map(
          (ratio) =>
            `<button class="crop__ratio" type="button" data-ratio="${ratio}"
                     aria-pressed="${ratio === '1:1'}">${ratio}</button>`,
        )
        .join('')}
    </div>
    <label class="crop__zoom">
      <span class="crop__zoom-label">缩放</span>
      <input class="crop__range" type="range" min="100" max="300" value="100" aria-label="缩放照片">
    </label>
    <p class="crop__hint">拖动照片调整位置，拉下面滑块放大</p>`;

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.appendChild(root);

  const stage = root.querySelector<HTMLElement>('#crop-stage');
  const image = root.querySelector<HTMLImageElement>('.crop__img');
  const rate = root.querySelector<HTMLInputElement>('.crop__range');
  if (!stage || !image || !rate) {
    root.remove();
    document.body.style.overflow = previousOverflow;
    return null;
  }

  image.src = url;
  await image.decode().catch(() => undefined);

  const iw = image.naturalWidth || 1;
  const ih = image.naturalHeight || 1;

  let ratio: PhotoRatio = '1:1';
  let zoom = 1;
  let width = 1;
  let height = 1;
  let baseScale = 1;
  let scale = 1;
  let tx = 0;
  let ty = 0;

  const layout = (): void => {
    const wrap = root.querySelector<HTMLElement>('.crop__wrap');
    if (!wrap) return;
    const [rw, rh] = RATIOS[ratio];
    const ratioValue = rw / rh;
    const availW = Math.max(120, wrap.clientWidth - 32);
    const availH = Math.max(120, wrap.clientHeight - 32);

    if (availW / availH > ratioValue) {
      height = availH;
      width = Math.round(height * ratioValue);
    } else {
      width = availW;
      height = Math.round(width / ratioValue);
    }
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    stage.style.setProperty('aspect-ratio', `${rw} / ${rh}`);

    baseScale = Math.max(width / iw, height / ih);
    scale = baseScale * zoom;
    tx = (width - iw * scale) / 2;
    ty = (height - ih * scale) / 2;
    paint();
  };

  const clampOffset = (): void => {
    tx = clamp(tx, width - iw * scale, 0);
    ty = clamp(ty, height - ih * scale, 0);
  };

  const paint = (): void => {
    image.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
  };

  const zoomTo = (next: number, px = width / 2, py = height / 2): void => {
    const beforeX = (px - tx) / scale;
    const beforeY = (py - ty) / scale;
    zoom = clamp(next, 1, 3);
    scale = baseScale * zoom;
    tx = px - beforeX * scale;
    ty = py - beforeY * scale;
    clampOffset();
    paint();
  };

  /* ---------- 拖动 ---------- */
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let fromX = 0;
  let fromY = 0;
  let pointerId = -1;

  stage.addEventListener('pointerdown', (event) => {
    dragging = true;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    fromX = tx;
    fromY = ty;
    stage.setPointerCapture(pointerId);
  });

  stage.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    tx = fromX + (event.clientX - startX);
    ty = fromY + (event.clientY - startY);
    clampOffset();
    paint();
  });

  const endDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    if (pointerId >= 0 && stage.hasPointerCapture(pointerId)) {
      stage.releasePointerCapture(pointerId);
    }
    pointerId = -1;
  };

  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  /* 桌面滚动缩放 */
  stage.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoomTo(zoom * (event.deltaY < 0 ? 1.08 : 0.92), event.clientX - rect.left, event.clientY - rect.top);
      rate.value = String(Math.round(zoom * 100));
    },
    { passive: false },
  );

  /* ---------- 比例 ---------- */
  root.querySelectorAll<HTMLElement>('[data-ratio]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = (button.dataset.ratio as PhotoRatio | undefined) ?? '1:1';
      if (!(next in RATIOS) || next === ratio) return;
      ratio = next;
      zoom = 1;
      rate.value = '100';
      root.querySelectorAll<HTMLElement>('[data-ratio]').forEach((item) => {
        item.setAttribute('aria-pressed', String(item === button));
      });
      void frame().then(layout);
    });
  });

  rate.addEventListener('input', () => {
    zoomTo(Number(rate.value) / 100);
  });

  /* ---------- 关闭 / 导出 ---------- */
  const close = (result: PhotoResult | null): void => {
    root.remove();
    document.body.style.overflow = previousOverflow;
    resolveClose(result);
  };

  let resolveClose: (result: PhotoResult | null) => void = () => undefined;
  const done = new Promise<PhotoResult | null>((resolve) => {
    resolveClose = resolve;
  });

  root.querySelector<HTMLElement>('[data-cancel]')?.addEventListener('click', () => close(null));

  root.querySelector<HTMLElement>('[data-ok]')?.addEventListener('click', () => {
    const [rw, rh] = RATIOS[ratio];
    const long = OUT_LONG_SIDE;
    const outW = rw >= rh ? long : Math.round((long * rw) / rh);
    const outH = rh >= rw ? long : Math.round((long * rh) / rw);

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const context = canvas.getContext('2d');
    if (!context) {
      close(null);
      return;
    }

    // 取景框里看到的那一块，换算回原图坐标
    const sw = width / scale;
    const sh = height / scale;
    const sx = clamp(-tx / scale, 0, Math.max(0, iw - sw));
    const sy = clamp(-ty / scale, 0, Math.max(0, ih - sh));

    context.drawImage(image, sx, sy, sw, sh, 0, 0, outW, outH);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    close({ dataUrl, ratio });
  });

  await frame();
  layout();

  return done;
}

/** 给「选择照片」按钮用的占位提示。esc 一下，避免名字里带引号 */
export function photoAlt(name: string): string {
  return esc(`${name || '角色'}的照片`);
}
