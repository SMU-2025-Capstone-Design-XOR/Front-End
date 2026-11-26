// 트레이 상주·종료 동작 확인 스크립트 (CDP + @electron/remote). Windows·macOS 공용.
//   npm run test:e2e:tray -- [--no-sync]   (= node test/e2e/tray-check.mjs, Front-end/에서, 먼저 npm run build)
// 1부(서버 없이): 창 닫기 = 숨기기, Dock 클릭(activate)으로 다시 표시, 중복 실행 방지, 개발용 두 인스턴스(XOR_USER_DATA가 다름),
//   보이는 창이 없어도(window-all-closed) 앱 유지, 종료하면 실제로 끝남.
// 2부(로컬 서버 필요, XOR_API_BASE 기본 http://localhost:8080): 메인 창을 숨긴 앱 A와 앱 B 사이에 파일이 양쪽으로 오가는지.
//   서버에 닿지 않거나 --no-sync이면 건너뛴다. 시험 계정과 임시 폴더를 쓰고, 끝나면 서버의 시험 폴더를 지운다.
// 트레이 아이콘을 실제로 클릭하는 것, 실제 Cmd+Q 키, 메뉴바 아이콘 모양은 스크립트로 확인할 수 없다 → docs/manual-tests/tray.md
// 주의: 메인 프로세스에 --inspect를 붙이면 app.quit()이 끝나지 않으므로, 종료는 렌더러에서 @electron/remote로 부른다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron'; // node에서 불러오면 OS에 맞는 Electron 실행 파일 경로가 온다

const FE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUN = path.join(os.tmpdir(), 'xor-tray-' + crypto.randomBytes(3).toString('hex'));
const API = process.env.XOR_API_BASE || 'http://localhost:8080';
const NO_SYNC = process.argv.includes('--no-sync');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
async function waitFor(fn, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { if (await fn()) return true; } catch { /* 아직 준비 안 됨 */ }
    await sleep(300);
  }
  return false;
}
const within = (promise, ms) => Promise.race([promise, sleep(ms).then(() => 'timeout')]);

// 앱 하나를 띄운다. port를 주면 렌더러에 CDP로 붙는다.
function launch(name, port = null) {
  const args = ['.'];
  if (port) args.push(`--remote-debugging-port=${port}`);
  const child = spawn(electronPath, args, {
    cwd: FE, stdio: 'ignore',
    env: { ...process.env, XOR_USER_DATA: path.join(RUN, name, 'data'), XOR_HOME: path.join(RUN, name, 'home'), XOR_POLL_MS: '3000', XOR_API_BASE: API },
  });
  child.exited = new Promise((r) => child.on('exit', (code) => r(code ?? 'signal')));
  return child;
}

class Cdp {
  static async open(port) {
    let page;
    for (let i = 0; i < 60 && !page; i++) {
      try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* 아직 안 뜸 */ }
      if (!page) await sleep(500);
    }
    if (!page) throw new Error(`CDP 연결 실패 (포트 ${port})`);
    const c = new Cdp(); c.ws = new WebSocket(page.webSocketDebuggerUrl); c.id = 0; c.pending = new Map();
    c.ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && c.pending.has(m.id)) { c.pending.get(m.id)(m); c.pending.delete(m.id); } };
    await new Promise((res, rej) => { c.ws.onopen = res; c.ws.onerror = rej; });
    return c;
  }
  async eval(expr) {
    const id = ++this.id;
    const r = await new Promise((res) => {
      this.pending.set(id, res);
      setTimeout(() => { if (this.pending.delete(id)) res({ timedOut: true }); }, 15000);
      try { this.ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })); } catch { this.pending.delete(id); res({ closed: true }); }
    });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval 오류');
    return r.result?.result?.value;
  }
  // 메인 프로세스의 창 상태 [{ visible, focused }]
  windows() { return this.eval(`JSON.stringify(require('@electron/remote').BrowserWindow.getAllWindows().map(w => ({ visible: w.isVisible(), focused: w.isFocused() })))`).then(JSON.parse); }
  closeMain() { return this.eval(`require('@electron/remote').BrowserWindow.getAllWindows()[0].close()`); }
  // 답을 기다리지 않게 조금 뒤에 종료한다 (트레이 "종료"·Cmd+Q와 같은 app.quit 경로)
  quit() { return this.eval(`setTimeout(() => require('@electron/remote').app.quit(), 200), 1`).catch(() => {}); }
  close() { try { this.ws.close(); } catch { /* 이미 닫힘 */ } }
}

