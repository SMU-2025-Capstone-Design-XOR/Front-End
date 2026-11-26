// test/e2e/sync.mjs (11/18까지 scripts/e2e-sync.mjs)
// 동기화 엔진 종단 시험: 한 프로세스에서 엔진 2개(기기 A, B)를 Electron 없이 돌린다.
// 상태 디렉터리·로컬 폴더·기기 ID는 기기마다 따로 쓴다. 휴지통은 기기별 trash 디렉터리로 대신한다.
//
// 실행: BE를 local 프로필로 띄운 뒤   npm run test:e2e:sync -- [--word]   (= node test/e2e/sync.mjs)
//   XOR_API_BASE (기본 http://localhost:8080), XOR_E2E_POLL_MS (기본 3000), XOR_KEEP=1 이면 시험 폴더를 남긴다.
//   --word : 실제 Word(COM)로 .docx를 두 번 저장하는 시나리오 3을 함께 돌린다 (Windows + Word 필요)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createApi } from '../../sync/api.js';
import { SyncEngine } from '../../sync/engine.js';
import { loadOrCreateDeviceId, loadState, stateFilePath } from '../../sync/state.js';
import { scanFolder, hashFile, hashBuffer } from '../../sync/scanner.js';

const BASE = process.env.XOR_API_BASE || 'http://localhost:8080';
const POLL_MS = Number(process.env.XOR_E2E_POLL_MS || 3000);
const WITH_WORD = process.argv.includes('--word');
const VERBOSE = process.argv.includes('--verbose');

const results = [];
let section = '';
function check(name, cond, detail = '') {
  results.push({ section, name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'} [${section}] ${name}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs = POLL_MS * 4 + 8000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try { if (await cond()) return true; } catch { /* 아직 아님 */ }
    if (Date.now() > end) return false;
    await sleep(150);
  }
}

// ───────── 서버 직접 호출 (검증용) ─────────
async function http(method, urlPath, { token, json } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + urlPath, { method, headers, body: json ? JSON.stringify(json) : undefined });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* JSON 아님 */ }
  return { status: res.status, body, text };
}

const username = `sync_${randomBytes(4).toString('hex')}`;
const password = randomBytes(12).toString('hex'); // 로컬 시험 계정용 임의 값
await http('POST', '/auth/signup', { json: { username, password, email: `${username}@example.test` } });
const login = await http('POST', '/auth/login', { json: { username, password } });
const token = login.body?.token;
if (!token) {
  console.error(`로그인 실패 (${login.status}). BE가 ${BASE}에 떠 있는지 확인하세요.`);
  process.exit(2);
}
const userId = Number(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub);

// ───────── 기기 2대 ─────────
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'xor-e2e-'));
const folderName = `동기화 시험 ${randomBytes(2).toString('hex')}`;

function makeDevice(label, deviceName) {
  const home = path.join(work, label);
  const dev = {
    label, deviceName,
    stateDir: path.join(home, 'userData', 'sync-state'),
    xorRoot: path.join(home, 'XOR'),
    trashDir: path.join(home, 'trash'),
    calls: { upload: 0, deleteFile: 0, download: 0, changes: 0 },
    events: [],
    engine: null,
    root: null,
  };
  fs.mkdirSync(dev.trashDir, { recursive: true });
  dev.deviceId = loadOrCreateDeviceId(path.join(home, 'userData'));
  return dev;
}

function startEngine(dev) {
  const api = createApi({ baseUrl: BASE, getToken: () => token, deviceId: dev.deviceId, deviceName: dev.deviceName });
  for (const name of Object.keys(dev.calls)) {
    const original = api[name];
    api[name] = (...args) => { dev.calls[name]++; return original(...args); };
  }
  dev.engine = new SyncEngine({
    api, userId, username,
    stateDir: dev.stateDir,
    xorRoot: dev.xorRoot,
    pollIntervalMs: POLL_MS,
    trash: async (abs) => {
      // 휴지통 대신 기기별 trash 디렉터리로 옮긴다 (완전 삭제하지 않는다는 점은 같다)
      fs.renameSync(abs, path.join(dev.trashDir, `${Date.now()}-${path.basename(abs)}`));
    },
    emit: (channel, payload) => dev.events.push({ channel, payload }),
    log: (msg) => { if (VERBOSE) console.log(`    (${dev.label}) ${msg}`); },
  });
  dev.engine.start();
}

