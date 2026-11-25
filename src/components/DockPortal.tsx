import React, { Fragment, useSyncExternalStore } from 'react';
import { AppTabBar, type TabBarItem } from './AppTabBar';

export interface BottomDockState {
  items: TabBarItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  hidden: boolean;
}

let bottomDockState: BottomDockState | null = null;
const bottomListeners = new Set<() => void>();

export function setBottomDockState(next: BottomDockState | null) {
  bottomDockState = next;
  for (const listener of bottomListeners) listener();
}

function subscribeBottomDock(listener: () => void) {
  bottomListeners.add(listener);
  return () => {
    bottomListeners.delete(listener);
  };
}

function getBottomDockSnapshot() {
  return bottomDockState;
}

export function useBottomDockVisible(): boolean {
  const state = useSyncExternalStore(
    subscribeBottomDock,
    getBottomDockSnapshot,
    getBottomDockSnapshot,
  );
  return Boolean(state && !state.hidden);
}

export const BottomDockHost = React.memo(function BottomDockHost() {
  const state = useSyncExternalStore(
    subscribeBottomDock,
    getBottomDockSnapshot,
    getBottomDockSnapshot,
  );
  return state ? (
    <AppTabBar
      items={state.items}
      activeKey={state.activeKey}
      onSelect={state.onSelect}
      hidden={state.hidden}
    />
  ) : null;
});

interface TopDockEntry {
  id: string;
  node: React.ReactNode;
}

const topDockMap = new Map<string, React.ReactNode>();
let topDockSnapshot: TopDockEntry[] = [];
const topListeners = new Set<() => void>();

function emitTopDock() {
  topDockSnapshot = Array.from(topDockMap, ([id, node]) => ({ id, node }));
  for (const listener of topListeners) listener();
}

export function setTopDockEntry(id: string, node: React.ReactNode) {
  topDockMap.set(id, node);
  emitTopDock();
}

export function removeTopDockEntry(id: string) {
  if (topDockMap.delete(id)) emitTopDock();
}

function subscribeTopDock(listener: () => void) {
  topListeners.add(listener);
  return () => {
    topListeners.delete(listener);
  };
}

function getTopDockSnapshot() {
  return topDockSnapshot;
}

export const TopDockHost = React.memo(function TopDockHost() {
  const entries = useSyncExternalStore(subscribeTopDock, getTopDockSnapshot, getTopDockSnapshot);
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map((entry) => (
        <Fragment key={entry.id}>{entry.node}</Fragment>
      ))}
    </>
  );
});
