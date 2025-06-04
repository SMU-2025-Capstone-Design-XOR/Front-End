
// src/main.js

// 1) url 모듈에서 fileURLToPath 가져오기
import { fileURLToPath } from 'url';

// 2) 현재 모듈의 절대 파일 경로, 그리고 디렉터리 경로 생성
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);


import { app, BrowserWindow, dialog, ipcMain } from 'electron'; // Electron 메인 API
import remoteMain from '@electron/remote/main/index.js'; // 렌더러 프로세스에서 메인 기능을 사용하기 위한 remote
import path from 'path'; // 파일 경로 유틸리티
import fs from 'fs'; // 파일 시스템 모듈
import os from 'os'; // 운영체제 관련 정보 모듈
import Store from 'electron-store'; // JSON 형태의 간단한 영속 저장소

// ▶️ remote 기능 초기화 (렌더러에서 메인 API 접근 허용)
remoteMain.initialize();

// ▶️ electron-store 초기화 (버전 노트 저장용)
const noteStore = new Store({ name: 'version-notes' })
// ▶️ 전역 객체에 폴더별 클라이언트 파일맵을 저장하기 위한 공간 생성
global.clientMapStore = {};  // 폴더 ID -> 파일 목록 매핑

// 📁 XOR 루트 디렉토리 생성 함수
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
// 👤 사용자 계정별 폴더 생성 함수
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
// 🪟 메인 브라우저 윈도우 생성 함수
function createWindow() {
  const win = new BrowserWindow({
    width: 1240, height: 924,
    minWidth: 800, minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nativeWindowOpen: true,
    },
    // icon: path.join(__dirname, 'src/assets/ICON/4.icns'), // macOS 앱 아이콘 설정 (필요 시 주석 해제)
  });

  remoteMain.enable(win.webContents); // 이 창에서 remote 사용 가능하게 설정
  win.loadFile(path.join(__dirname, 'index.html')); // React 앱이 번들된 index.html 로딩

  // macOS에서는 창이 모두 닫혀도 앱이 종료되지 않으므로 다시 생성
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
  // React 라우터에서 /version 페이지를 경로 파라미터로 열도록 구성
  const url = `file://${path.join(__dirname, 'index.html')}#/version` +
              `?folderId=${folderId}` +
              `&fileId=${fileId}` +
              `&relativePath=${encodeURIComponent(relativePath)}`;
  win.loadURL(url);
}


// 앱 초기화 후
app.whenReady().then(() => {

  createXorRoot();    // 루트 폴더 생성
  createWindow();     // 메인 창 생성

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

  // 각종 동기화 이벤트들을 브로드캐스트 처리
  ipcMain.on('sync-file-added',    (e, d) => broadcast('sync-file-added',    d));
  ipcMain.on('sync-file-deleted',  (e, d) => broadcast('sync-file-deleted',  d));
  ipcMain.on('sync-file-updated',  (e, d) => broadcast('sync-file-updated',  d));
  ipcMain.on('sync-folder-added',   (e, d) => broadcast('sync-folder-added',   d));
  ipcMain.on('local-folder-added',   (e, d) => broadcast('local-folder-added',   d));

  ipcMain.on('dosync-folder-added',   (e, d) => broadcast('dosync-folder-added',  d));
  ipcMain.on('flag-folder-added',   (e, d) => broadcast('flag-folder-added',  d));

  ipcMain.on('sync-folder-removed', (e, d) => broadcast('sync-folder-removed', d));
  ipcMain.on('sub-folder-added',   (e, d) => broadcast('sub-folder-added',   d));
  ipcMain.on('sub-folder-removed', (e, d) => broadcast('sub-folder-removed', d));
  ipcMain.on('sub-folder-removed-server', (e, d) => broadcast('sub-folder-removed', d));
  
  // 폴더 선택 다이얼로그 오픈
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

// 모든 창이 닫히면 macOS 외에는 앱 종료
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 브라우저 창에 메시지를 전달하는 헬퍼 함수
function broadcast(channel, data){
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, data));
}