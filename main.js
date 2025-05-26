
// src/main.js

// 1) url 모듈에서 fileURLToPath 가져오기
import { fileURLToPath } from 'url';

// 2) 현재 모듈의 절대 파일 경로, 그리고 디렉터리 경로 생성
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);


import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import remoteMain from '@electron/remote/main/index.js';
import path from 'path';
import fs from 'fs';
import os from 'os';
import Store from 'electron-store';


remoteMain.initialize();

// interop guard: default 프로퍼티가 있으면 그걸, 아니면 모듈 자체를 Store로
const noteStore = new Store({ name: 'version-notes' })
// 1. clientMapStore 초기화
global.clientMapStore = {};  // 폴더 ID -> 파일 목록 매핑

function createXorRoot() {
  const xorRoot = path.join(os.homedir(), 'XOR');

  if (!fs.existsSync(xorRoot)) {
    try {
      fs.mkdirSync(xorRoot, { recursive: true });
      console.log(`🏠 XOR root created at ${xorRoot}`);
    } catch (err) {
      console.error('Failed to create XOR root:', err);
    }
  }

  return xorRoot;
}

function createUserFolder(username) {
  const userDir = path.join(os.homedir(), 'XOR', username);

  if (!fs.existsSync(userDir)) {
    try {
      fs.mkdirSync(userDir, { recursive: true });
      console.log(`🏠 User directory created at ${userDir}`);
    } catch (err) {
      console.error('Failed to create user directory:', err);
    }
  }

  // 계정 폴더 내에 숨김 'Delete' 폴더 자동 생성
  const deleteDir = path.join(userDir, '_Delete');
  if (!fs.existsSync(deleteDir)) {
    try {
      fs.mkdirSync(deleteDir, { recursive: true });
      console.log(`🗑️ Delete directory created at ${deleteDir}`);
      // Windows에서만 추가로 숨김 속성 설정
      if (process.platform === 'win32') {
        require('child_process').execSync(`attrib +H "${deleteDir}"`);
      }
    } catch (err) {
      console.error('Failed to create or hide Delete folder:', err);
    }
  }


  return userDir;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1240, height: 924,
    minWidth: 800, minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  remoteMain.enable(win.webContents);
  win.loadFile(path.join(__dirname, 'index.html'));

  // macOS에서 재실행 처리
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}


// ▶️ 새로 추가: 버전 관리용 윈도우 생성 함수
function createVersionWindow(folderId, fileId, relativePath) {
  const win = new BrowserWindow({
    width: 700, height: 500,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });
  remoteMain.enable(win.webContents);
  // React 라우터에서 /version?folderId=…&relativePath=… 경로를 잡아주게끔
  const url = `file://${path.join(__dirname, 'index.html')}#/version` +
              `?folderId=${folderId}` +
              `&fileId=${fileId}` +
              `&relativePath=${encodeURIComponent(relativePath)}`;
  win.loadURL(url);
}


// 앱 초기화 후
app.whenReady().then(() => {
  createXorRoot();
  createWindow();

  // IPC: 사용자 폴더 생성 요청 처리
  ipcMain.handle('init-user-folder', (event, username) => {
    const result = createUserFolder(username);
    if (!result) {
      throw new Error('사용자 폴더 생성 실패: 권한 부족 또는 디스크 오류');
    }
    return result;
  });

  // ▶️ 버전관리 페이지 관련 핸들러 추가
  ipcMain.on('open-version-window', (_e, { folderId, fileId, relativePath }) => {
    createVersionWindow(folderId, fileId, relativePath);
  });


  ipcMain.on('sync-file-added',    (e, d) => broadcast('sync-file-added',    d));
  ipcMain.on('sync-file-deleted',  (e, d) => broadcast('sync-file-deleted',  d));
  ipcMain.on('sync-file-updated',  (e, d) => broadcast('sync-file-updated',  d));
  ipcMain.on('sync-folder-added',   (e, d) => broadcast('sync-folder-added',   d));
  ipcMain.on('local-folder-added',   (e, d) => broadcast('local-folder-added',   d));

  ipcMain.on('dosync-folder-added',   (e, d) => broadcast('dosync-folder-added',  d));

  ipcMain.on('sync-folder-removed', (e, d) => broadcast('sync-folder-removed', d));
  ipcMain.on('sub-folder-added',   (e, d) => broadcast('sub-folder-added',   d));
  ipcMain.on('sub-folder-removed', (e, d) => broadcast('sub-folder-removed', d));
  ipcMain.on('sub-folder-removed-server', (e, d) => broadcast('sub-folder-removed', d));

  ipcMain.handle('open-folder-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    return canceled ? null : filePaths[0];
  });
});

// clientMapStore에 파일 목록 저장 요청 처리
ipcMain.handle('set-client-map', (event, { folderId, fileMap }) => {
  global.clientMapStore[folderId] = fileMap;
  console.log(`🗂️ Set client map for folderId=${folderId}`);
  return true;
});

ipcMain.handle('get-client-map', (event, folderId) => {
  return global.clientMapStore[folderId] ?? {};
});

// 버전 정보 관련 IPC 핸들러
ipcMain.handle('get-version-note', (_e, { fileId, version }) => {
  const key = `${fileId}-v${version}`
  return noteStore.get(key, '')
})
ipcMain.handle('set-version-note', (_e, { fileId, version, note }) => {
  const key = `${fileId}-v${version}`
  noteStore.set(key, note)
  return true
})


app.on('window-all-closed', () => {
  // macOS 외 모든 플랫폼에서 앱 종료 :contentReference[oaicite:1]{index=1}
  if (process.platform !== 'darwin') app.quit();
});

// helper function
function broadcast(channel, data){
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, data));
}