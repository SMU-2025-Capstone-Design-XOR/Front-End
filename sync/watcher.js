// sync/watcher.js
// chokidar 감시. 이벤트는 "이 경로를 다시 보라"는 신호일 뿐이고 무엇을 할지는 엔진이 정한다.
import path from 'node:path';
import chokidar from 'chokidar';
import { normalizeRel, isIgnored } from './paths.js';

/**
 * @param {string} root 감시할 로컬 폴더
 * @param {object} handlers
 *   onDirty(rel)      파일이 생기거나 바뀌거나 없어짐
 *   onDirRemoved(rel) 디렉터리가 없어짐 (그 아래 기준 항목을 모두 다시 보게 한다)
 *   onError(err)
 * @returns {{ close: () => Promise<void> }}
 */
export function startWatcher(root, { onDirty, onDirRemoved, onError }, { stabilityMs = 1000 } = {}) {
  const toRel = (abs) => normalizeRel(path.relative(root, abs));
  const watcher = chokidar.watch(root, {
    ignored: (abs) => {
      const rel = toRel(abs);
      return rel !== '' && isIgnored(rel);
    },
    ignoreInitial: true,          // 시작 시 전체 점검은 엔진이 따로 한다
    persistent: true,
    followSymlinks: false,
    awaitWriteFinish: { stabilityThreshold: stabilityMs, pollInterval: 100 }, // 쓰기 완료를 기다린다
  });
  const dirty = (abs) => {
    const rel = toRel(abs);
    if (rel) onDirty(rel);
  };
  watcher
    .on('add', dirty)
    .on('change', dirty)
    .on('unlink', dirty) // 삭제 여부는 엔진이 2초 뒤 디스크를 다시 보고 판단한다 (Office의 바꿔치기 저장)
    .on('unlinkDir', (abs) => {
      const rel = toRel(abs);
      if (rel && onDirRemoved) onDirRemoved(rel);
    })
    .on('error', (err) => onError && onError(err));
  return { close: () => watcher.close() };
}
