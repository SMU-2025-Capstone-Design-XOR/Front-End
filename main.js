
// src/main.js
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const remoteMain = require('@electron/remote/main');
const path = require('path');
const fs = require('fs');
const os = require('os');

remoteMain.initialize();

// ✅ 1. clientMapStore 초기화
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
  // cross-platform loadFile 사용 :contentReference[oaicite:0]{index=0}
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

  ipcMain.on('sync-file-added',    (e, d) => broadcast('sync-file-added',    d));
  ipcMain.on('sync-file-deleted',  (e, d) => broadcast('sync-file-deleted',  d));
  ipcMain.on('sync-file-updated',  (e, d) => broadcast('sync-file-updated',  d));
  ipcMain.on('sync-folder-added',   (e, d) => broadcast('sync-folder-added',   d));
  ipcMain.on('sync-folder-removed', (e, d) => broadcast('sync-folder-removed', d));
  ipcMain.on('sub-folder-added',   (e, d) => broadcast('sub-folder-added',   d));
  ipcMain.on('sub-folder-removed', (e, d) => broadcast('sub-folder-removed', d));
  ipcMain.on('sub-folder-removed-server', (e, d) => broadcast('sub-folder-removed', d));

});

// ✅ 3. clientMapStore에 파일 목록 저장 요청 처리
ipcMain.handle('set-client-map', (event, { folderId, fileMap }) => {
  global.clientMapStore[folderId] = fileMap;
  console.log(`🗂️ Set client map for folderId=${folderId}`);
  return true;
});

ipcMain.handle('get-client-map', (event, folderId) => {
  return global.clientMapStore[folderId] ?? {};
});

// 폴더 선택 IPC
ipcMain.handle('open-folder-dialog', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  return canceled ? null : filePaths[0];
});

app.on('window-all-closed', () => {
  // macOS 외 모든 플랫폼에서 앱 종료 :contentReference[oaicite:1]{index=1}
  if (process.platform !== 'darwin') app.quit();
});

// helper function
function broadcast(channel, data){
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, data));
}