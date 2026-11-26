// src/restore.js
// 서버의 특정 버전을 이 PC로 가져오는 두 가지 동작:
//   restoreToFolder  동기화 폴더의 원래 자리에 쓴다 → 엔진이 변경을 감지해 새 버전으로 올린다
//                    (삭제된 경로에 쓰면 서버가 같은 파일을 되살린다. docs/design.md §2.5)
//   saveVersionAs    저장 대화상자로 고른 다른 위치에 쓴다 (동기화와 무관)
import path from 'path';
import { downloadFileVersion } from './apiService';

const { ipcRenderer } = window.require('electron');
const fs = window.require('fs');
const crypto = window.require('crypto');
const { Buffer } = window.require('buffer');

/** 화면에 그대로 보여 줄 수 있는 문구를 가진 오류 (exists = 그 자리에 이미 파일이 있어서 쓰지 않음) */
export class RestoreError extends Error {
  constructor(message, { exists = false } = {}) {
    super(message);
    this.exists = exists;
  }
}

async function localRootOf(folderId) {
  const folders = await ipcRenderer.invoke('sync:folders');
  const folder = folders.find((f) => Number(f.id) === Number(folderId));
  if (!folder) throw new RestoreError('이 PC에 아직 연결되지 않은 폴더입니다. 잠시 뒤 다시 시도해 주세요.');
  if (folder.blocked || !fs.existsSync(folder.localRoot)) {
    throw new RestoreError(`이 PC에서 폴더를 찾을 수 없어 동기화가 멈춰 있습니다. 홈에서 폴더의 위치를 다시 지정한 뒤(또는 폴더를 되돌려 놓은 뒤) 되살려 주세요. (${folder.localRoot})`);
  }
  return folder.localRoot;
}

/**
 * 버전 내용을 동기화 폴더의 원래 상대 경로에 쓴다.
 * @param {{ folderId, fileId, version: number, relativePath: string, mustNotExist?: boolean }} target
 *   mustNotExist  되살리기용: 그 자리에 이미 파일이 있으면 덮어쓰지 않고 오류
 * @returns {Promise<string>} 쓴 파일의 절대 경로
 */
export async function restoreToFolder({ folderId, fileId, version, relativePath, mustNotExist = false }) {
  const localRoot = await localRootOf(folderId);
  const dest = path.join(localRoot, ...relativePath.split('/'));
  if (mustNotExist && fs.existsSync(dest)) {
    throw new RestoreError('같은 이름의 파일이 이 폴더에 이미 있습니다. 곧 동기화되어 목록에 나타납니다.', { exists: true });
  }
  const { blob } = await downloadFileVersion(folderId, fileId, version);
  const bytes = Buffer.from(await blob.arrayBuffer());

  // 같은 디렉터리의 임시 파일에 쓴 뒤 이름을 바꾼다. 임시 이름은 엔진의 무시 목록(.xor-tmp-*)에 해당한다.
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const tmp = path.join(path.dirname(dest), `.xor-tmp-${crypto.randomBytes(6).toString('hex')}`);
  try {
    await fs.promises.writeFile(tmp, bytes);
    await fs.promises.rename(tmp, dest);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') {
      throw new RestoreError('파일이 다른 프로그램에서 열려 있어 바꾸지 못했습니다. 파일을 닫고 다시 시도해 주세요.');
    }
    throw err;
  }
  return dest;
}

/**
 * 버전 내용을 저장 대화상자로 고른 위치에 쓴다.
 * @returns {Promise<string|null>} 저장한 경로, 취소했으면 null
 */
export async function saveVersionAs({ folderId, fileId, version, suggestedName }) {
  const filePath = await ipcRenderer.invoke('save-dialog', suggestedName);
  if (!filePath) return null;
  const { blob } = await downloadFileVersion(folderId, fileId, version);
  await fs.promises.writeFile(filePath, Buffer.from(await blob.arrayBuffer()));
  return filePath;
}

/** "보고서.docx", 3 → "보고서_v3.docx" */
export function versionedName(fileName, version) {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? `${fileName.slice(0, dot)}_v${version}${fileName.slice(dot)}` : `${fileName}_v${version}`;
}

/** 이 폴더(또는 전체)의 동기화가 멈춰 있으면 알림 뒤에 붙일 안내를, 아니면 빈 문자열을 돌려준다. */
export async function pausedNote(folderId) {
  try {
    const [folders, status] = await Promise.all([ipcRenderer.invoke('sync:folders'), ipcRenderer.invoke('sync:get-status')]);
    const paused = status.pausedAll || folders.find((f) => Number(f.id) === Number(folderId))?.paused;
    return paused ? ' 동기화가 멈춰 있어, 다시 시작하면 이 PC와 다른 기기에 반영됩니다.' : '';
  } catch {
    return '';
  }
}
