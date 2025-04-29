// // main.js

// const { app, BrowserWindow, dialog, ipcMain } = require('electron');
// // @electron/remote 초기화
// const remoteMain = require('@electron/remote/main');
// require('@electron/remote/main').initialize();
// const path = require('path');

// function createWindow() {
//   const win = new BrowserWindow({
//     width: 1440,
//     height: 1024,
//     maxWidth: 1440,
//     maxHeight: 1024,
//     minWidth: 800,
//     minHeight: 800,
//     webPreferences: {
//       nodeIntegration: true,
//       contextIsolation: false
//     }
//   });

//   // **enable()** 을 호출해 주어야 렌더러에서 require('@electron/remote') 사용 가능
//   remoteMain.enable(win.webContents);

//   win.loadURL(`file://${path.join(__dirname, 'index.html')}`);
  
//   // 개발 중에 DevTools 열기 (선택 사항)
//   // win.webContents.openDevTools();
// }

// app.whenReady().then(() => {
//   createWindow();

//   // 폴더 선택 다이얼로그 IPC 핸들러 추가
//   ipcMain.handle('open-folder-dialog', async () => {
//     const result = await dialog.showOpenDialog({
//       properties: ['openDirectory']
//     });
//     if (result.canceled) {
//       return null;
//     } else {
//       return result.filePaths[0];
//     }
//   });

//   app.on('activate', () => {
//     if (BrowserWindow.getAllWindows().length === 0) {
//       createWindow();
//     }
//   });
// });

// app.on('window-all-closed', () => {
//   if (process.platform !== 'darwin') {
//     app.quit();
//   }
// });
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

app.whenReady().then(createWindow);

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
