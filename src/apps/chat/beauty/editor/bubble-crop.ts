import { esc } from '../../../../core/dom';
import type { BubbleShape } from '../model';

/* ==========================================================================
   自定义截图气泡裁剪器

   用户流程：
     在别的软件发一句话 → 截图 → 选图导入
     → 单指拖图、双指捏合缩放，把气泡移到框内
     → 拖动白框四角自由调整裁切框宽高，避开旁边的头像和多余聊天记录
     → 单独拖动四条虚线避开圆角和小尾巴（支持回退 / 重置 / 左右翻转）
     → 实时看九宫格拉长效果 → 确认导入。
   ========================================================================== */

export interface CustomBubbleResult {
  dataUrl: string;
  name: string;
  bubbleShape: Omit<BubbleShape, 'shapeId'>;
}

type GuideEdge = 't' | 'r' | 'b' | 'l';
type BoxCorner = 'nw' | 'ne' | 'sw' | 'se';

interface CropSnapshot {
  width: number;
  height: number;
  zoom: number;
  tx: number;
  ty: number;
  topPx: number;
  rightPx: number;
  bottomPx: number;
  leftPx: number;
  flipped: boolean;
}

const OUT_LONG_SIDE = 420;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 6;
const DEFAULT_GUIDE_V = 18;
const DEFAULT_GUIDE_H = 28;
const MIN_GUIDE_PAD = 6;
const MIN_GUIDE_GAP = 12;
const MIN_BOX_W = 76;
const MIN_BOX_H = 44;
const WRAP_PAD = 16;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number): string => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function autoInkForHex(hex: string): string {
  const m = /^#([\da-f]{2})([\da-f]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return '#111114';
  const ch = (s: string): number => {
    const c = parseInt(s, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * ch(m[1]!) + 0.7152 * ch(m[2]!) + 0.0722 * ch(m[3]!);
  return lum > 0.55 ? '#111114' : '#FFFFFF';
}

/** 采样中心安全区边缘像素的中位数，用于自动擦除原截图中的文字 */
function sampleInteriorColor(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sliceT: number,
  sliceR: number,
  sliceB: number,
  sliceL: number,
): string {
  const x0 = clamp(sliceL + 4, 0, Math.max(0, w - 1));
  const x1 = clamp(w - sliceR - 4, x0 + 1, w);
  const y0 = clamp(sliceT + 4, 0, Math.max(0, h - 1));
  const y1 = clamp(h - sliceB - 4, y0 + 1, h);

  const img = ctx.getImageData(0, 0, w, h).data;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  const pushAt = (x: number, y: number): void => {
    const idx = (y * w + x) * 4;
    if ((img[idx + 3] ?? 0) < 30) return;
    rs.push(img[idx] ?? 255);
    gs.push(img[idx + 1] ?? 255);
    bs.push(img[idx + 2] ?? 255);
  };

  const stepX = Math.max(1, Math.floor((x1 - x0) / 12));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 8));
  for (let x = x0; x < x1; x += stepX) {
    pushAt(x, y0);
    pushAt(x, Math.max(y0, y1 - 1));
  }
  for (let y = y0; y < y1; y += stepY) {
    pushAt(x0, y);
    pushAt(Math.max(x0, x1 - 1), y);
  }

  if (!rs.length) return '#FFFFFF';
  rs.sort((a, b) => a - b);
  gs.sort((a, b) => a - b);
  bs.sort((a, b) => a - b);
  const mid = Math.floor(rs.length / 2);
  return rgbToHex(rs[mid]!, gs[mid]!, bs[mid]!);
}

