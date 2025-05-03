
// src/main.js
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const remoteMain = require('@electron/remote/main');
const path = require('path');

remoteMain.initialize();

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
  createWindow();

  // Renderer → Main 받은 이벤트를 모든 BrowserWindow에 다시 보냄
  ipcMain.on('sync-file-added', (event, data) => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('sync-file-added', data);
    });
  });
  ipcMain.on('sync-file-deleted', (event, data) => {
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('sync-file-deleted', data);
    });
  });
  ipcMain.on('sync-file-updated',  (e, data) => {
    BrowserWindow.getAllWindows().forEach(w => {
      w.webContents.send('sync-file-updated',  data);
    });
  });
});


app.on('window-all-closed', () => {
  // macOS 외 모든 플랫폼에서 앱 종료 :contentReference[oaicite:1]{index=1}
  if (process.platform !== 'darwin') app.quit();
});

// 폴더 선택 IPC
ipcMain.handle('open-folder-dialog', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  return canceled ? null : filePaths[0];
});