const children = [];
try {
  // ───────── 1부: 창·종료 동작 (서버 없이) ─────────
  console.log('── 1부: 창 닫기·다시 열기·중복 실행·종료');
  const a = launch('A', 9481); children.push(a);
  const pa = await Cdp.open(9481);
  await waitFor(async () => (await pa.windows())[0]?.visible);
  check('시작하면 메인 창이 보인다', (await pa.windows())[0]?.visible === true);

  await pa.closeMain(); await sleep(800);
  let w = await pa.windows();
  check('창 닫기 → 창은 숨고 앱은 살아 있다', w.length === 1 && !w[0].visible && a.exitCode === null, JSON.stringify(w));

  await pa.eval(`require('@electron/remote').app.emit('activate'), 1`); await sleep(800);
  w = await pa.windows();
  check('activate(macOS Dock 클릭)로 숨긴 창이 다시 보인다', w.length === 1 && w[0].visible, JSON.stringify(w));

  await pa.closeMain(); await sleep(800);
  const dup = launch('A'); children.push(dup); // 같은 userData로 한 번 더 실행
  const dupCode = await within(dup.exited, 15000);
  await sleep(800); w = await pa.windows();
  check('중복 실행: 두 번째 실행은 바로 끝난다', dupCode === 0, `exit=${dupCode}`);
  check('중복 실행: 기존 창이 다시 보인다', w.length === 1 && w[0].visible, JSON.stringify(w));

  const b = launch('B', 9482); children.push(b); // userData가 다른 개발용 두 번째 인스턴스
  const pb = await Cdp.open(9482);
  await sleep(1500);
  check('XOR_USER_DATA가 다르면 두 인스턴스가 함께 뜬다', b.exitCode === null && a.exitCode === null);
  await pb.quit();
  const bCode = await within(b.exited, 10000);
  check('종료(app.quit)하면 실제로 끝난다', bCode !== 'timeout', `exit=${bCode}`);
  pb.close();

  // 메인 창을 숨긴 채 다른 창(버전 기록 창 역할)을 열었다 닫는다 → window-all-closed가 와도 앱은 남는다
  await pa.closeMain();
  await pa.eval(`(() => { const { BrowserWindow } = require('@electron/remote'); const x = new BrowserWindow({ width: 320, height: 200 }); x.loadURL('about:blank'); return 1; })()`);
  await sleep(800);
  await pa.eval(`require('@electron/remote').BrowserWindow.getAllWindows().find(x => x.isVisible()).close()`); await sleep(1000);
  w = await pa.windows();
  check('보이는 창이 하나도 없어도(window-all-closed) 앱은 남는다', a.exitCode === null && w.length === 1 && !w[0].visible, JSON.stringify(w));

  await pa.quit();
  const aCode = await within(a.exited, 10000);
  check('창이 숨은 상태에서 종료해도 실제로 끝난다', aCode !== 'timeout', `exit=${aCode}`);
  pa.close();

  // ───────── 2부: 창을 숨긴 채 동기화 (로컬 서버 필요) ─────────
  let serverUp = false;
  if (!NO_SYNC) {
    try { serverUp = (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status > 0; } catch { serverUp = false; }
  }
  if (!serverUp) {
    console.log(`── 2부 건너뜀: ${NO_SYNC ? '--no-sync' : `서버(${API})에 닿지 않음`}`);
  } else {
    console.log('── 2부: 메인 창을 숨긴 채 동기화');
    const post = (p, body) => fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const username = `tray_${crypto.randomBytes(4).toString('hex')}`;
    const password = crypto.randomBytes(12).toString('hex'); // 로컬 시험 계정용 임의 값
    await post('/auth/signup', { username, password, email: `${username}@example.test` });
    const token = (await (await post('/auth/login', { username, password })).json()).token;
    const userId = Number(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub);
    const FOLDER = '트레이 시험 폴더';
    const folderA = path.join(RUN, 'A-docs', FOLDER);
    fs.mkdirSync(folderA, { recursive: true });
    fs.writeFileSync(path.join(folderA, '처음.txt'), '처음 파일\n');
    const folderB = path.join(RUN, 'SB', 'home', 'XOR', username, FOLDER);

    const startEngine = async (name, port) => {
      const child = launch(name, port); children.push(child);
      const page = await Cdp.open(port);
      await sleep(2000);
      await page.eval(`require('electron').ipcRenderer.invoke('sync:start', ${JSON.stringify({ token, userId, username })})`);
      return { child, page };
    };
    const A = await startEngine('SA', 9483);
    const reg = await A.page.eval(`require('electron').ipcRenderer.invoke('sync:register-folder', ${JSON.stringify(folderA)})`);
    const folderId = reg?.folder?.id;
    check('A에서 폴더 등록', reg?.ok === true, JSON.stringify(reg)?.slice(0, 200));
    const B = await startEngine('SB', 9484);
    check('B가 처음 파일을 받음', await waitFor(() => fs.existsSync(path.join(folderB, '처음.txt'))));

    await A.page.closeMain(); await sleep(800);
    w = await A.page.windows();
    check('A의 메인 창이 숨음(앱은 살아 있음)', w.length === 1 && !w[0].visible && A.child.exitCode === null, JSON.stringify(w));

    fs.writeFileSync(path.join(folderB, 'B에서 만든 파일.txt'), 'B가 만든 내용\n');
    fs.writeFileSync(path.join(folderB, '처음.txt'), '처음 파일\nB가 고친 줄\n');
    check('숨긴 A가 B의 새 파일을 받음', await waitFor(() => fs.existsSync(path.join(folderA, 'B에서 만든 파일.txt'))));
    check('숨긴 A가 B의 수정을 받음', await waitFor(() => fs.readFileSync(path.join(folderA, '처음.txt'), 'utf8').includes('B가 고친 줄')));
    fs.writeFileSync(path.join(folderA, '숨긴 동안 A에서 만든 파일.txt'), 'A가 숨긴 채 만든 내용\n');
    check('숨긴 A의 새 파일이 B에 내려감(파일 감시가 계속 돎)', await waitFor(() => fs.existsSync(path.join(folderB, '숨긴 동안 A에서 만든 파일.txt'))));
    w = await A.page.windows();
    check('동기화하는 동안 A의 창은 계속 숨어 있었음', w.length === 1 && !w[0].visible, JSON.stringify(w));

    for (const d of [A, B]) await d.page.quit();
    const codes = await Promise.all([A, B].map((d) => within(d.child.exited, 10000)));
    check('두 앱 모두 종료됨', codes.every((c) => c !== 'timeout'), JSON.stringify(codes));
    if (folderId) {
      const del = await fetch(`${API}/users/${userId}/sync-folders/${folderId}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      console.log(`정리: 서버의 시험 폴더 삭제 ${del.status}`);
    }
  }
} catch (e) {
  check('스크립트가 끝까지 실행됨', false, e.stack || e.message);
} finally {
  for (const c of children) { if (c.exitCode === null) c.kill(); }
  await sleep(1500);
  fs.rmSync(RUN, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  const failed = results.filter((r) => !r.ok);
  console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
  console.log('스크립트로 확인할 수 없는 항목(트레이 클릭, 실제 Cmd+Q, 아이콘 모양)은 docs/manual-tests/tray.md');
  process.exit(failed.length ? 1 : 0);
}
