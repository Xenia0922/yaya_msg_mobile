import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

export type BudgetRole = 'onMic' | 'roomsOnMic' | 'roomTime' | 'roomBg';

export interface TaskBudget {
  focused: boolean;
  concurrency: number;
  gapMs: number;
  commitBatchMs: number;
}

const FOCUSED_BUDGETS: Record<BudgetRole, Omit<TaskBudget, 'focused'>> = {
  onMic: { concurrency: 6, gapMs: 30, commitBatchMs: 250 },
  roomsOnMic: { concurrency: 4, gapMs: 40, commitBatchMs: 350 },
  roomTime: { concurrency: 3, gapMs: 40, commitBatchMs: 180 },
  roomBg: { concurrency: 2, gapMs: 60, commitBatchMs: 0 },
};

const BACKGROUND_BUDGETS: Record<BudgetRole, Omit<TaskBudget, 'focused'>> = {
  onMic: { concurrency: 1, gapMs: 220, commitBatchMs: 1200 },
  roomsOnMic: { concurrency: 1, gapMs: 180, commitBatchMs: 1200 },
  roomTime: { concurrency: 1, gapMs: 220, commitBatchMs: 1500 },
  roomBg: { concurrency: 1, gapMs: 240, commitBatchMs: 0 },
};

let activeRouteName = 'Home';
const routeListeners = new Set<() => void>();

let transitionUntil = 0;
let transitionTimer: ReturnType<typeof setTimeout> | null = null;
let appActive =
  typeof AppState?.currentState === 'string' ? AppState.currentState === 'active' : true;
const idleWaiters = new Set<() => void>();

export function wakeIdleWaiters(): void {
  if (!idleWaiters.size) return;
  const callbacks: Array<() => void> = [];
  idleWaiters.forEach((fn) => callbacks.push(fn));
  idleWaiters.clear();
  callbacks.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

if (typeof AppState?.addEventListener === 'function') {
  try {
    AppState.addEventListener('change', (nextState) => {
      const nextActive = nextState === 'active';
      if (nextActive === appActive) return;
      appActive = nextActive;
      if (appActive) {
        wakeIdleWaiters();
      }
    });
  } catch {}
}

export function setActiveRouteName(name: string): void {
  const clean = String(name || '').trim();
  if (!clean || clean === activeRouteName) return;
  activeRouteName = clean;
  routeListeners.forEach((listener) => {
    try {
      listener();
    } catch {}
  });
  wakeIdleWaiters();
}

export function getActiveRouteName(): string {
  return activeRouteName;
}

export function subscribeActiveRouteName(listener: () => void): () => void {
  routeListeners.add(listener);
  return () => {
    routeListeners.delete(listener);
  };
}

export function useActiveRouteName(): string {
  return useSyncExternalStore(subscribeActiveRouteName, getActiveRouteName, getActiveRouteName);
}

export function notifyTransitionStart(_tag?: string, durationMs = 340): void {
  const waitMs = Math.max(0, Number(durationMs) || 0);
  if (!waitMs) return;
  const nextUntil = Date.now() + waitMs;
  if (nextUntil > transitionUntil) {
    transitionUntil = nextUntil;
  }
  if (transitionTimer) {
    clearTimeout(transitionTimer);
    transitionTimer = null;
  }
  const remain = Math.max(16, transitionUntil - Date.now());
  transitionTimer = setTimeout(() => {
    transitionTimer = null;
    if (Date.now() >= transitionUntil) {
      transitionUntil = 0;
      wakeIdleWaiters();
    }
  }, remain);
}

export function isTransitioning(): boolean {
  return Date.now() < transitionUntil;
}

export async function waitForIdleSlot(
  priority: 'normal' | 'background' = 'background',
  shouldContinue?: () => boolean,
): Promise<boolean> {
  while (true) {
    if (shouldContinue && !shouldContinue()) return false;
    const waitBg = priority === 'background' && !appActive;
    const remainMs = transitionUntil - Date.now();
    if (!waitBg && remainMs <= 0) {
      return true;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = () => {
        if (settled) return;
        settled = true;
        idleWaiters.delete(done);
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        resolve();
      };
      idleWaiters.add(done);
      if (!waitBg && remainMs > 0) {
        timer = setTimeout(done, remainMs + 2);
      }
    });
  }
}

export function getTaskBudget(ownerRoute: string, role: BudgetRole): TaskBudget {
  const focused = activeRouteName === ownerRoute;
  const spec = focused ? FOCUSED_BUDGETS[role] : BACKGROUND_BUDGETS[role];
  return {
    focused,
    concurrency: spec.concurrency,
    gapMs: spec.gapMs,
    commitBatchMs: spec.commitBatchMs,
  };
}

export function setAppActiveForTest(active: boolean): void {
  appActive = !!active;
  if (appActive) {
    wakeIdleWaiters();
  }
}

export function resetSchedulerForTest(): void {
  activeRouteName = 'Home';
  transitionUntil = 0;
  appActive = true;
  if (transitionTimer) {
    clearTimeout(transitionTimer);
    transitionTimer = null;
  }
  routeListeners.clear();
  wakeIdleWaiters();
}
