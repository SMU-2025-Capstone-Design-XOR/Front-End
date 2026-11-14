
// src/main.js

// 1) url 모듈에서 fileURLToPath 가져오기
import { fileURLToPath } from 'url';

// 2) 현재 모듈의 절대 파일 경로, 그리고 디렉터리 경로 생성
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);


import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'; // Electron 메인 API
import remoteMain from '@electron/remote/main/index.js'; // 렌더러 프로세스에서 메인 기능을 사용하기 위한 remote
import path from 'path'; // 파일 경로 유틸리티
import fs from 'fs'; // 파일 시스템 모듈
import os from 'os'; // 운영체제 관련 정보 모듈

// 동기화 엔진 (main 프로세스에서 돈다. docs/design.md §2.5)
import { loadConfig } from './sync/config.js';
import { loadOrCreateDeviceId } from './sync/state.js';
import { createApi } from './sync/api.js';
import { SyncEngine } from './sync/engine.js';

// 개발·시험용: 한 PC에서 앱을 두 개 띄울 때 인스턴스마다 다른 userData를 쓰게 한다
if (process.env.XOR_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.XOR_USER_DATA));
}

// ▶️ remote 기능 초기화 (렌더러에서 메인 API 접근 허용)
remoteMain.initialize();

// ▶️ 동기화 엔진 상태 (로그인한 사용자 1명당 엔진 1개)
let syncEngine = null;
let syncSession = null; // { token, userId, username }

// 다른 기기가 등록한 폴더를 둘 기본 위치의 뿌리: ~/XOR (시험용으로 XOR_HOME으로 바꿀 수 있다)
function xorRootDir() {
  return path.join(process.env.XOR_HOME ? path.resolve(process.env.XOR_HOME) : os.homedir(), 'XOR');
}

async function stopSyncEngine() {
  const engine = syncEngine;
  syncEngine = null;
  syncSession = null;
  if (engine) await engine.stop();
}

// 로그인 직후 렌더러가 sync:start로 부른다. 같은 사용자가 다시 로그인하면 토큰만 바꿔 이어 간다.
async function startSyncEngine({ token, userId, username } = {}) {
  if (!token || !userId || !username) throw new Error('sync:start에는 token, userId, username이 필요합니다');
  if (syncEngine && syncSession && String(syncSession.userId) === String(userId)) {
    syncSession.token = token;
    syncEngine.queue.resume(); // 인증 오류로 멈춰 있었다면 다시 돈다
    syncEngine.pollNow();
    return true;
  }
  await stopSyncEngine();

  const userData = app.getPath('userData');
  const config = loadConfig(userData);
  const session = { token, userId: Number(userId), username };
  const api = createApi({
    baseUrl: config.apiBase,
    getToken: () => session.token,
    deviceId: loadOrCreateDeviceId(userData),
    deviceName: os.hostname(),
  });
  syncSession = session;
  syncEngine = new SyncEngine({
    api,
    userId: session.userId,
    username,
    stateDir: path.join(userData, 'sync-state'),
    xorRoot: xorRootDir(),
    pollIntervalMs: config.pollIntervalMs,
    trash: (abs) => shell.trashItem(abs), // 서버에서 삭제된 파일은 휴지통으로 (완전 삭제하지 않음)
    emit: (channel, payload) => broadcast(channel, payload),
    log: (message) => console.log(`[sync] ${message}`),
  });
  syncEngine.start();
  console.log(`[sync] 엔진 시작: 사용자 ${username}(${session.userId}), 서버 ${config.apiBase}, 폴링 ${config.pollIntervalMs}ms`);
  return true;
}

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
// 🪟 메인 브라우저 윈도우 생성 함수
function createWindow() {
  const win = new BrowserWindow({
    width: 1240, height: 924,
    minWidth: 800, minHeight: 600,
    backgroundColor: '#F5F6F8',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      nativeWindowOpen: true,
    },
    // icon: path.join(__dirname, 'src/assets/ICON/4.icns'), // macOS 앱 아이콘 설정 (필요 시 주석 해제)
  });

  hideMenuBar(win);
  remoteMain.enable(win.webContents); // 이 창에서 remote 사용 가능하게 설정
  win.loadFile(path.join(__dirname, 'index.html')); // React 앱이 번들된 index.html 로딩

  // macOS에서는 창이 모두 닫혀도 앱이 종료되지 않으므로 다시 생성
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}


// 기본 메뉴줄(File, Edit…)을 숨긴다. macOS는 메뉴가 화면 위에 따로 있고 복사·붙여넣기 단축키가 거기 걸려 있어 그대로 둔다.
function hideMenuBar(win) {
  if (process.platform !== 'darwin') win.removeMenu();
}

// ▶️ 버전 기록 창
function createVersionWindow({ folderId, fileId, relativePath, folderName, deleted }) {
  const win = new BrowserWindow({
    width: 840, height: 760,
    minWidth: 560, minHeight: 420,
    backgroundColor: '#F5F6F8',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });
  hideMenuBar(win);
  remoteMain.enable(win.webContents);
  // React 라우터의 /version 화면을 쿼리와 함께 연다
  const query = new URLSearchParams({
    folderId: String(folderId),
    fileId: String(fileId),
    relativePath: relativePath || '',
    folderName: folderName || '',
    deleted: deleted ? '1' : '',
  });
  win.loadFile(path.join(__dirname, 'index.html'), { hash: `/version?${query}` });
}