const A = makeDevice('A', 'PC-A');
const B = makeDevice('B', '노트북-B');

const fileA = (rel) => path.join(A.root, rel);
const fileB = (rel) => path.join(B.root, rel);
const write = (abs, content) => { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, content); };
const read = (abs) => fs.readFileSync(abs, 'utf8');
const exists = (abs) => fs.existsSync(abs);
const sameContent = (abs, content) => exists(abs) && hashBuffer(fs.readFileSync(abs)) === hashBuffer(Buffer.from(content));
const body = (line, n = 30) => `${line}\n`.repeat(n);

let folderId = null;
const serverFiles = async () => (await http('GET', `/users/${userId}/sync-folders/${folderId}/files`, { token })).body;
const serverChanges = async () => (await http('GET', `/users/${userId}/sync-folders/${folderId}/changes?since=0`, { token })).body.changes;
async function versionsOf(rel) {
  const entry = (await serverChanges()).find((c) => c.relativePath === rel);
  if (!entry) return [];
  return (await http('GET', `/users/${userId}/sync-folders/${folderId}/files/${entry.fileId}/versions`, { token })).body;
}
async function totalVersions() {
  let n = 0;
  for (const c of await serverChanges()) {
    n += (await http('GET', `/users/${userId}/sync-folders/${folderId}/files/${c.fileId}/versions`, { token })).body.length;
  }
  return n;
}
async function tree(root) {
  const out = {};
  for (const rel of [...(await scanFolder(root)).keys()].sort()) out[rel] = await hashFile(path.join(root, rel));
  return out;
}
async function converged() {
  await Promise.all([A.engine.idle(), B.engine.idle()]);
  const [ta, tb, list] = await Promise.all([tree(A.root), tree(B.root), serverFiles()]);
  const ts = Object.fromEntries(list.map((f) => [f.relativePath, f.hash]).sort((x, y) => (x[0] < y[0] ? -1 : 1)));
  return JSON.stringify(ta) === JSON.stringify(tb) && JSON.stringify(ta) === JSON.stringify(ts) ? ta : null;
}

