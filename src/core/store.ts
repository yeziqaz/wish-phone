/**
 * 极简状态容器（约 40 行，够用就好）。
 *
 * 为什么不引状态库：
 *   需求只有"改一块数据 → 通知订阅者重绘那一小块"，
 *   引一个几 KB 的库换不来什么，反而多一层要理解的抽象。
 *
 * 用法：
 *   const s = createStore({ clicks: 0 });
 *   const off = s.subscribe((st) => { ... });   // 返回取消订阅函数
 *   s.set({ clicks: 1 });
 */
export type Listener<T> = (state: T) => void;

export interface Store<T extends object> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(listener: Listener<T>): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<Listener<T>>();

  return {
    get: () => state,

    set(patch) {
      // 浅比较：值没变就不通知，避免无意义重绘
      const changed = (Object.keys(patch) as (keyof T)[]).some(
        (k) => state[k] !== patch[k],
      );
      if (!changed) return;

      state = { ...state, ...patch };
      for (const listener of listeners) listener(state);
    },

    subscribe(listener) {
      listeners.add(listener);
      // 一定要把取消订阅返回出去：界面重建时不撤销，
      // 订阅会越积越多，同一份数据被重复渲染（见 AGENTS.md §7）
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
