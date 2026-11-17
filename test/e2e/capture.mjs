// 단계 10 화면 확인·캡처 스크립트 (CDP).
// 앱을 시험 계정·임시 폴더로 두 개(기기 A·B) 띄워 가입 → 로그인 → 폴더 등록 → 버전 3개 → 버전 기록(메모가 B에서도 보이는지)
// → 되돌리기 → 삭제 → 되살리기 → 충돌 → 중지·재시작 → 위치 다시 지정 → 로그아웃을 차례로 하고, 화면을 저장한다.
// 사용자 폴더와 기존 설정은 건드리지 않는다(XOR_USER_DATA·XOR_HOME 분리). 서버는 local 프로필로 떠 있어야 한다.
//   npm run test:e2e:screens -- [--out <스크린샷 폴더>]   (= node test/e2e/capture.mjs, Front-end/에서, 먼저 npm run build)
// 스크린샷 폴더: --out, 없으면 저장소 옆의 ../docs/screens-new(논문용 화면 모음)가 있을 때 그곳, 그것도 없으면 임시 폴더.
// 폴더 선택·저장 대화상자(OS 창)는 조작할 수 없어 폴더 등록은 IPC로 직접 부른다.
// 원래 저장소 밖(docs/screens-new/capture.mjs)에 있던 것을 11/18 저장소(test/e2e/)로 옮겼다. Windows에서만 돌려 봤다.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron'; // node에서 불러오면 OS에 맞는 Electron 실행 파일 경로가 온다

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FE = path.resolve(HERE, '../..');
const outArg = process.argv.indexOf('--out');
const DOCS_SHOTS = path.resolve(FE, '../docs/screens-new');
const OUT = outArg > 0 && process.argv[outArg + 1] ? path.resolve(process.argv[outArg + 1])
  : fs.existsSync(DOCS_SHOTS) ? DOCS_SHOTS
  : path.join(os.tmpdir(), 'xor-capture-shots');
fs.mkdirSync(OUT, { recursive: true });
console.log(`스크린샷 저장 위치: ${OUT}`);
const RUN = path.join(os.tmpdir(), 'xor-cap-' + crypto.randomBytes(3).toString('hex'));
const FOLDER_NAME = '졸업논문 자료';
const FOLDER = path.join(RUN, 'A-docs', FOLDER_NAME);
const API = process.env.XOR_API_BASE || 'http://localhost:8080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function waitFor(fn, { timeout = 20000, step = 300, label = '' } = {}) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    try { last = await fn(); if (last) return last; } catch (e) { last = null; }
    await sleep(step);
  }
  if (label) console.log(`  (시간 초과: ${label})`);
  return last;
}

function launch(name, port) {
  const child = spawn(electronPath, ['.', `--remote-debugging-port=${port}`], {
    cwd: FE, stdio: 'ignore',
    env: { ...process.env, XOR_USER_DATA: path.join(RUN, name, 'data'), XOR_HOME: path.join(RUN, name, 'home'), XOR_POLL_MS: '3000', XOR_API_BASE: API },
  });
  return { child, port, name };
}

