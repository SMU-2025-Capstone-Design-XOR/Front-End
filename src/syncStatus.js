// src/syncStatus.js
// main 프로세스의 동기화 엔진 상태를 창마다 한 벌 들고 있는 저장소.
// 엔진은 sync:status 이벤트를 보내고, 진행 정보(남은 파일 수·마지막 확인 시각)는 sync:get-status로 읽는다.
import { useSyncExternalStore } from 'react';

const { ipcRenderer } = window.require('electron');

let snapshot = { status: { state: 'stopped' }, conflicts: [] };
const listeners = new Set();
const conflictListeners = new Set();
let started = false;
let delayed = null;

function set(next) {
  snapshot = next;
  listeners.forEach((fn) => fn());
}

export async function refreshSyncStatus() {
  try {
    const status = await ipcRenderer.invoke('sync:get-status');
    if (JSON.stringify(status) !== JSON.stringify(snapshot.status)) set({ ...snapshot, status });
  } catch (err) {
    console.error('동기화 상태 조회 실패:', err);
  }
}

function start() {
  if (started) return;
  started = true;
  ipcRenderer.on('sync:status', (_e, payload) => {
    if (payload?.state === 'conflict') {
      // 충돌은 엔진의 지속 상태가 아니라 한 번의 알림이다. 사용자가 볼 때까지 목록에 남긴다.
      set({ ...snapshot, conflicts: [...snapshot.conflicts, payload] });
      conflictListeners.forEach((fn) => fn(payload));
      return;
    }
    if (payload?.state === 'syncing') {
      // 15초마다 도는 확인은 순식간에 끝난다. 잠깐 스치는 "동기화 중"은 보여 주지 않는다.
      clearTimeout(delayed);
      delayed = setTimeout(refreshSyncStatus, 500);
    } else {
      refreshSyncStatus();
    }
  });
  setInterval(refreshSyncStatus, 2000);
  refreshSyncStatus();
}

function subscribe(fn) {
  start();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** { status: { state, pending, lastPollAt, folders, … }, conflicts: [{ folderId, relativePath, copyPath, conflictWith }] } */
export function useSyncStatus() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** 충돌 알림이 올 때마다 불린다. 해제 함수를 돌려준다. */
export function onConflict(fn) {
  start();
  conflictListeners.add(fn);
  return () => conflictListeners.delete(fn);
}

export function clearConflicts() {
  if (snapshot.conflicts.length) set({ ...snapshot, conflicts: [] });
}

/** 충돌 사본을 탐색기에서 보여 준다 (이 기기에서의 폴더 위치는 엔진이 안다). */
export async function revealConflictCopy(conflict) {
  const folders = await ipcRenderer.invoke('sync:folders');
  const folder = folders.find((f) => Number(f.id) === Number(conflict.folderId));
  if (!folder) return false;
  const path = window.require('path');
  return ipcRenderer.invoke('show-item', path.join(folder.localRoot, conflict.copyPath));
}