/** 让用户选一张气泡截图，缩放裁剪并生成九宫格气泡；取消返回 null */
export function pickCustomBubble(): Promise<CustomBubbleResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);

    const finish = (result: CustomBubbleResult | null): void => {
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
      void openBubbleCropper(url)
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

async function openBubbleCropper(url: string): Promise<CustomBubbleResult | null> {
  const root = document.createElement('div');
  root.className = 'crop bcrop';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '导入截图气泡');

  root.innerHTML = `
    <header class="crop__bar">
      <button class="crop__btn" type="button" data-cancel>取消</button>
      <span class="crop__title">导入截图气泡</span>
      <button class="crop__btn crop__btn--ok" type="button" data-ok>使用</button>
    </header>
    <p class="bcrop__guide">单指拖图 · 双指缩放 · 拖四角调框大小 · 拖虚线避开圆角尾巴</p>
    <div class="crop__wrap bcrop__wrap" id="bcrop-wrap">
      <div class="crop__stage bcrop__stage" id="bcrop-stage">
        <div class="bcrop__flip" id="bcrop-flip">
          <img class="crop__img" alt="" draggable="false">
        </div>
        <div class="bcrop__guides" id="bcrop-guides">
          <div class="bcrop__line bcrop__line--t" data-guide="t" role="slider" aria-label="上保护线">
            <span class="bcrop__handle"></span>
          </div>
          <div class="bcrop__line bcrop__line--b" data-guide="b" role="slider" aria-label="下保护线">
            <span class="bcrop__handle"></span>
          </div>
          <div class="bcrop__line bcrop__line--l" data-guide="l" role="slider" aria-label="左保护线">
            <span class="bcrop__handle"></span>
          </div>
          <div class="bcrop__line bcrop__line--r" data-guide="r" role="slider" aria-label="右保护线">
            <span class="bcrop__handle"></span>
          </div>
        </div>
        <button class="bcrop__corner bcrop__corner--nw" type="button" data-corner="nw" aria-label="调整左上角裁切框"></button>
        <button class="bcrop__corner bcrop__corner--ne" type="button" data-corner="ne" aria-label="调整右上角裁切框"></button>
        <button class="bcrop__corner bcrop__corner--sw" type="button" data-corner="sw" aria-label="调整左下角裁切框"></button>
        <button class="bcrop__corner bcrop__corner--se" type="button" data-corner="se" aria-label="调整右下角裁切框"></button>
      </div>
    </div>
    <div class="bcrop__panel">
      <div class="bcrop__toolbar">
        <span class="bcrop__size tabular" id="bcrop-size">240 × 100</span>
        <div class="bcrop__tools">
          <button class="bcrop__tool" type="button" data-flip aria-pressed="false">左右翻转</button>
          <button class="bcrop__tool" type="button" data-undo disabled>回退</button>
          <button class="bcrop__tool" type="button" data-reset>重置</button>
        </div>
      </div>
      <label class="crop__zoom">
        <span class="crop__zoom-label">缩放</span>
        <input class="crop__range" id="bcrop-zoom" type="range" min="35" max="600" value="100" aria-label="缩放截图">
      </label>
      <div class="bcrop__options">
        <label class="bcrop__check">
          <input type="checkbox" id="bcrop-erase" checked>
          <span>自动擦除原文字</span>
        </label>
        <label class="bcrop__color">
          <span>文字颜色</span>
          <input type="color" id="bcrop-ink" value="#111114" aria-label="气泡文字颜色">
        </label>
        <input class="input bcrop__name" id="bcrop-name" type="text" maxlength="20" value="截图气泡" placeholder="气泡名称">
      </div>
      <div class="bcrop__preview-wrap">
        <span class="bcrop__preview-label">效果预览</span>
        <span class="bcrop__preview-bubble" id="bcrop-preview">今天风好大，一起散步吗？</span>
      </div>
    </div>`;

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.appendChild(root);

  const wrap = root.querySelector<HTMLElement>('#bcrop-wrap');
  const stage = root.querySelector<HTMLElement>('#bcrop-stage');
  const flipEl = root.querySelector<HTMLElement>('#bcrop-flip');
  const image = root.querySelector<HTMLImageElement>('.crop__img');
  const zoomInput = root.querySelector<HTMLInputElement>('#bcrop-zoom');
  const eraseInput = root.querySelector<HTMLInputElement>('#bcrop-erase');
  const inkInput = root.querySelector<HTMLInputElement>('#bcrop-ink');
  const nameInput = root.querySelector<HTMLInputElement>('#bcrop-name');
  const guides = root.querySelector<HTMLElement>('#bcrop-guides');
  const previewEl = root.querySelector<HTMLElement>('#bcrop-preview');
  const sizeLabel = root.querySelector<HTMLElement>('#bcrop-size');
  const flipBtn = root.querySelector<HTMLButtonElement>('[data-flip]');
  const undoBtn = root.querySelector<HTMLButtonElement>('[data-undo]');
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-reset]');

  if (
    !wrap ||
    !stage ||
    !flipEl ||
    !image ||
    !zoomInput ||
    !eraseInput ||
    !inkInput ||
    !nameInput ||
    !guides ||
    !previewEl ||
    !sizeLabel ||
    !flipBtn ||
    !undoBtn ||
    !resetBtn
  ) {
    root.remove();
    document.body.style.overflow = previousOverflow;
    return null;
  }

  image.src = url;
  await image.decode().catch(() => undefined);

  const iw = image.naturalWidth || 1;
  const ih = image.naturalHeight || 1;

  let zoom = 1;
  let width = 220;
  let height = 96;
  let stageX = 0;
  let stageY = 0;
  let baseScale = 1;
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let topPx = DEFAULT_GUIDE_V;
  let rightPx = DEFAULT_GUIDE_H;
  let bottomPx = DEFAULT_GUIDE_V;
  let leftPx = DEFAULT_GUIDE_H;
  let flipped = false;
  let inkTouched = false;
  let previewTimer = 0;

  const history: CropSnapshot[] = [];

  const snapshot = (): CropSnapshot => ({
    width,
    height,
    zoom,
    tx,
    ty,
    topPx,
    rightPx,
    bottomPx,
    leftPx,
    flipped,
  });

  const syncUndoBtn = (): void => {
    undoBtn.disabled = history.length === 0;
  };

  const pushHistory = (): void => {
    const snap = snapshot();
    const prev = history.at(-1);
    if (
      prev &&
      Math.abs(prev.width - snap.width) < 1 &&
      Math.abs(prev.height - snap.height) < 1 &&
      Math.abs(prev.zoom - snap.zoom) < 0.005 &&
      Math.abs(prev.tx - snap.tx) < 0.5 &&
      Math.abs(prev.ty - snap.ty) < 0.5 &&
      Math.abs(prev.topPx - snap.topPx) < 0.5 &&
      Math.abs(prev.rightPx - snap.rightPx) < 0.5 &&
      Math.abs(prev.bottomPx - snap.bottomPx) < 0.5 &&
      Math.abs(prev.leftPx - snap.leftPx) < 0.5 &&
      prev.flipped === snap.flipped
    ) {
      return;
    }
    history.push(snap);
    if (history.length > 30) history.shift();
    syncUndoBtn();
  };

  const updateGuides = (): void => {
    guides.style.setProperty('--gt', `${topPx}px`);
    guides.style.setProperty('--gr', `${rightPx}px`);
    guides.style.setProperty('--gb', `${bottomPx}px`);
    guides.style.setProperty('--gl', `${leftPx}px`);
  };

  const updateFlipUI = (): void => {
    flipEl.style.transform = flipped ? 'scaleX(-1)' : '';
    flipBtn.setAttribute('aria-pressed', String(flipped));
  };

  const paintStage = (): void => {
    stage.style.left = `${stageX}px`;
    stage.style.top = `${stageY}px`;
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    sizeLabel.textContent = `${Math.round(width)} × ${Math.round(height)}`;
  };

  const centerStage = (): void => {
    stageX = Math.round((wrap.clientWidth - width) / 2);
    stageY = Math.round((wrap.clientHeight - height) / 2);
    paintStage();
  };

  const clampOffset = (): void => {
    const margin = 24;
    tx = clamp(tx, margin - iw * scale, width - margin);
    ty = clamp(ty, margin - ih * scale, height - margin);
  };

  const paint = (): void => {
    image.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
  };

  const renderExport = (
    forPreview: boolean,
  ): { dataUrl: string; shape: Omit<BubbleShape, 'shapeId'>; detectedInk: string } | null => {
    const long = forPreview ? 240 : OUT_LONG_SIDE;
    const ratio = width / Math.max(1, height);
    const outW = ratio >= 1 ? long : Math.max(40, Math.round(long * ratio));
    const outH = ratio < 1 ? long : Math.max(40, Math.round(long / ratio));

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const rx = outW / Math.max(1, width);
    const ry = outH / Math.max(1, height);

    ctx.clearRect(0, 0, outW, outH);
    ctx.save();
    if (flipped) {
      ctx.translate(outW, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(image, tx * rx, ty * ry, iw * scale * rx, ih * scale * ry);
    ctx.restore();

    const sliceT = clamp(Math.round(topPx * ry), 6, Math.floor(outH * 0.48));
    const sliceR = clamp(Math.round(rightPx * rx), 6, Math.floor(outW * 0.48));
    const sliceB = clamp(Math.round(bottomPx * ry), 6, Math.floor(outH * 0.48));
    const sliceL = clamp(Math.round(leftPx * rx), 6, Math.floor(outW * 0.48));

    const fillHex = sampleInteriorColor(ctx, outW, outH, sliceT, sliceR, sliceB, sliceL);

    if (eraseInput.checked) {
      const ix = sliceL + 2;
      const iy = sliceT + 2;
      const iwBox = Math.max(2, outW - ix - sliceR - 2);
      const ihBox = Math.max(2, outH - iy - sliceB - 2);
      ctx.fillStyle = fillHex;
      ctx.fillRect(ix, iy, iwBox, ihBox);
    }

    const detectedInk = autoInkForHex(fillHex);
    const ink = inkTouched ? inkInput.value : detectedInk;
    const bwT = clamp(Math.round(sliceT * 0.36), 8, 24);
    const bwR = clamp(Math.round(sliceR * 0.36), 8, 28);
    const bwB = clamp(Math.round(sliceB * 0.36), 8, 24);
    const bwL = clamp(Math.round(sliceL * 0.36), 8, 28);

    return {
      dataUrl: canvas.toDataURL('image/png'),
      detectedInk,
      shape: {
        slice: [sliceT, sliceR, sliceB, sliceL],
        width: [bwT, bwR, bwB, bwL],
        fillMode: 'stretch',
        ink: ink.toUpperCase(),
      },
    };
  };

  const refreshPreview = (): void => {
    const out = renderExport(true);
    if (!out) return;
    if (!inkTouched) inkInput.value = out.detectedInk;
    const slice = out.shape.slice.join(' ');
    const bw = out.shape.width.map((n) => `${n}px`).join(' ');
    previewEl.setAttribute(
      'style',
      [
        `color:${out.shape.ink ?? '#111114'}`,
        'background:transparent',
        'border-style:solid',
        'border-color:transparent',
        `border-width:${bw}`,
        `border-image:url("${out.dataUrl}") ${slice} fill / ${bw} stretch`,
        'border-radius:0',
      ].join(';'),
    );
  };

  const schedulePreview = (): void => {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(refreshPreview, 40);
  };

  const initLayout = (): void => {
    const availW = Math.max(120, wrap.clientWidth - WRAP_PAD * 2);
    const availH = Math.max(80, wrap.clientHeight - WRAP_PAD * 2);

    width = Math.min(availW, 260);
    height = clamp(Math.round(width * 0.44), MIN_BOX_H, availH);
    centerStage();

    baseScale = Math.max(width / iw, height / ih);
    scale = baseScale * zoom;
    tx = (width - iw * scale) / 2;
    ty = (height - ih * scale) / 2;
    paint();
    updateGuides();
    updateFlipUI();
    refreshPreview();
  };

  const zoomTo = (next: number, vx = width / 2, vy = height / 2): void => {
    const lx = flipped ? width - vx : vx;
    const beforeX = (lx - tx) / scale;
    const beforeY = (vy - ty) / scale;
    zoom = clamp(next, MIN_ZOOM, MAX_ZOOM);
    scale = baseScale * zoom;
    tx = lx - beforeX * scale;
    ty = vy - beforeY * scale;
    clampOffset();
    paint();
    zoomInput.value = String(Math.round(zoom * 100));
    schedulePreview();
  };

  /* ---------- 手势：单指拖动 + 双指直接捏合缩放 ---------- */
  const pointers = new Map<number, { x: number; y: number }>();
  let dragStart: { x: number; y: number; tx: number; ty: number } | null = null;
  let pinchStart: {
    dist: number;
    midX: number;
    midY: number;
    zoom: number;
    scale: number;
    tx: number;
    ty: number;
  } | null = null;

  const twoPoints = (): [{ x: number; y: number }, { x: number; y: number }] | null => {
    const list = [...pointers.values()];
    if (list.length < 2) return null;
    return [list[0]!, list[1]!];
  };

  const startPinch = (): void => {
    const pair = twoPoints();
    if (!pair) return;
    const [a, b] = pair;
    const rect = stage.getBoundingClientRect();
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const midX = (a.x + b.x) / 2 - rect.left;
    const midY = (a.y + b.y) / 2 - rect.top;
    pinchStart = { dist, midX, midY, zoom, scale, tx, ty };
    dragStart = null;
  };

  wrap.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-guide]') || target.closest('[data-corner]')) return;
    if (pointers.size === 0) pushHistory();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    wrap.setPointerCapture(event.pointerId);

    if (pointers.size === 1) {
      dragStart = { x: event.clientX, y: event.clientY, tx, ty };
      pinchStart = null;
    } else if (pointers.size === 2) {
      startPinch();
    }
  });

  wrap.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2 && pinchStart) {
      const pair = twoPoints();
      if (!pair) return;
      const [a, b] = pair;
      const rect = stage.getBoundingClientRect();
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;

      const lx0 = flipped ? width - pinchStart.midX : pinchStart.midX;
      const imgX = (lx0 - pinchStart.tx) / pinchStart.scale;
      const imgY = (pinchStart.midY - pinchStart.ty) / pinchStart.scale;

      zoom = clamp(pinchStart.zoom * (dist / pinchStart.dist), MIN_ZOOM, MAX_ZOOM);
      scale = baseScale * zoom;
      const lx1 = flipped ? width - midX : midX;
      tx = lx1 - imgX * scale;
      ty = midY - imgY * scale;
      clampOffset();
      paint();
      zoomInput.value = String(Math.round(zoom * 100));
      schedulePreview();
      return;
    }

    if (pointers.size === 1 && dragStart) {
      const dx = event.clientX - dragStart.x;
      const dy = event.clientY - dragStart.y;
      tx = dragStart.tx + (flipped ? -dx : dx);
      ty = dragStart.ty + dy;
      clampOffset();
      paint();
    }
  });

  const endPointer = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (wrap.hasPointerCapture(event.pointerId)) {
      wrap.releasePointerCapture(event.pointerId);
    }
    if (pointers.size === 1) {
      const rest = [...pointers.values()][0]!;
      dragStart = { x: rest.x, y: rest.y, tx, ty };
      pinchStart = null;
    } else if (pointers.size === 0) {
      dragStart = null;
      pinchStart = null;
      schedulePreview();
    }
  };

  wrap.addEventListener('pointerup', endPointer);
  wrap.addEventListener('pointercancel', endPointer);

  wrap.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      pushHistory();
      const rect = stage.getBoundingClientRect();
      zoomTo(zoom * (event.deltaY < 0 ? 1.08 : 0.92), event.clientX - rect.left, event.clientY - rect.top);
    },
    { passive: false },
  );

  /* ---------- 手动拖动白框四角：自由改变裁切框宽高 ---------- */
  stage.querySelectorAll<HTMLElement>('[data-corner]').forEach((cornerEl) => {
    const corner = cornerEl.dataset.corner as BoxCorner;
    let activeId = -1;
    let startClientX = 0;
    let startClientY = 0;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;
    let startTx = 0;
    let startTy = 0;
    let startTopPx = 0;
    let startRightPx = 0;
    let startBottomPx = 0;
    let startLeftPx = 0;

    cornerEl.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      event.preventDefault();
      pushHistory();
      activeId = event.pointerId;
      cornerEl.setPointerCapture(activeId);
      startClientX = event.clientX;
      startClientY = event.clientY;
      startX = stageX;
      startY = stageY;
      startW = width;
      startH = height;
      startTx = tx;
      startTy = ty;
      startTopPx = topPx;
      startRightPx = rightPx;
      startBottomPx = bottomPx;
      startLeftPx = leftPx;
    });

    cornerEl.addEventListener('pointermove', (event) => {
      if (event.pointerId !== activeId) return;
      const dx = event.clientX - startClientX;
      const dy = event.clientY - startClientY;
      const maxX = wrap.clientWidth - WRAP_PAD;
      const maxY = wrap.clientHeight - WRAP_PAD;

      let nextX = startX;
      let nextY = startY;
      let nextW = startW;
      let nextH = startH;

      if (corner === 'nw' || corner === 'sw') {
        const right = startX + startW;
        nextX = clamp(startX + dx, WRAP_PAD, right - MIN_BOX_W);
        nextW = right - nextX;
      } else {
        nextW = clamp(startW + dx, MIN_BOX_W, maxX - startX);
      }

      if (corner === 'nw' || corner === 'ne') {
        const bottom = startY + startH;
        nextY = clamp(startY + dy, WRAP_PAD, bottom - MIN_BOX_H);
        nextH = bottom - nextY;
      } else {
        nextH = clamp(startH + dy, MIN_BOX_H, maxY - startY);
      }

      stageX = Math.round(nextX);
      stageY = Math.round(nextY);
      width = Math.round(nextW);
      height = Math.round(nextH);

      // 保持图片在屏幕上的绝对位置不变：只裁掉多余边缘，图片不乱跳
      if (flipped) {
        const startRight = startX + startW;
        const nextRight = stageX + width;
        tx = startTx + (nextRight - startRight);
      } else {
        tx = startTx - (stageX - startX);
      }
      ty = startTy - (stageY - startY);

      // 虚线同样保持在原位置不动，仅在边框缩到贴近虚线时才顺带限位
      const dLeft = stageX - startX;
      const dRight = stageX + width - (startX + startW);
      const dTop = stageY - startY;
      const dBottom = stageY + height - (startY + startH);

      if (corner === 'nw' || corner === 'sw') {
        leftPx = clamp(startLeftPx - dLeft, MIN_GUIDE_PAD, width - rightPx - MIN_GUIDE_GAP);
      } else {
        rightPx = clamp(startRightPx + dRight, MIN_GUIDE_PAD, width - leftPx - MIN_GUIDE_GAP);
      }
      if (corner === 'nw' || corner === 'ne') {
        topPx = clamp(startTopPx - dTop, MIN_GUIDE_PAD, height - bottomPx - MIN_GUIDE_GAP);
      } else {
        bottomPx = clamp(startBottomPx + dBottom, MIN_GUIDE_PAD, height - topPx - MIN_GUIDE_GAP);
      }

      paintStage();
      paint();
      updateGuides();
      schedulePreview();
    });

    const stopCorner = (event: PointerEvent): void => {
      if (event.pointerId !== activeId) return;
      if (cornerEl.hasPointerCapture(activeId)) cornerEl.releasePointerCapture(activeId);
      activeId = -1;
      // 松手后把裁切框移回视野正中，并同步补偿图片偏移，相对位置完全不变
      const targetX = Math.round((wrap.clientWidth - width) / 2);
      const targetY = Math.round((wrap.clientHeight - height) / 2);
      const shiftX = targetX - stageX;
      const shiftY = targetY - stageY;
      stageX = targetX;
      stageY = targetY;
      // 图片随白框一起平移到中央 → 框内相对位置 tx/ty 保持不变即可
      void shiftX;
      void shiftY;
      paintStage();
      clampOffset();
      paint();
      schedulePreview();
    };

    cornerEl.addEventListener('pointerup', stopCorner);
    cornerEl.addEventListener('pointercancel', stopCorner);
  });

  /* ---------- 手动拖动四条虚线 ---------- */
  guides.querySelectorAll<HTMLElement>('[data-guide]').forEach((lineEl) => {
    const edge = lineEl.dataset.guide as GuideEdge;
    let activeId = -1;
    let startPos = 0;
    let startVal = 0;

    lineEl.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      event.preventDefault();
      pushHistory();
      activeId = event.pointerId;
      lineEl.setPointerCapture(activeId);
      startPos = edge === 't' || edge === 'b' ? event.clientY : event.clientX;
      startVal =
        edge === 't' ? topPx : edge === 'r' ? rightPx : edge === 'b' ? bottomPx : leftPx;
    });

    lineEl.addEventListener('pointermove', (event) => {
      if (event.pointerId !== activeId) return;
      const delta =
        (edge === 't' || edge === 'b' ? event.clientY : event.clientX) - startPos;
      if (edge === 't') {
        topPx = clamp(startVal + delta, MIN_GUIDE_PAD, height - bottomPx - MIN_GUIDE_GAP);
      } else if (edge === 'b') {
        bottomPx = clamp(startVal - delta, MIN_GUIDE_PAD, height - topPx - MIN_GUIDE_GAP);
      } else if (edge === 'l') {
        leftPx = clamp(startVal + delta, MIN_GUIDE_PAD, width - rightPx - MIN_GUIDE_GAP);
      } else if (edge === 'r') {
        rightPx = clamp(startVal - delta, MIN_GUIDE_PAD, width - leftPx - MIN_GUIDE_GAP);
      }
      updateGuides();
      schedulePreview();
    });

    const stopLine = (event: PointerEvent): void => {
      if (event.pointerId !== activeId) return;
      if (lineEl.hasPointerCapture(activeId)) lineEl.releasePointerCapture(activeId);
      activeId = -1;
      schedulePreview();
    };

    lineEl.addEventListener('pointerup', stopLine);
    lineEl.addEventListener('pointercancel', stopLine);
  });

  /* ---------- 翻转 / 回退 / 重置 / 滑杆 ---------- */
  flipBtn.addEventListener('click', () => {
    pushHistory();
    flipped = !flipped;
    [leftPx, rightPx] = [rightPx, leftPx];
    updateFlipUI();
    updateGuides();
    schedulePreview();
  });

  undoBtn.addEventListener('click', () => {
    const prev = history.pop();
    syncUndoBtn();
    if (!prev) return;
    width = prev.width;
    height = prev.height;
    zoom = prev.zoom;
    tx = prev.tx;
    ty = prev.ty;
    topPx = prev.topPx;
    rightPx = prev.rightPx;
    bottomPx = prev.bottomPx;
    leftPx = prev.leftPx;
    flipped = prev.flipped;
    zoomInput.value = String(Math.round(zoom * 100));
    scale = baseScale * zoom;
    centerStage();
    paint();
    updateGuides();
    updateFlipUI();
    refreshPreview();
  });

  resetBtn.addEventListener('click', () => {
    pushHistory();
    zoom = 1;
    topPx = DEFAULT_GUIDE_V;
    rightPx = DEFAULT_GUIDE_H;
    bottomPx = DEFAULT_GUIDE_V;
    leftPx = DEFAULT_GUIDE_H;
    flipped = false;
    zoomInput.value = '100';
    initLayout();
  });

  let sliderSnapshotTaken = false;
  zoomInput.addEventListener('pointerdown', () => {
    sliderSnapshotTaken = false;
  });
  zoomInput.addEventListener('input', () => {
    if (!sliderSnapshotTaken) {
      pushHistory();
      sliderSnapshotTaken = true;
    }
    zoomTo(Number(zoomInput.value) / 100);
  });

  eraseInput.addEventListener('change', () => schedulePreview());
  inkInput.addEventListener('input', () => {
    inkTouched = true;
    schedulePreview();
  });

  const close = (result: CustomBubbleResult | null): void => {
    window.clearTimeout(previewTimer);
    root.remove();
    document.body.style.overflow = previousOverflow;
    resolveClose(result);
  };

  let resolveClose: (result: CustomBubbleResult | null) => void = () => undefined;
  const done = new Promise<CustomBubbleResult | null>((resolve) => {
    resolveClose = resolve;
  });

  root.querySelector<HTMLElement>('[data-cancel]')?.addEventListener('click', () => close(null));

  root.querySelector<HTMLElement>('[data-ok]')?.addEventListener('click', () => {
    const out = renderExport(false);
    if (!out) {
      close(null);
      return;
    }
    const name = esc(nameInput.value.trim() || '截图气泡').replace(/&[a-z#0-9]+;/gi, '') || '截图气泡';
    close({
      dataUrl: out.dataUrl,
      name,
      bubbleShape: out.shape,
    });
  });

  await frame();
  initLayout();

  return done;
}
