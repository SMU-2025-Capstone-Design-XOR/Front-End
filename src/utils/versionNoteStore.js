// // src/utils/versionNoteStore.js
// import Store from 'electron-store';

// const store = new Store({ name: 'version-notes' });

// export function getVersionNote(fileId, versionNumber) {
//   const key = `${fileId}-v${versionNumber}`;
//   return store.get(key, '');
// }

// export function setVersionNote(fileId, versionNumber, note) {
//   const key = `${fileId}-v${versionNumber}`;
//   store.set(key, note);
// }

// src/utils/versionNoteStore.js
import { ipcRenderer } from 'electron'

export async function getVersionNote(fileId, versionNumber) {
  return ipcRenderer.invoke('get-version-note', { fileId, version: versionNumber })
}

export async function setVersionNote(fileId, versionNumber, note) {
  return ipcRenderer.invoke('set-version-note', { fileId, version: versionNumber, note })
}