async function targets(port) {
  for (let i = 0; i < 60; i++) {
    try { return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page'); } catch { await sleep(500); }
  }
  throw new Error('CDP 연결 실패');
}

class Cdp {
  static async open(wsUrl, { width = 1280, height = 800 } = {}) {
    const c = new Cdp(); c.ws = new WebSocket(wsUrl); c.id = 0; c.pending = new Map(); c.dialogs = []; c.errors = [];
    await new Promise((res, rej) => { c.ws.onopen = res; c.ws.onerror = rej; });
    c.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) { c.pending.get(m.id)(m); c.pending.delete(m.id); }
      if (m.method === 'Page.javascriptDialogOpening') {
        c.dialogs.push(`${m.params.type}: ${m.params.message}`);
        c.send('Page.handleJavaScriptDialog', { accept: true });
      }
      if (m.method === 'Runtime.exceptionThrown') c.errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    };
    await c.send('Page.enable'); await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res) => {
      this.pending.set(id, res);
      // 창이 닫혔으면 답이 오지 않는다. 기다리다 멈추지 않게 한다.
      setTimeout(() => { if (this.pending.delete(id)) res({ timedOut: true }); }, 15000);
      try { this.ws.send(JSON.stringify({ id, method, params })); } catch { this.pending.delete(id); res({ closed: true }); }
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval 오류');
    return r.result?.result?.value;
  }
  // 선택자(와 글자)에 맞는 요소의 가운데 좌표
  center(selector, text = null, index = 0) {
    return this.eval(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => ${text === null ? 'true' : `e.textContent.trim().includes(${JSON.stringify(text)})`});
      const e = els[${index}]; if (!e) return null; e.scrollIntoView({block:'nearest'}); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  }
  async click(selector, text = null, index = 0) {
    const pt = typeof selector === 'object' ? selector : await waitFor(() => this.center(selector, text, index), { timeout: 8000 });
    if (!pt) throw new Error(`요소를 찾지 못함: ${selector} ${text ?? ''}`);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await sleep(250);
  }
  async key(key, code = key, vk = 27) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
    await sleep(200);
  }
  async type(selector, text) {
    await this.click(selector);
    await this.eval(`document.querySelector(${JSON.stringify(selector)}).select && document.querySelector(${JSON.stringify(selector)}).select()`);
    await this.send('Input.insertText', { text });
  }
  text(selector = 'body') { return this.eval(`(document.querySelector(${JSON.stringify(selector)})?.innerText ?? '')`); }
  count(selector) { return this.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`); }
  hash() { return this.eval('location.hash'); }
  // 화면 캡처는 가끔 응답이 늦게 온다(11/17에 한 번, 15초 넘게). 확인 항목이 아니므로 세 번까지 다시 해 보고,
  // 그래도 안 되면 경고만 남기고 넘어간다 (예전에는 여기서 스크립트 전체가 멈췄다).
  async shot(name) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await this.send('Page.captureScreenshot', { format: 'png' });
      if (r.result?.data) {
        fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
        console.log('  shot', name);
        return;
      }
      await sleep(1000);
    }
    console.log(`  (경고: 화면 캡처 실패 — ${name}, 세 번 시도)`);
  }
}

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const log = [];
let A; let B;
const windows = [];

try {
  // ── 시험 폴더 ──
  fs.mkdirSync(path.join(FOLDER, '실험 데이터'), { recursive: true });
  const intro = path.join(FOLDER, '서론 초안.txt');
  // 변경분(DIFF)으로 저장되도록 어느 정도 길이가 있는 글로 만든다 (아주 작은 파일은 번들이 더 커서 전체본으로 저장된다)
  const V1 = '차분 기반 백업 서비스의 필요성\n'
    + Array.from({ length: 120 }, (_, i) => `${i + 1}. 파일의 바뀐 부분만 저장하면 버전이 늘어도 저장 공간이 적게 든다.\n`).join('');
  fs.writeFileSync(intro, V1);
  fs.writeFileSync(path.join(FOLDER, '참고문헌.md'), '# 참고문헌\n- Myers, An O(ND) Difference Algorithm\n');
  fs.writeFileSync(path.join(FOLDER, '아주 긴 파일 이름을 가진 회의록 2026년 11월 둘째 주.txt'), '회의록\n');
  fs.writeFileSync(path.join(FOLDER, '실험 데이터', '절감률.csv'), '버전,원본,저장\n1,100,100\n');
  fs.writeFileSync(path.join(FOLDER, '실험 데이터', '옛 목차.txt'), '1. 서론\n2. 관련 연구\n');

  A = launch('A', 9333);
  let page = await Cdp.open((await targets(A.port))[0].webSocketDebuggerUrl);
  windows.push(page);
  await waitFor(() => page.count('#login-id'));

  // ── 1. 로그인·회원가입 ──
  const user = 'demo' + crypto.randomBytes(2).toString('hex');
  const pw = crypto.randomBytes(9).toString('base64url');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 760, deviceScaleFactor: 1, mobile: false });
  check('문구가 한국어(로그인 화면)', (await page.text()).includes('아이디 기억하기') && !/Login|Sign up|Username/.test(await page.text()));
  await page.type('#login-id', user); await page.type('#login-pw', 'wrong-password');
  await page.click('button', '로그인');
  await waitFor(() => page.count('.alert'));
  check('틀린 로그인: 입력칸 위에 오류 글', (await page.text('.alert')).includes('아이디 또는 비밀번호가 맞지 않습니다'));
  await page.shot('Login');

  await page.click('a', '회원가입');
  await waitFor(() => page.count('#reg-username'));
  await page.type('#reg-username', user); await page.type('#reg-password', pw); await page.type('#reg-email', `${user}@example.com`);
  await page.click('button', '가입하기');
  await waitFor(async () => (await page.count('#login-id')) > 0);
  check('가입 성공: 알림 창 없이 로그인 화면, 아이디 채움', (await page.eval(`document.querySelector('#login-id')?.value`)) === user && page.dialogs.length === 0);
  check('가입 직후 비밀번호 칸에 초점(입력 가능)', (await page.eval(`document.activeElement?.id`)) === 'login-pw');

  // 같은 아이디로 다시 가입 → 입력칸 아래 오류
  await page.click('a', '회원가입');
  await waitFor(() => page.count('#reg-username'));
  await page.type('#reg-username', user); await page.type('#reg-password', pw); await page.type('#reg-email', `other-${user}@example.com`);
  await page.click('button', '가입하기');
  await waitFor(() => page.count('.field__error'));
  check('중복 아이디: 입력칸 아래 오류 글', (await page.text('.field__error')).includes('이미 쓰고 있는 아이디입니다'));
  await page.shot('Register');
  await page.click('a', '로그인');
  await waitFor(() => page.count('#login-id'));

  await page.type('#login-id', user); await page.type('#login-pw', pw);
  await page.click('.check input'); // 아이디 기억하기
  await page.click('button', '로그인');
  await waitFor(async () => (await page.hash()).startsWith('#/home'));
  check('로그인 성공: 알림 없이 홈으로', (await page.hash()).startsWith('#/home') && page.dialogs.length === 0 && (await page.count('.toast')) === 0);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await waitFor(() => page.count('.home-empty'));
  await sleep(1200);
  check('폴더 없음 화면', (await page.text()).includes('백업할 폴더를 골라 주세요'));
  check('머리줄 상태: 모두 동기화됨', (await page.text('.app-header')).includes('모두 동기화됨'));
  await page.shot('HomeEmpty');

  // ── 2. 폴더 등록, 버전 3개 ──
  // OS의 폴더 선택 창은 조작할 수 없으므로 그 반환값만 바꿔 끼우고, 화면의 "폴더 추가" 버튼을 누른다
  await page.eval(`(() => { const { ipcRenderer } = window.require('electron'); const orig = ipcRenderer.invoke.bind(ipcRenderer);
    ipcRenderer.invoke = (ch, ...a) => (ch === 'open-folder-dialog' ? Promise.resolve(${JSON.stringify(FOLDER)}) : orig(ch, ...a)); })()`);
  await page.click('.home-empty button', '폴더 추가');
  await waitFor(() => page.count('.folder-row'));
  const folderId = await page.eval(`window.require('electron').ipcRenderer.invoke('sync:folders').then(l => l[0] && l[0].id)`);
  check('폴더 추가 버튼으로 등록', !!folderId && (await page.text('.toast')).includes('폴더를 추가했습니다'), `id ${folderId}`);
  await page.click('.toast .icon-btn').catch(() => {});
  check('등록한 폴더가 목록에 나타남(새로 고침 없이)', (await page.text('.folder-list')).includes(FOLDER_NAME));
  check('이 PC에서의 경로 표시', (await page.text('.folder-row__path')).includes(FOLDER));
  await sleep(5000);
  const V2 = V1 + '둘째 문단을 추가했다.\n';
  const V3 = V2 + '셋째 문단도 추가했다.\n';
  fs.writeFileSync(intro, V2); await sleep(4500);
  fs.writeFileSync(intro, V3); await sleep(4500);
  check('폴더 상태 표시: 동기화됨', (await page.text('.folder-row')).includes('동기화됨'));
  check('이 기기 칸: 기기 이름·서버·확인 주기', (await page.text('.home-side')).includes(os.hostname()) && (await page.text('.home-side')).includes(API) && (await page.text('.home-side')).includes('3초마다'));
  await page.shot('Main');

  // 메뉴: ⋯ 왼쪽 클릭으로 열고 Esc·바깥 클릭으로 닫힘
  await page.click('.folder-row .icon-btn');
  check('폴더 메뉴가 왼쪽 클릭으로 열림', (await page.count('.menu')) === 1 && (await page.text('.menu')).includes('동기화 폴더 삭제'));
  await page.shot('States-folder-menu');
  await page.key('Escape');
  check('Esc로 메뉴 닫힘', (await page.count('.menu')) === 0);
  await page.click('.folder-row .icon-btn');
  await page.click({ x: 500, y: 700 });
  check('바깥 클릭으로 메뉴 닫힘', (await page.count('.menu')) === 0);
  await page.click('.folder-row .icon-btn');
  await page.click('.menu__item', '폴더 정보');
  check('폴더 정보 창', (await page.text('.dialog')).includes('이 PC의 위치'));
  await page.shot('States-folder-info');
  await page.click('.dialog button', '닫기');
  await page.click('.btn--user');
  check('사용자 메뉴', (await page.text('.menu')).includes('로그아웃') && (await page.text('.menu')).includes(os.hostname()));
  await page.shot('States-user-menu');
  await page.key('Escape');

  // ── 3. 폴더 화면 ──
  await page.click('.folder-row__open');
  await waitFor(async () => (await page.count('.table tbody tr')) >= 4);
  const tableText = await page.text('.table');
  check('파일 표: 이름·크기·시각·버전', tableText.includes('서론 초안.txt') && tableText.includes('v3') && tableText.includes('KB') && tableText.includes('오늘'));
  check('하위 폴더 줄: 파일 수', tableText.includes('실험 데이터') && tableText.includes('파일 2개'));
  check('탭: 파일 5 / 삭제된 파일 0', (await page.text('.tabs')).replace(/\s+/g, ' ').includes('파일 5') && (await page.text('.tabs')).includes('삭제된 파일 0'));
  const scroll = await page.eval(`JSON.stringify({ v: document.documentElement.scrollHeight > document.documentElement.clientHeight, h: document.documentElement.scrollWidth > document.documentElement.clientWidth })`);
  check('스크롤바가 항상 보이지 않음(내용이 넘치지 않으면 없음)', scroll === '{"v":false,"h":false}', scroll);

  await page.click('.name-cell', '실험 데이터');
  await waitFor(async () => (await page.text('.crumbs')).includes('실험 데이터'));
  check('하위 폴더로 들어가면 현재 위치 경로가 보임', (await page.text('.table')).includes('절감률.csv') && (await page.text('.folder-head')).includes(path.join(FOLDER, '실험 데이터')));
  await page.shot('Folder-subfolder');
  await page.click('.crumbs button', FOLDER_NAME);
  await waitFor(async () => (await page.text('.table')).includes('서론 초안.txt'));
  check('경로를 눌러 위 단계로 이동', (await page.text('.table')).includes('서론 초안.txt'));
  // 뒤로 버튼: 하위 폴더에서는 한 단계 위로, 맨 위에서는 홈으로
  await page.click('.name-cell', '실험 데이터');
  await waitFor(async () => (await page.text('.crumbs')).includes('실험 데이터'));
  await page.click('.folder-nav__back');
  await waitFor(async () => (await page.text('.table')).includes('서론 초안.txt'));
  check('뒤로 버튼: 하위 폴더에서 한 단계 위로', (await page.text('.table')).includes('서론 초안.txt') && !(await page.text('.crumbs')).includes('실험 데이터'));
  await page.click('.folder-nav__back');
  await waitFor(async () => (await page.hash()).startsWith('#/home'));
  check('뒤로 버튼: 맨 위에서는 동기화 폴더 목록으로', (await page.hash()).startsWith('#/home'));
  await page.click('.folder-row__open');
  await waitFor(async () => (await page.count('.table tbody tr')) >= 4);

  const rowMenu = `(() => { const tr = [...document.querySelectorAll('.table tbody tr')].find(r => r.querySelector('.name')?.textContent.trim() === '서론 초안.txt'); const b = tr.querySelector('.icon-btn'); const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`;
  await page.click(await page.eval(rowMenu));
  const menuText = await page.text('.menu');
  check('파일 메뉴 4개', ['다른 이름으로 저장', '공유 링크 복사', '파일 정보', '삭제'].every((t) => menuText.includes(t)) && (await page.count('.menu__item')) === 4);
  await page.shot('Folder');
  await page.click('.menu__item', '파일 정보');
  check('파일 정보 창(JSON alert 아님)', (await page.text('.dialog')).includes('현재 버전') && (await page.text('.dialog')).includes('v3') && page.dialogs.length === 0);
  await page.shot('States-file-info');
  await page.key('Escape');
  check('Esc로 정보 창 닫힘', (await page.count('.dialog')) === 0);
  await page.click(await page.eval(rowMenu));
  await page.click('.menu__item', '공유 링크 복사');
  await waitFor(() => page.count('.toast'));
  const clip = await page.eval(`window.require('electron').clipboard.readText()`);
  check('공유 링크 복사: 알림 + 클립보드', (await page.text('.toast')).includes('공유 링크를 복사했습니다') && /^https:\/\//.test(clip));
  await page.shot('States-toast-share');
  await page.click('.toast .icon-btn');

  // ── 4. 버전 기록 창 ──
  const openVersionWindow = async (inst, pg, fileName) => {
    const before = (await targets(inst.port)).map((t) => t.id);
    const pt = await pg.eval(`(() => { const tr = [...document.querySelectorAll('.table tbody tr')].find(r => r.querySelector('.name')?.textContent.trim() === ${JSON.stringify(fileName)}); const b = [...tr.querySelectorAll('button')].find(x => x.textContent.trim() === '버전 기록'); const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
    await pg.click(pt);
    const t = await waitFor(async () => (await targets(inst.port)).find((x) => !before.includes(x.id)), { timeout: 10000 });
    const w = await Cdp.open(t.webSocketDebuggerUrl, { width: 820, height: 760 });
    windows.push(w);
    await waitFor(() => w.count('.ver-item'));
    return w;
  };
  const ver = await openVersionWindow(A, page, '서론 초안.txt');
  check('버전 3개, 최신순, 최신에 "현재"', (await ver.count('.ver-item')) === 3 && (await ver.text('.ver-item')).includes('v3') && (await ver.text('.ver-item')).includes('현재'));
  const verText = await ver.text('.ver-list');
  check('줄마다 전체본/변경분·저장 크기·기기 이름', verText.includes('전체본') && verText.includes('변경분') && verText.includes('저장 · 파일') && verText.includes(os.hostname()));
  check('요약 세 칸', (await ver.text('.ver-stats')).includes('3개') && (await ver.text('.ver-stats')).includes('실제 저장한 크기') && (await ver.text('.ver-stats')).includes('전부 통째로 저장했다면'));
  check('현재 버전에는 되돌리기 버튼 없음', !(await ver.text('.ver-item')).includes('이 버전으로 되돌리기') && (await ver.text('.ver-list')).includes('이 버전으로 되돌리기'));

  // 메모: v2에 저장
  await ver.click('[data-version="2"] button', '메모 추가');
  await waitFor(() => ver.count('.dialog textarea'));
  await ver.type('#memo', '둘째 문단 추가');
  await ver.shot('States-memo');
  await ver.click('.dialog button', '저장');
  await waitFor(async () => (await ver.text('[data-version="2"]')).includes('둘째 문단 추가'));
  check('메모 저장 후 줄에 표시', (await ver.text('[data-version="2"]')).includes('둘째 문단 추가') && (await ver.text('[data-version="2"]')).includes('메모 수정'));
  await ver.click('[data-version="1"] button', '메모 추가');
  await ver.type('#memo', '처음 올린 파일');
  await ver.click('.dialog button', '저장');
  await waitFor(async () => (await ver.text('[data-version="1"]')).includes('처음 올린 파일'));
  await ver.shot('Versions');

  // ── 5. 두 번째 인스턴스(기기 B)에서 같은 메모가 보이는지 ──
  B = launch('B', 9334);
  const pageB = await Cdp.open((await targets(B.port))[0].webSocketDebuggerUrl);
  windows.push(pageB);
  await waitFor(() => pageB.count('#login-id'));
  await pageB.type('#login-id', user); await pageB.type('#login-pw', pw);
  await pageB.click('button', '로그인');
  await waitFor(() => pageB.count('.folder-row'), { timeout: 20000 });
  const homeB = path.join(RUN, 'B', 'home', 'XOR', user, FOLDER_NAME);
  await waitFor(() => fs.existsSync(path.join(homeB, '서론 초안.txt')), { timeout: 30000, label: 'B 내려받기' });
  await sleep(1500);
  check('B: 폴더가 자동으로 나타나고 "다른 기기에서 등록" 표시', (await pageB.text('.folder-row')).includes('다른 기기에서 등록') && (await pageB.text('.folder-row__path')).includes(homeB));
  check('B: 파일이 내려옴(내용 일치)', fs.existsSync(path.join(homeB, '서론 초안.txt')) && sha(path.join(homeB, '서론 초안.txt')) === sha(intro));
  await pageB.shot('Main-second-device');
  await pageB.click('.folder-row__open');
  await waitFor(async () => (await pageB.count('.table tbody tr')) >= 4);
  const verB = await openVersionWindow(B, pageB, '서론 초안.txt');
  check('B: 같은 메모가 보임(서버 저장)', (await verB.text('[data-version="2"]')).includes('둘째 문단 추가') && (await verB.text('[data-version="1"]')).includes('처음 올린 파일'));
  await verB.shot('Versions-second-device');

  // ── 6. 되돌리기 (A) ──
  await ver.click('[data-version="1"] button', '이 버전으로 되돌리기');
  await waitFor(() => ver.count('.dialog'));
  check('되돌리기 확인 창', (await ver.text('.dialog')).includes('v1로 되돌릴까요?'));
  await ver.shot('States-revert-confirm');
  await ver.click('.dialog button', '되돌리기');
  await waitFor(() => ver.count('.toast'));
  check('되돌리기 알림', (await ver.text('.toast')).includes('v1로 되돌렸습니다') && (await ver.text('.toast')).includes('v4로 저장됩니다'));
  check('로컬 파일이 v1 내용으로 바뀜', fs.readFileSync(intro, 'utf8') === V1);
  await waitFor(async () => (await ver.count('.ver-item')) === 4, { timeout: 15000, label: 'v4' });
  await ver.shot('States-toast-reverted');
  check('되돌린 내용이 새 버전 v4로 저장되고 창이 스스로 갱신됨', (await ver.count('.ver-item')) === 4 && (await ver.text('.ver-item')).includes('v4') && (await ver.text('.ver-item')).includes('현재'));
  check('메모는 그대로', (await ver.text('[data-version="2"]')).includes('둘째 문단 추가'));
  await waitFor(() => fs.readFileSync(path.join(homeB, '서론 초안.txt'), 'utf8') === V1, { timeout: 15000, label: 'B에 v4' });
  check('B의 파일도 v1 내용으로 바뀜', fs.readFileSync(path.join(homeB, '서론 초안.txt'), 'utf8') === V1);
  await ver.eval('window.close()').catch(() => {});

  // ── 7. 삭제 → 삭제된 파일 탭 → 되살리기 ──
  await waitFor(async () => (await page.text('.table')).includes('v4'));
  await page.click(await page.eval(rowMenu));
  await page.click('.menu__item', '삭제');
  await waitFor(() => page.count('.dialog'));
  check('삭제 확인 창', (await page.text('.dialog')).includes('서론 초안.txt를 삭제할까요?'));
  await page.shot('States-delete-confirm');
  await page.click('.dialog button', '삭제');
  await waitFor(() => !fs.existsSync(intro), { timeout: 15000, label: '로컬 삭제' });
  check('삭제: 로컬 파일이 휴지통으로(폴더에서 사라짐)', !fs.existsSync(intro));
  await waitFor(async () => (await page.text('.tabs')).includes('삭제된 파일 1'));
  check('탭 숫자 갱신: 삭제된 파일 1', (await page.text('.tabs')).includes('삭제된 파일 1') && !(await page.text('.table')).includes('서론 초안.txt'));
  await waitFor(() => !fs.existsSync(path.join(homeB, '서론 초안.txt')), { timeout: 15000, label: 'B 삭제 전파' });
  check('B에서도 삭제됨', !fs.existsSync(path.join(homeB, '서론 초안.txt')));
  // 하위 폴더의 파일도 하나 지워 "어느 폴더" 표시를 본다 (탐색기에서 지운 경우)
  fs.rmSync(path.join(FOLDER, '실험 데이터', '옛 목차.txt'));
  await waitFor(async () => (await page.text('.tabs')).includes('삭제된 파일 2'), { timeout: 15000, label: '삭제 2' });
  await page.click('.toast .icon-btn').catch(() => {});
  await page.click('.tab', '삭제된 파일');
  await waitFor(() => page.count('.banner'));
  const delText = await page.text('.table');
  check('삭제된 파일 탭: 목록·마지막 버전·폴더 표시', delText.includes('서론 초안.txt') && delText.includes('v4') && delText.includes('옛 목차.txt') && delText.includes('실험 데이터 폴더') && delText.includes('마지막 수정'));
  await page.shot('Deleted');
  const verDel = await openVersionWindow(A, page, '서론 초안.txt');
  check('삭제된 파일의 버전 기록이 열림("현재" 없음)', (await verDel.count('.ver-item')) === 4 && !(await verDel.text('.ver-list')).includes('현재') && (await verDel.text('.ver-header')).includes('삭제된 파일'));
  await verDel.eval('window.close()').catch(() => {});
  const revive = await page.eval(`(() => { const tr = [...document.querySelectorAll('.table tbody tr')].find(r => r.querySelector('.name')?.textContent.trim() === '서론 초안.txt'); const b = [...tr.querySelectorAll('button')].find(x => x.textContent.trim() === '되살리기'); const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
  await page.click(revive);
  await waitFor(() => fs.existsSync(intro), { timeout: 10000 });
  check('되살리기: 원래 자리에 파일이 다시 생김(마지막 버전 내용)', fs.existsSync(intro) && fs.readFileSync(intro, 'utf8') === V1);
  await waitFor(async () => (await page.text('.tabs')).includes('삭제된 파일 1'), { timeout: 15000, label: '되살린 뒤 탭' });
  check('되살린 뒤 삭제된 파일 1', (await page.text('.tabs')).includes('삭제된 파일 1') && (await page.text('.toast')).includes('되살렸습니다'));
  await page.shot('States-toast-revived');
  await page.click('.tab', '파일');
  await waitFor(async () => (await page.text('.table')).includes('서론 초안.txt'));
  check('되살린 파일이 같은 파일의 v5로 이어짐', /서론 초안\.txt[\s\S]*v5/.test(await page.text('.table')));
  await waitFor(() => fs.existsSync(path.join(homeB, '서론 초안.txt')), { timeout: 15000, label: 'B 되살림' });
  check('B에도 다시 내려옴', fs.existsSync(path.join(homeB, '서론 초안.txt')));

  // ── 8. 충돌: 이 PC에서 고친 직후(올리기 전) 다른 기기가 같은 파일을 올린다 ──
  await page.click('.toast .icon-btn').catch(() => {});
  const ref = path.join(FOLDER, '참고문헌.md');
  fs.appendFileSync(ref, '- 이 PC에서 추가한 문헌\n');
  const up = await page.eval(`(async () => { const t = localStorage.getItem('token'); const u = JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;
    const fd = new FormData(); fd.append('file', new Blob(['# 참고문헌\\n- 다른 기기에서 고친 내용\\n']), '참고문헌.md'); fd.append('relativePath', ''); fd.append('baseVersion', '1');
    const r = await fetch(${JSON.stringify(API)} + '/users/' + u + '/sync-folders/${folderId}/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'X-Device-Id': 'capture-other-device', 'X-Device-Name': 'MacBook-Air' }, body: fd });
    return r.status; })()`);
  log.push('다른 기기 업로드: ' + up);
  await waitFor(async () => (await page.count('.toast--warn')) > 0, { timeout: 20000, label: '충돌 알림' });
  check('충돌 알림에 사본 위치 보기', (await page.text('.toast--warn')).includes('다른 기기와 동시에 수정했습니다') && (await page.text('.toast--warn')).includes('MacBook-Air') && (await page.text('.toast--warn')).includes('사본 위치 보기'));
  check('머리줄 상태: 충돌 사본 1개', (await page.text('.app-header')).includes('충돌 사본 1개'));
  await waitFor(async () => (await page.text('.table')).includes('충돌 사본'), { timeout: 15000, label: '충돌 사본 줄' });
  await sleep(800);
  check('충돌 사본 줄 표시', /충돌 사본 · 참고문헌\.md의 v2/.test(await page.text('.table')), (await page.text('.table')).match(/충돌 사본[^\n]*/)?.[0]);
  await page.shot('Folder-conflict');
  const verRef = await openVersionWindow(A, page, '참고문헌.md');
  check('버전 기록의 충돌 표시', (await verRef.text('.ver-list')).includes('v2와 동시에 수정됨') && (await verRef.text('.ver-list')).includes('MacBook-Air'));
  await verRef.shot('Versions-conflict');
  await verRef.eval('window.close()').catch(() => {});

  // ── 8-1. 하위 폴더 삭제 ──
  const closeToasts = async (pg) => { for (let i = 0; i < 5 && (await pg.count('.toast')) > 0; i++) await pg.click('.toast .icon-btn').catch(() => {}); };
  await closeToasts(page);
  const deletedBefore = Number((await page.text('.tabs')).match(/삭제된 파일 (\d+)/)[1]);
  const dirMenu = await page.eval(`(() => { const tr = [...document.querySelectorAll('.table tbody tr')].find(r => r.querySelector('.name')?.textContent.trim() === '실험 데이터'); const b = tr.querySelector('.icon-btn'); const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
  await page.click(dirMenu);
  await page.click('.menu__item', '폴더 삭제');
  await waitFor(() => page.count('.dialog'));
  check('하위 폴더 삭제 확인 창', (await page.text('.dialog')).includes('실험 데이터 폴더를 삭제할까요?') && (await page.text('.dialog')).includes('파일 1개'));
  await page.shot('States-subfolder-delete-confirm');
  await page.click('.dialog button', '삭제');
  await waitFor(() => !fs.existsSync(path.join(FOLDER, '실험 데이터', '절감률.csv')), { timeout: 15000, label: '하위 폴더 파일 삭제' });
  await waitFor(async () => (await page.text('.tabs')).includes(`삭제된 파일 ${deletedBefore + 1}`), { timeout: 10000 });
  check('하위 폴더 삭제: 안의 파일이 휴지통으로 가고 삭제된 파일 탭에 나옴',
    !fs.existsSync(path.join(FOLDER, '실험 데이터', '절감률.csv')) && (await page.text('.tabs')).includes(`삭제된 파일 ${deletedBefore + 1}`) && !(await page.text('.table')).includes('실험 데이터'));
  await waitFor(() => !fs.existsSync(path.join(homeB, '실험 데이터', '절감률.csv')), { timeout: 15000, label: 'B 하위 폴더 삭제' });
  check('B에서도 하위 폴더의 파일이 삭제됨', !fs.existsSync(path.join(homeB, '실험 데이터', '절감률.csv')));

  // ── 8-1b. 삭제된 파일 탭에서 폴더 단위로 되살리기 (없어진 하위 폴더가 다시 만들어진다) ──
  await closeToasts(page);
  await page.click('.tab', '삭제된 파일');
  await waitFor(() => page.count('.banner'));
  const dirRevive = await page.eval(`(() => { const tr = [...document.querySelectorAll('.table tbody tr')].find(r => r.querySelector('.name')?.textContent.trim() === '실험 데이터'); if (!tr) return null; const b = [...tr.querySelectorAll('button')].find(x => x.textContent.trim() === '폴더 되살리기'); const r = b.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
  check('삭제된 파일 탭에 폴더 줄과 "폴더 되살리기", "모두 되살리기"', !!dirRevive && (await page.text('.table')).includes('삭제된 파일 2개가 있던 폴더') && (await page.text('.deleted-tools')).includes('모두 되살리기'));
  await page.shot('Deleted-folder');
  await page.click(dirRevive);
  await waitFor(() => page.count('.dialog'));
  check('폴더 되살리기 확인 창', (await page.text('.dialog')).includes('실험 데이터 폴더의 파일 2개를 되살릴까요?'));
  await page.click('.dialog button', '되살리기');
  await waitFor(() => fs.existsSync(path.join(FOLDER, '실험 데이터', '절감률.csv')) && fs.existsSync(path.join(FOLDER, '실험 데이터', '옛 목차.txt')), { timeout: 15000, label: '폴더 되살리기' });
  check('폴더 되살리기: 없어진 하위 폴더가 다시 생기고 파일 2개가 돌아옴', fs.existsSync(path.join(FOLDER, '실험 데이터', '절감률.csv')) && fs.existsSync(path.join(FOLDER, '실험 데이터', '옛 목차.txt')));
  await waitFor(() => fs.existsSync(path.join(homeB, '실험 데이터', '절감률.csv')) && fs.existsSync(path.join(homeB, '실험 데이터', '옛 목차.txt')), { timeout: 20000, label: 'B에 폴더 되살림' });
  check('되살린 폴더의 파일이 B에도 내려옴', fs.existsSync(path.join(homeB, '실험 데이터', '절감률.csv')) && fs.existsSync(path.join(homeB, '실험 데이터', '옛 목차.txt')));
  await waitFor(async () => (await page.text('.tabs')).includes(`삭제된 파일 ${deletedBefore - 1}`), { timeout: 10000 });
  check('되살린 뒤 삭제된 파일 수가 줄어듦', (await page.text('.tabs')).includes(`삭제된 파일 ${deletedBefore - 1}`));

  // ── 8-2. 폴더별 동기화 중지 → 앱을 껐다 켜도 유지 → 다시 시작 ──
  await closeToasts(page);
  await page.click('.brand');
  await waitFor(() => page.count('.folder-row'));
  await page.click('.folder-row .icon-btn');
  await page.click('.menu__item', '동기화 중지');
  await waitFor(async () => (await page.text('.folder-row')).includes('동기화 중지됨'));
  check('폴더별 중지: 줄에 "동기화 중지됨"', (await page.text('.folder-row')).includes('동기화 중지됨') && (await page.text('.toast')).includes('동기화를 멈췄습니다'));
  await page.shot('Main-folder-paused');
  fs.writeFileSync(path.join(FOLDER, '멈춘 동안 만든 파일.txt'), '폴더를 멈춘 동안 이 PC에서 만든 파일\n');
  await page.eval(`(async () => { const t = localStorage.getItem('token'); const u = JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;
    const fd = new FormData(); fd.append('file', new Blob(['멈춘 동안 다른 기기가 올린 파일\\n']), '다른 기기의 새 파일.txt'); fd.append('relativePath', ''); fd.append('baseVersion', '0');
    return (await fetch(${JSON.stringify(API)} + '/users/' + u + '/sync-folders/${folderId}/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'X-Device-Id': 'capture-other-device', 'X-Device-Name': 'MacBook-Air' }, body: fd })).status; })()`);
  await waitFor(() => fs.existsSync(path.join(homeB, '다른 기기의 새 파일.txt')), { timeout: 15000, label: 'B가 다른 기기 파일 받음' });
  await sleep(7000);
  check('멈춘 동안: 이 PC의 새 파일이 올라가지 않음(B에 없음)', !fs.existsSync(path.join(homeB, '멈춘 동안 만든 파일.txt')));
  check('멈춘 동안: 다른 기기의 새 파일을 받지 않음(B는 받음)', !fs.existsSync(path.join(FOLDER, '다른 기기의 새 파일.txt')) && fs.existsSync(path.join(homeB, '다른 기기의 새 파일.txt')));

  // 앱 A를 껐다 켠다
  A.child.kill();
  await sleep(2500);
  A = launch('A', 9333);
  page = await Cdp.open((await targets(A.port))[0].webSocketDebuggerUrl);
  windows.push(page);
  await waitFor(() => page.count('#login-id'));
  await page.type('#login-pw', pw);
  await page.click('button', '로그인');
  await waitFor(() => page.count('.folder-row'), { timeout: 20000 });
  await sleep(7000);
  check('앱을 껐다 켜도 폴더 중지가 유지됨', (await page.text('.folder-row')).includes('동기화 중지됨')
    && !fs.existsSync(path.join(homeB, '멈춘 동안 만든 파일.txt')) && !fs.existsSync(path.join(FOLDER, '다른 기기의 새 파일.txt')));
  await page.click('.folder-row .icon-btn');
  await page.click('.menu__item', '동기화 다시 시작');
  await waitFor(() => fs.existsSync(path.join(homeB, '멈춘 동안 만든 파일.txt')) && fs.existsSync(path.join(FOLDER, '다른 기기의 새 파일.txt')), { timeout: 20000, label: '다시 시작 후 양방향' });
  check('다시 시작: 멈춘 동안의 변경이 양쪽으로 맞춰짐', fs.existsSync(path.join(homeB, '멈춘 동안 만든 파일.txt')) && fs.existsSync(path.join(FOLDER, '다른 기기의 새 파일.txt')) && (await page.text('.folder-row')).includes('동기화됨'));

  // ── 8-3. 전체 동기화 중지 → 머리줄에서 다시 시작 ──
  await closeToasts(page);
  await page.click('.home-side button', '전체 동기화 중지');
  await waitFor(async () => (await page.text('.app-header')).includes('동기화 중지됨'));
  check('전체 중지: 머리줄·폴더 줄·이 기기 칸 표시', (await page.text('.app-header')).includes('동기화 중지됨 · 다시 시작') && (await page.text('.folder-row')).includes('동기화 중지됨') && (await page.text('.home-side')).includes('동기화 다시 시작'));
  await page.shot('Main-all-paused');
  fs.writeFileSync(path.join(FOLDER, '전체를 멈춘 동안.txt'), '전체 중지 중에 만든 파일\n');
  await sleep(7000);
  check('전체 중지 동안 올라가지 않음', !fs.existsSync(path.join(homeB, '전체를 멈춘 동안.txt')));

  // 전체 중지 중 "폴더 추가": 서버에 이름만 등록되고 파일은 다시 시작할 때 올라간다
  const SECOND = path.join(RUN, 'A-docs', '참고 폴더'); // 목록에서 첫 폴더 뒤에 오는 이름
  fs.mkdirSync(SECOND, { recursive: true });
  fs.writeFileSync(path.join(SECOND, '메모.txt'), '전체 중지 중에 등록한 폴더의 파일\n');
  const secondAtB = path.join(RUN, 'B', 'home', 'XOR', user, '참고 폴더');
  await closeToasts(page);
  await page.eval(`(() => { const { ipcRenderer } = window.require('electron'); const orig = ipcRenderer.invoke.bind(ipcRenderer);
    ipcRenderer.invoke = (ch, ...a) => (ch === 'open-folder-dialog' ? Promise.resolve(${JSON.stringify(SECOND)}) : orig(ch, ...a)); })()`);
  await page.click('.home-title button', '폴더 추가');
  await waitFor(async () => (await page.count('.folder-row')) === 2, { timeout: 10000 });
  const secondRow = () => page.eval(`[...document.querySelectorAll('.folder-row')].find(r => r.textContent.includes('참고 폴더'))?.innerText || ''`);
  check('전체 중지 중 폴더 추가: 목록에 "동기화 중지됨"으로 나옴', (await page.count('.folder-row')) === 2 && (await secondRow()).includes('동기화 중지됨') && (await secondRow()).includes(SECOND));
  await page.shot('Main-all-paused-new-folder');
  await waitFor(() => fs.existsSync(secondAtB), { timeout: 15000, label: 'B에 새 폴더' });
  await sleep(6000);
  check('전체 중지 중 폴더 추가: 서버에 폴더는 등록되지만(B에 폴더가 생김) 파일은 올라가지 않음', fs.existsSync(secondAtB) && !fs.existsSync(path.join(secondAtB, '메모.txt')));
  await closeToasts(page);
  await page.click('.app-header .pill');
  await waitFor(() => fs.existsSync(path.join(homeB, '전체를 멈춘 동안.txt')), { timeout: 20000, label: '전체 다시 시작' });
  check('머리줄에서 다시 시작: 파일이 올라가 B에 내려옴', fs.existsSync(path.join(homeB, '전체를 멈춘 동안.txt')) && !(await page.text('.app-header')).includes('동기화 중지됨'));
  await waitFor(() => fs.existsSync(path.join(secondAtB, '메모.txt')), { timeout: 20000, label: '새 폴더 파일 올라감' });
  check('다시 시작하면 멈춘 중에 추가한 폴더의 파일도 올라가 B에 내려옴', fs.existsSync(path.join(secondAtB, '메모.txt')) && (await secondRow()).includes('동기화됨'));

  // ── 8-4. 위치 다시 지정: 앱이 꺼진(로그아웃) 동안 폴더를 옮긴 경우 ──
  await page.click('.btn--user');
  await page.click('.menu__item', '로그아웃');
  await waitFor(() => page.count('#login-id'));
  const MOVED = path.join(RUN, 'A-docs', '옮긴 곳', '논문 자료 (옮김)');
  fs.mkdirSync(path.dirname(MOVED), { recursive: true });
  fs.renameSync(FOLDER, MOVED);
  fs.rmSync(path.join(MOVED, '참고문헌.md')); // 옮긴 뒤 새 위치에는 이 파일이 없다 → 삭제로 전파되면 안 되고 다시 내려받아야 한다
  const filesAtB = () => fs.readdirSync(homeB).filter((n) => !n.startsWith('.')).sort().join('|');
  const bBefore = filesAtB();
  await page.type('#login-pw', pw);
  await page.click('button', '로그인');
  await waitFor(() => page.count('.folder-row--blocked'), { timeout: 20000, label: '멈춘 폴더 줄' });
  check('폴더가 없어지면 빨간 줄과 "위치 다시 지정" 버튼', (await page.text('.folder-row--blocked')).includes('동기화 중지 · 폴더를 찾을 수 없음') && (await page.text('.folder-row--blocked')).includes('위치 다시 지정'));
  await waitFor(async () => (await page.text('.app-header')).includes('멈춤'), { timeout: 8000 });
  check('머리줄에 "폴더 1개 멈춤"("모두 동기화됨"이 아님)', (await page.text('.app-header')).includes('폴더 1개 멈춤 · 보기') && !(await page.text('.app-header')).includes('모두 동기화됨'));
  await page.shot('Main-blocked');
  await sleep(5000);
  check('멈춘 동안 삭제가 전파되지 않음(B의 파일 그대로)', filesAtB() === bBefore, filesAtB());
  await page.eval(`(() => { const { ipcRenderer } = window.require('electron'); const orig = ipcRenderer.invoke.bind(ipcRenderer);
    ipcRenderer.invoke = (ch, ...a) => (ch === 'open-folder-dialog' ? Promise.resolve(${JSON.stringify(MOVED)}) : orig(ch, ...a)); })()`);
  await page.click('.folder-row--blocked button', '위치 다시 지정');
  await waitFor(async () => (await page.count('.folder-row--blocked')) === 0, { timeout: 10000 });
  await waitFor(() => fs.existsSync(path.join(MOVED, '참고문헌.md')), { timeout: 20000, label: '없는 파일 내려받기' });
  await sleep(4000);
  check('위치 다시 지정: 새 경로로 이어지고 없는 파일은 내려받음', (await page.text('.folder-row__path')).includes(MOVED) && fs.existsSync(path.join(MOVED, '참고문헌.md')) && (await page.text('.folder-row')).includes('동기화됨'));
  check('위치 다시 지정: 삭제가 전파되지 않음(B의 파일 그대로)', filesAtB() === bBefore, filesAtB());
  check('위치를 다시 지정하면 머리줄의 멈춤 표시가 사라짐', !(await page.text('.app-header')).includes('멈춤'));
  await page.shot('Main-relocated');
  fs.writeFileSync(path.join(MOVED, '옮긴 뒤 만든 파일.txt'), '새 위치에서 만든 파일\n');
  await waitFor(() => fs.existsSync(path.join(homeB, '옮긴 뒤 만든 파일.txt')), { timeout: 20000, label: '새 위치에서 동기화' });
  check('새 위치에서 동기화가 이어짐', fs.existsSync(path.join(homeB, '옮긴 뒤 만든 파일.txt')));

  // ── 8-5. 앱이 켜진 채로 동기화 폴더를 통째로 지운 경우: 삭제를 전파하지 않고 멈춘다. 폴더가 돌아오면 스스로 이어 간다 ──
  await closeToasts(page);
  await sleep(3000);
  const BACKUP = path.join(RUN, 'A-docs', '휴지통 흉내');
  fs.cpSync(MOVED, BACKUP, { recursive: true });
  const bBeforeDelete = filesAtB();
  fs.rmSync(MOVED, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  await waitFor(() => page.count('.folder-row--blocked'), { timeout: 20000, label: '실행 중 폴더 삭제 → 멈춤' });
  await sleep(7000);
  check('실행 중 폴더를 통째로 지우면 빨간 줄로 멈춤', (await page.count('.folder-row--blocked')) === 1 && (await page.text('.app-header')).includes('폴더 1개 멈춤') && !fs.existsSync(MOVED));
  check('실행 중 폴더 삭제가 파일 삭제로 전파되지 않음(B의 파일 그대로)', filesAtB() === bBeforeDelete, filesAtB());
  await page.shot('Main-blocked-while-running');
  fs.cpSync(BACKUP, MOVED, { recursive: true }); // 휴지통에서 폴더를 복원한 것과 같다
  await waitFor(async () => (await page.count('.folder-row--blocked')) === 0, { timeout: 30000, label: '폴더가 돌아와 이어짐' });
  await sleep(4000);
  check('폴더를 되돌려 놓으면 스스로 이어 감(위치 다시 지정 없이)', (await page.count('.folder-row--blocked')) === 0 && !(await page.text('.app-header')).includes('멈춤'));
  check('폴더가 돌아온 뒤에도 삭제가 전파되지 않음', filesAtB() === bBeforeDelete, filesAtB());
  fs.writeFileSync(path.join(MOVED, '돌아온 뒤 만든 파일.txt'), '폴더를 복원한 뒤 만든 파일\n');
  await waitFor(() => fs.existsSync(path.join(homeB, '돌아온 뒤 만든 파일.txt')), { timeout: 20000, label: '복원 뒤 동기화' });
  check('폴더가 돌아온 뒤 동기화가 이어짐', fs.existsSync(path.join(homeB, '돌아온 뒤 만든 파일.txt')));

  // ── 8-6. 앱이 꺼진(로그아웃) 동안 폴더를 지우고 같은 자리에 빈 폴더만 다시 만든 경우: 전부 삭제로 전파하지 않고 멈춘다 ──
  await closeToasts(page);
  await sleep(3000);
  await page.click('.btn--user');
  await page.click('.menu__item', '로그아웃');
  await waitFor(() => page.count('#login-id'));
  const bBeforeEmpty = filesAtB();
  const countBefore = fs.readdirSync(MOVED).length;
  fs.rmSync(MOVED, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  fs.mkdirSync(MOVED, { recursive: true });
  await page.type('#login-pw', pw);
  await page.click('button', '로그인');
  await waitFor(() => page.count('.folder-row--blocked'), { timeout: 20000, label: '빈 폴더 → 멈춤' });
  await sleep(8000);
  check('빈 폴더만 있으면 다시 로그인해도 멈춤("폴더가 비어 있음")', (await page.text('.folder-row--blocked')).includes('동기화 중지 · 폴더가 비어 있음') && (await page.text('.app-header')).includes('폴더 1개 멈춤'));
  check('빈 폴더가 "전부 삭제"로 전파되지 않음(B의 파일 그대로)', filesAtB() === bBeforeEmpty && fs.readdirSync(MOVED).length === 0, filesAtB());
  await page.shot('Main-blocked-empty');
  await page.eval(`(() => { const { ipcRenderer } = window.require('electron'); const orig = ipcRenderer.invoke.bind(ipcRenderer);
    ipcRenderer.invoke = (ch, ...a) => (ch === 'open-folder-dialog' ? Promise.resolve(${JSON.stringify(MOVED)}) : orig(ch, ...a)); })()`);
  await page.click('.folder-row--blocked button', '위치 다시 지정');
  await waitFor(async () => (await page.count('.folder-row--blocked')) === 0, { timeout: 10000 });
  await waitFor(() => fs.readdirSync(MOVED).length >= countBefore, { timeout: 30000, label: '빈 폴더로 다시 내려받기' });
  await sleep(3000);
  check('같은 폴더로 위치를 다시 지정하면 서버의 파일을 전부 내려받음', fs.readdirSync(MOVED).length >= countBefore && filesAtB() === bBeforeEmpty, `${fs.readdirSync(MOVED).length}/${countBefore}`);

  // ── 9. 로그아웃 ──
  await closeToasts(page);
  await page.click('.btn--user');
  await page.click('.menu__item', '로그아웃');
  await waitFor(() => page.count('#login-id'));
  const st = await page.eval(`window.require('electron').ipcRenderer.invoke('sync:get-status').then(s => s.state)`);
  check('로그아웃: 로그인 화면, 엔진 정지, 아이디 기억 유지', (await page.count('#login-id')) === 1 && st === 'stopped' && (await page.eval(`document.querySelector('#login-id').value`)) === user);
  check('alert/confirm 창이 한 번도 뜨지 않음', windows.every((w) => w.dialogs.length === 0), JSON.stringify(windows.flatMap((w) => w.dialogs)));
  const errs = windows.flatMap((w) => w.errors);
  check('렌더러 예외 없음', errs.length === 0, errs.join(' | ').slice(0, 300));

  // 정리: 시험 폴더를 서버에서 지운다 (B의 토큰으로)
  const del = await pageB.eval(`(async () => { const t = localStorage.getItem('token'); const u = JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub;
    const list = await (await fetch(${JSON.stringify(API)} + '/users/' + u + '/sync-folders', { headers: { Authorization: 'Bearer ' + t } })).json();
    const out = []; for (const f of list) { const r = await fetch(${JSON.stringify(API)} + '/users/' + u + '/sync-folders/' + f.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } }); out.push(f.id + ':' + r.status); } return out.join(','); })()`);
  log.push('정리: ' + del);
} catch (e) {
  check('스크립트가 끝까지 실행됨', false, e.stack || e.message);
} finally {
  A?.child.kill(); B?.child.kill();
  await sleep(1500);
  fs.rmSync(RUN, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  console.log(log.join('\n'));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
  process.exit(failed.length ? 1 : 0);
}
