// src/utils/versionNoteStore.js
import { ipcRenderer } from 'electron'

export async function getVersionNote(fileId, versionNumber) {
  return ipcRenderer.invoke('get-version-note', { fileId, version: versionNumber })
}

export async function setVersionNote(fileId, versionNumber, note) {
  return ipcRenderer.invoke('set-version-note', { fileId, version: versionNumber, note })
}
