// src/preload.js
const { contextBridge, ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const BufferModule = require('buffer').Buffer;
const { Menu, MenuItem, getCurrentWindow } = require('@electron/remote');

contextBridge.exposeInMainWorld('electronAPI', {
  // OS 기본 앱으로 파일 열기
  openFile: fullPath => shell.openPath(fullPath),
  // 폴더 선택
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  // 저장 대화상자
  showSaveDialog: options => ipcRenderer.invoke('show-save-dialog', options),

  // Node API
  fs,
  path,
  Buffer: BufferModule,

  // Context Menu 관련
  Menu,
  MenuItem,
  getCurrentWindow,
});
