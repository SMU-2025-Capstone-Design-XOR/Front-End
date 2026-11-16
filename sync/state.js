// sync/state.js
// 폴더별 상태 파일 읽기·쓰기와 기기 ID 보관
//
// 상태 파일: {stateDir}/{userId}-{folderId}.json
//   { localRoot, cursor, files: { "경로": { fileId, baseVersion, baseHash, size, mtimeMs } }, folderName?, paused? }
//   folderName  이 상태가 어느 폴더의 것인지 (위치를 다시 지정하면 localRoot의 마지막 요소가 폴더 이름과 달라질 수 있다)
//   paused      사용자가 이 폴더의 동기화를 멈춰 두었는가 (앱을 껐다 켜도 유지)
// 사용자별 설정: {stateDir}/{userId}-settings.json  { pausedAll }  — 전체 동기화 중지
// baseVersion·baseHash는 "이 기기가 서버와 마지막으로 일치했던 상태"다.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function stateFilePath(stateDir, userId, folderId) {
  return path.join(stateDir, `${userId}-${folderId}.json`);
}

export function emptyState(localRoot) {
  return { localRoot, cursor: 0, files: {} };
}

/** 상태 파일을 읽는다. 없으면 null. 깨진 파일은 옆에 보관하고 null을 돌려준다(새 기기처럼 다시 맞춘다). */
export function loadState(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || typeof data.localRoot !== 'string') throw new Error('형식 오류');
    return {
      localRoot: data.localRoot,
      cursor: Number.isFinite(data.cursor) ? data.cursor : 0,
      files: data.files && typeof data.files === 'object' ? data.files : {},
      ...(typeof data.folderName === 'string' ? { folderName: data.folderName } : {}),
      ...(data.paused === true ? { paused: true } : {}),
    };
  } catch {
    try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* 보관 실패는 무시 */ }
    return null;
  }
}

/** 임시 파일에 쓰고 이름을 바꿔 원자적으로 저장한다. 쓰는 도중 죽어도 이전 파일이 남는다. */
export function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1), 'utf8');
  fs.renameSync(tmp, file);
}

export function removeState(file) {
  try { fs.unlinkSync(file); } catch (err) { if (err.code !== 'ENOENT') throw err; }
}

export function settingsFilePath(stateDir, userId) {
  return path.join(stateDir, `${userId}-settings.json`);
}

/** 사용자별 설정을 읽는다. 없거나 깨졌으면 기본값. */
export function loadSettings(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { pausedAll: data?.pausedAll === true };
  } catch {
    return { pausedAll: false };
  }
}

export function saveSettings(file, settings) {
  saveState(file, settings);
}

/** 기기 ID: 첫 실행 때 만든 UUID를 {dir}/device-id에 저장해 두고 계속 쓴다. */
export function loadOrCreateDeviceId(dir) {
  const file = path.join(dir, 'device-id');
  try {
    const id = fs.readFileSync(file, 'utf8').trim();
    if (id && id.length <= 64) return id;
  } catch { /* 없으면 새로 만든다 */ }
  const id = randomUUID();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, id, 'utf8');
  return id;
}