try {
  // ───────── 준비: A가 폴더 등록, B는 목록에서 연결 ─────────
  section = '준비';
  A.root = path.join(work, 'A', 'Documents', folderName); // 등록한 기기는 고른 경로를 그대로 쓴다
  write(fileA('기존 파일.txt'), body('등록 전에 이미 있던 파일'));
  startEngine(A);
  const reg = await A.engine.registerFolder(A.root);
  folderId = reg.folder?.id;
  check('A가 폴더 등록', reg.ok && reg.folder.name === folderName, `id ${folderId}`);
  const dup = await A.engine.registerFolder(path.join(work, 'A', 'Other', folderName));
  check('같은 이름 재등록 → 409 + current', dup.ok === false && dup.status === 409 && dup.current?.id === folderId);

  startEngine(B);
  B.root = path.join(B.xorRoot, username, folderName);
  check('B는 ~/XOR/{사용자명}/{폴더 이름}에 연결', await waitFor(() => B.engine.folderList().some((f) => f.id === folderId && f.localRoot === B.root)));
  check('등록 전부터 있던 파일이 B에 내려옴', await waitFor(() => sameContent(fileB('기존 파일.txt'), body('등록 전에 이미 있던 파일'))));

  // ───────── 1. 추가·수정·삭제 전파 ─────────
  section = '1 전파';
  const png = randomBytes(4096);
  write(fileA('a.txt'), body('a 첫 내용'));
  write(fileA('sub/한글 파일.md'), body('# 하위 폴더의 파일'));
  write(fileA('sub/deep/img.bin'), png);
  let t0 = Date.now();
  check('A에 추가한 파일 3개가 B에 나타남', await waitFor(() =>
    sameContent(fileB('a.txt'), body('a 첫 내용')) && sameContent(fileB('sub/한글 파일.md'), body('# 하위 폴더의 파일'))
    && exists(fileB('sub/deep/img.bin')) && hashBuffer(fs.readFileSync(fileB('sub/deep/img.bin'))) === hashBuffer(png)),
  `${Date.now() - t0}ms (폴링 ${POLL_MS}ms)`);

  write(fileA('a.txt'), body('a 첫 내용') + '둘째 줄 추가\n');
  t0 = Date.now();
  check('A에서 수정 → B에서 갱신', await waitFor(() => sameContent(fileB('a.txt'), body('a 첫 내용') + '둘째 줄 추가\n')), `${Date.now() - t0}ms`);
  const aVersions = await versionsOf('a.txt');
  check('a.txt는 v1, v2 두 버전 (기기 이름 기록)', aVersions.length === 2 && aVersions.every((v) => v.deviceName === 'PC-A'),
    aVersions.map((v) => `v${v.versionNumber} ${v.versionType}`).join(', '));

  fs.unlinkSync(fileA('sub/한글 파일.md'));
  t0 = Date.now();
  check('A에서 삭제 → B에서 폴더 밖(휴지통)으로', await waitFor(() => !exists(fileB('sub/한글 파일.md'))), `${Date.now() - t0}ms`);
  check('B의 파일은 완전 삭제가 아니라 휴지통에 있음', fs.readdirSync(B.trashDir).some((n) => n.endsWith('한글 파일.md')));
  check('서버에는 툼스톤으로 남음', (await serverChanges()).some((c) => c.relativePath === 'sub/한글 파일.md' && c.deleted));
  check('세 곳(A·B·서버) 내용 일치', await waitFor(converged));

  // ───────── 2. 감시 루프 없음 ─────────
  section = '2 감시 루프';
  await sleep(POLL_MS + 2500); // 다운로드 뒤 감시 이벤트(안정 1초)와 폴링 한 번이 지나가게 둔다
  await Promise.all([A.engine.idle(), B.engine.idle()]);
  check('B는 내려받기만 했고 업로드 0건', B.calls.upload === 0 && B.calls.deleteFile === 0, `B 업로드 ${B.calls.upload}, 삭제 ${B.calls.deleteFile}`);
  check('서버 버전 목록 그대로 (a.txt 2개)', (await versionsOf('a.txt')).length === 2);
  const versionsBeforeRestart = await totalVersions();

  // ───────── 1b. 재시작해도 중복 업로드 없음 ─────────
  section = '1 재시작';
  const uploadsBefore = { A: A.calls.upload, B: B.calls.upload };
  await A.engine.stop();
  await B.engine.stop();
  startEngine(A);
  startEngine(B);
  await sleep(POLL_MS + 1500);
  await Promise.all([A.engine.idle(), B.engine.idle()]);
  check('재시작 후 업로드 호출 0건', A.calls.upload === uploadsBefore.A && B.calls.upload === uploadsBefore.B,
    `A +${A.calls.upload - uploadsBefore.A}, B +${B.calls.upload - uploadsBefore.B}`);
  check('재시작 후 서버 버전 수 그대로', (await totalVersions()) === versionsBeforeRestart, `${versionsBeforeRestart}개`);
  const stA = loadState(stateFilePath(A.stateDir, userId, folderId));
  check('상태 파일: localRoot·cursor·기준 기록', stA.localRoot === A.root && stA.cursor > 0 && stA.files['a.txt']?.baseVersion === 2,
    `cursor ${stA.cursor}, 기준 ${Object.keys(stA.files).length}개`);

  // ───────── 3. Word 저장 (선택) ─────────
  if (WITH_WORD) {
    section = '3 Word';
    const docx = fileA('보고서.docx');
    const deletesBefore = A.calls.deleteFile;
    // 비동기로 실행한다: Word가 저장하는 동안에도 엔진(같은 프로세스)이 돌아야 한다
    const ps = (script) => promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    const q = docx.replace(/'/g, "''");
    // 새 문서를 만들어 저장하고 닫는다
    await ps(`$w = New-Object -ComObject Word.Application; $w.Visible = $false; $d = $w.Documents.Add(); $d.Content.Text = '첫 번째 저장 내용'; $d.SaveAs2('${q}'); $d.Close(); $w.Quit()`);
    check('Word 첫 저장 → v1 업로드', await waitFor(async () => (await versionsOf('보고서.docx')).length === 1, 30000));
    // 기존 문서를 열어 고치고 저장한다 (Word는 임시 파일에 쓰고 원본과 바꿔치기한다)
    await ps(`$w = New-Object -ComObject Word.Application; $w.Visible = $false; $d = $w.Documents.Open('${q}'); $d.Content.InsertAfter(' 두 번째 저장에서 덧붙인 문장.'); $d.Save(); Start-Sleep -Seconds 8; $d.Content.InsertAfter(' 세 번째.'); $d.Close(-1); $w.Quit()`);
    check('Word로 두 번 더 저장 → 버전이 둘씩 늘어남(v2, v3)', await waitFor(async () => (await versionsOf('보고서.docx')).length === 3, 30000));
    await sleep(4000);
    await A.engine.idle();
    const wv = await versionsOf('보고서.docx');
    check('삭제로 보고된 적 없음 (삭제 요청 0건, 툼스톤 아님)',
      A.calls.deleteFile === deletesBefore && !(await serverChanges()).find((c) => c.relativePath === '보고서.docx').deleted,
      wv.map((v) => `v${v.versionNumber} ${v.versionType} ${v.storedSize}B`).join(', '));
    check('Word 임시 파일(~$, .tmp)은 서버에 없음', !(await serverChanges()).some((c) => /~\$|\.tmp$/i.test(c.relativePath)));
    check('B에 같은 docx가 내려옴', await waitFor(async () => exists(fileB('보고서.docx')) && (await hashFile(fileB('보고서.docx'))) === (await hashFile(docx)), 30000));
  }

  // ───────── 4. 충돌 ─────────
  section = '4 충돌';
  await waitFor(converged);
  A.engine.pausePolling();
  B.engine.pausePolling();
  const contentA = body('a 첫 내용') + 'A가 고친 줄\n';
  const contentB = body('a 첫 내용') + 'B가 나중에 고친 줄\n';
  write(fileA('a.txt'), contentA);
  check('A의 수정이 먼저 서버에 도착 (v3)', await waitFor(async () => (await versionsOf('a.txt')).length === 3));
  write(fileB('a.txt'), contentB); // B는 아직 v2를 기준으로 알고 있다
  check('B의 업로드가 충돌을 거쳐 v4로 저장', await waitFor(async () => (await versionsOf('a.txt')).length === 4));
  A.engine.resumePolling();
  B.engine.resumePolling();

  const v = await versionsOf('a.txt');
  const v3 = v.find((x) => x.versionNumber === 3);
  const v4 = v.find((x) => x.versionNumber === 4);
  check('버전 목록: v4에 conflictWith = 3, 기기 이름이 각각 기록', v4?.conflictWith === 3 && v3?.deviceName === 'PC-A' && v4?.deviceName === '노트북-B',
    `v3 ${v3?.deviceName}, v4 ${v4?.deviceName} conflictWith=${v4?.conflictWith}`);
  const stamp = String(v3.createdDate).replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}).*$/, '$1$2$3-$4$5$6');
  const copyName = `a_PC-A_${stamp}.txt`;
  check('나중에 저장한 쪽(B)이 원래 이름을 가짐 — 양쪽 모두', await waitFor(() => sameContent(fileA('a.txt'), contentB) && sameContent(fileB('a.txt'), contentB)));
  check(`충돌 사본 ${copyName} 이 양쪽에 있고 A의 내용`, await waitFor(() => sameContent(fileA(copyName), contentA) && sameContent(fileB(copyName), contentA)));
  check('세 곳 내용 일치, 사본은 1개뿐', await waitFor(async () => {
    const t = await converged();
    return t && Object.keys(t).filter((k) => k.startsWith('a_')).length === 1;
  }));
  check('충돌 알림(sync:status) 발생', B.events.some((e) => e.channel === 'sync:status' && e.payload.state === 'conflict' && e.payload.copyPath === copyName));

  // ───────── 5. 수정이 삭제를 이긴다 ─────────
  section = '5 수정 vs 삭제';
  // 5a: B에 아직 올리지 못한 수정이 있는 동안 A가 삭제
  write(fileA('b.txt'), body('b 원본'));
  check('b.txt 준비', await waitFor(() => sameContent(fileB('b.txt'), body('b 원본'))));
  await sleep(1500);
  await B.engine.idle();
  await B.engine.stop();                         // B는 꺼져 있고(=동기화 안 된 수정)
  write(fileB('b.txt'), body('b 원본') + 'B의 미동기화 수정\n');
  fs.unlinkSync(fileA('b.txt'));                 // 그 사이 A가 삭제
  check('A의 삭제가 서버에 반영(툼스톤)', await waitFor(async () => (await serverChanges()).find((c) => c.relativePath === 'b.txt')?.deleted === true));
  startEngine(B);
  check('5a: 파일이 B의 내용으로 살아남음 (서버·A·B)', await waitFor(async () => {
    const c = (await serverChanges()).find((x) => x.relativePath === 'b.txt');
    return c && !c.deleted && sameContent(fileB('b.txt'), body('b 원본') + 'B의 미동기화 수정\n') && sameContent(fileA('b.txt'), body('b 원본') + 'B의 미동기화 수정\n');
  }));
  const bv = await versionsOf('b.txt');
  check('5a: 버전 번호가 이어지고 되살린 버전은 SNAPSHOT', bv.length === 2 && bv.find((x) => x.versionNumber === 2)?.versionType === 'SNAPSHOT',
    bv.map((x) => `v${x.versionNumber} ${x.versionType}`).join(', '));

  // 5b: B의 수정이 먼저 올라갔는데 그것을 모르는 A가 삭제 → 409 → 다시 내려받음
  await waitFor(converged);
  A.engine.pausePolling();
  write(fileB('b.txt'), body('b 원본') + 'B가 또 고침\n');
  check('B의 수정이 서버에 도착 (v3)', await waitFor(async () => (await versionsOf('b.txt')).length === 3));
  fs.unlinkSync(fileA('b.txt'));
  check('5b: A의 삭제는 거절되고 파일이 B의 내용으로 돌아옴', await waitFor(() => sameContent(fileA('b.txt'), body('b 원본') + 'B가 또 고침\n')));
  A.engine.resumePolling();
  check('5b: 서버에서 삭제되지 않음', (await serverChanges()).find((c) => c.relativePath === 'b.txt')?.deleted === false);
  check('세 곳 내용 일치', await waitFor(converged));

  // ───────── 6. 오프라인 변경 ─────────
  section = '6 오프라인';
  write(fileA('c.txt'), body('c 원본'));
  write(fileA('d.txt'), body('d 원본'));
  write(fileA('e.txt'), body('e 원본'));
  check('c·d·e 준비', await waitFor(async () => !!(await converged()) && exists(fileB('e.txt'))));
  await sleep(1500);
  await B.engine.idle();
  await B.engine.stop(); // B 종료
  // A 쪽 변경
  write(fileA('새 파일 A.txt'), body('A가 만든 파일'));
  write(fileA('c.txt'), body('c 원본') + 'A가 수정\n');
  fs.unlinkSync(fileA('d.txt'));
  write(fileA('e.txt'), body('e 원본') + 'A의 수정\n');
  // B 쪽 변경 (앱이 꺼진 동안)
  write(fileB('새 파일 B.txt'), body('B가 만든 파일'));
  write(fileB('오프라인/하위/f.txt'), body('B의 하위 폴더 파일'));
  write(fileB('e.txt'), body('e 원본') + 'B의 수정\n'); // 같은 파일을 양쪽이 수정 → 충돌
  fs.unlinkSync(fileB('기존 파일.txt'));
  check('A의 변경이 서버에 반영', await waitFor(async () => {
    const ch = await serverChanges();
    return ch.some((c) => c.relativePath === '새 파일 A.txt') && ch.find((c) => c.relativePath === 'd.txt')?.deleted
      && (await versionsOf('e.txt')).length === 2 && (await versionsOf('c.txt')).length === 2;
  }));
  startEngine(B); // B 시작: 전체 점검 → 변경 목록
  const final = await (async () => { let t = null; await waitFor(async () => (t = await converged()), POLL_MS * 6 + 15000); return t; })();
  check('B 시작 후 세 곳이 수렴', !!final, final ? `${Object.keys(final).length}개 파일` : '');
  if (final) {
    check('양쪽의 새 파일이 모두 있음', '새 파일 A.txt' in final && '새 파일 B.txt' in final && '오프라인/하위/f.txt' in final);
    check('A의 수정(c.txt)이 B에 반영', sameContent(fileB('c.txt'), body('c 원본') + 'A가 수정\n'));
    check('A의 삭제(d.txt)가 B에 반영(휴지통)', !exists(fileB('d.txt')) && fs.readdirSync(B.trashDir).some((n) => n.endsWith('d.txt')));
    check('B의 삭제(기존 파일.txt)가 A에 반영(휴지통)', !exists(fileA('기존 파일.txt')) && fs.readdirSync(A.trashDir).some((n) => n.endsWith('기존 파일.txt')));
    const copies = Object.keys(final).filter((k) => k.startsWith('e_PC-A_'));
    check('양쪽이 고친 e.txt: 나중에 올린 B의 내용이 원래 이름, A의 내용은 사본', sameContent(fileA('e.txt'), body('e 원본') + 'B의 수정\n')
      && copies.length === 1 && sameContent(fileA(copies[0]), body('e 원본') + 'A의 수정\n'), copies.join(', '));
    const ev = await versionsOf('e.txt');
    check('e.txt 버전 목록: v3에 conflictWith = 2', ev.find((x) => x.versionNumber === 3)?.conflictWith === 2);
  }

  // ───────── 마무리: 안정 상태 확인 ─────────
  section = '마무리';
  const total = await totalVersions();
  const up = { A: A.calls.upload, B: B.calls.upload };
  await sleep(POLL_MS * 2 + 2500);
  await Promise.all([A.engine.idle(), B.engine.idle()]);
  check('수렴 뒤에는 더 올리지 않음 (버전 수·업로드 호출 그대로)', (await totalVersions()) === total && A.calls.upload === up.A && B.calls.upload === up.B, `버전 ${total}개`);
  check('임시 파일(.xor-tmp-*)이 남지 않음', ![A.root, B.root].some((root) =>
    fs.readdirSync(root, { recursive: true }).some((n) => path.basename(String(n)).startsWith('.xor-tmp-'))));
} catch (err) {
  console.error('시험 중 예외:', err);
  results.push({ section, name: '예외 없이 끝남', ok: false });
} finally {
  await A.engine?.stop().catch(() => {});
  await B.engine?.stop().catch(() => {});
  if (folderId && process.env.XOR_KEEP !== '1') {
    const del = await http('DELETE', `/users/${userId}/sync-folders/${folderId}`, { token });
    console.log(`시험 폴더 삭제: ${del.status}`);
  }
  if (process.env.XOR_KEEP !== '1') fs.rmSync(work, { recursive: true, force: true });
  else console.log(`작업 디렉터리: ${work}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n결과: ${results.length - failed.length}/${results.length} 통과`);
for (const f of failed) console.log(`  실패: [${f.section}] ${f.name}`);
process.exit(failed.length ? 1 : 0);
