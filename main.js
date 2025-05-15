
// src/main.js
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const remoteMain = require('@electron/remote/main');
const path = require('path');
const fs = require('fs');
const os = require('os');

remoteMain.initialize();

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
    width: 1440, height: 1024,
    minWidth: 800, minHeight: 800,
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

// app.whenReady().then(createWindow);
// 앱 초기화 후
app.whenReady().then(() => {
  createXorRoot();
  createWindow();

  // IPC: 사용자 폴더 생성 요청 처리
  ipcMain.handle('init-user-folder', (event, username) => {
    return createUserFolder(username);
  });

  ipcMain.on('sync-file-added',    (e, d) => broadcast('sync-file-added',    d));
  ipcMain.on('sync-file-deleted',  (e, d) => broadcast('sync-file-deleted',  d));
  ipcMain.on('sync-file-updated',  (e, d) => broadcast('sync-file-updated',  d));
  ipcMain.on('sync-folder-added',   (e, d) => broadcast('sync-folder-added',   d));
  ipcMain.on('local-folder-added',   (e, d) => broadcast('local-folder-added',   d));
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

// 폴더 선택 IPC
// ipcMain.handle('open-folder-dialog', async () => {
//   const { canceled, filePaths } = await dialog.showOpenDialog({
//     properties: ['openDirectory']
//   });
//   return canceled ? null : filePaths[0];
// });

app.on('window-all-closed', () => {
  // macOS 외 모든 플랫폼에서 앱 종료 :contentReference[oaicite:1]{index=1}
  if (process.platform !== 'darwin') app.quit();
});

// helper function
function broadcast(channel, data){
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, data));
}