// 앱 초기화 후
app.whenReady().then(() => {

  createXorRoot();    // 루트 폴더 생성
  createWindow();     // 메인 창 생성

  // ▶️ 버전 기록 창 열기 { folderId, fileId, relativePath, folderName, deleted }
  ipcMain.on('open-version-window', (_e, target) => {
    createVersionWindow(target);
  });

  // ▶️ 탐색기에서 폴더 열기 → 성공하면 '' (shell.openPath의 규칙), 실패하면 오류 문구
  ipcMain.handle('open-path', async (_e, target) => {
    if (!target || !fs.existsSync(target)) return '폴더를 찾을 수 없습니다.';
    return shell.openPath(target);
  });
  // ▶️ 탐색기에서 파일을 선택한 채로 보여 주기 (충돌 사본 위치 보기)
  ipcMain.handle('show-item', (_e, target) => {
    if (!target || !fs.existsSync(target)) return false;
    shell.showItemInFolder(target);
    return true;
  });
  // ▶️ "다른 이름으로 저장" 대화상자 → 고른 경로 또는 null
  ipcMain.handle('save-dialog', async (event, defaultPath) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath });
    return canceled || !filePath ? null : filePath;
  });

  // ▶️ 동기화 엔진 IPC
  // 동기화 이벤트(sync-file-added / -updated / -deleted, dosync-folder-added, sync-folder-removed, sync:status)는
  // 엔진이 broadcast로 직접 보낸다. 렌더러끼리 중계하던 핸들러 묶음은 없앴다.
  // 렌더러의 서버 주소도 같은 설정에서 가져간다 (동기 호출)
  ipcMain.on('get-config', (event) => {
    event.returnValue = loadConfig(app.getPath('userData'));
  });
  ipcMain.handle('sync:start', (_e, session) => startSyncEngine(session));
  ipcMain.handle('sync:stop', () => stopSyncEngine());
  // 이 기기에서 각 폴더가 놓인 위치 [{ id, name, localRoot, blocked, paused, registeredElsewhere }]
  // registeredElsewhere: 기본 위치(~/XOR/{사용자명}/{폴더 이름})에 놓인 폴더 = 다른 기기에서 등록한 폴더
  ipcMain.handle('sync:folders', () => {
    if (!syncEngine || !syncSession) return [];
    const defaultRoot = path.join(xorRootDir(), syncSession.username);
    return syncEngine.folderList().map((f) => ({
      ...f,
      registeredElsewhere: path.resolve(f.localRoot) === path.resolve(defaultRoot, f.name),
    }));
  });
  ipcMain.handle('sync:get-status', () => (syncEngine ? syncEngine.getStatus() : { state: 'stopped' }));
  // 폴더 등록: 고른 경로를 그대로 이 기기의 동기화 위치로 쓴다 → { ok, folder } | { ok: false, status, message, current }
  ipcMain.handle('sync:register-folder', (_e, folderPath) => {
    if (!syncEngine) return { ok: false, status: 0, message: '동기화 엔진이 시작되지 않았습니다. 다시 로그인해 주세요.' };
    return syncEngine.registerFolder(folderPath);
  });
  // 동기화 중지·다시 시작 (이 기기에만 해당, 앱을 껐다 켜도 유지) → 바뀌었으면 true
  ipcMain.handle('sync:pause-folder', (_e, folderId) => (syncEngine ? syncEngine.pauseFolder(folderId) : false));
  ipcMain.handle('sync:resume-folder', (_e, folderId) => (syncEngine ? syncEngine.resumeFolder(folderId) : false));
  ipcMain.handle('sync:pause-all', () => (syncEngine ? syncEngine.pauseAll() : false));
  ipcMain.handle('sync:resume-all', () => (syncEngine ? syncEngine.resumeAll() : false));
  // 로컬 폴더가 없어져 멈춘 폴더에 새 위치를 지정한다 → { ok, localRoot } | { ok: false, message }
  ipcMain.handle('sync:relocate-folder', (_e, folderId, newRoot) => {
    if (!syncEngine) return { ok: false, message: '동기화 엔진이 시작되지 않았습니다. 다시 로그인해 주세요.' };
    return syncEngine.relocateFolder(folderId, newRoot);
  });
  ipcMain.handle('sync:remove-folder', async (_e, folderId) => {
    if (syncEngine) await syncEngine.removeFolder(folderId);
    return true;
  });
  // 화면에서 서버를 직접 바꾼 뒤(파일 삭제 등) 바로 한 번 확인하게 한다
  ipcMain.on('sync:poll-now', () => { if (syncEngine) syncEngine.pollNow(); });


  // 폴더 선택 다이얼로그 오픈
  ipcMain.handle('open-folder-dialog', async (event, title) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: title || '동기화할 폴더 선택',
      properties: ['openDirectory']
    });
    return canceled ? null : filePaths[0];
  });
});

// 버전 메모는 서버에 저장한다 (PUT …/versions/{version}/note). 예전의 electron-store 'version-notes'는 쓰지 않는다.

// 종료 전에 엔진을 멈춘다 (감시 해제)
app.on('before-quit', () => { stopSyncEngine().catch(() => {}); });

// 모든 창이 닫히면 macOS 외에는 앱 종료
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 브라우저 창에 메시지를 전달하는 헬퍼 함수
function broadcast(channel, data){
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, data));
}