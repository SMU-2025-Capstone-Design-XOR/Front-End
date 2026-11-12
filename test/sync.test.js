// test/sync.test.js
// 동기화 엔진의 순수 로직 시험 (서버·Electron 없이 `npm test`로 돈다)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { decide } from '../sync/engine.js';
import { normalizeRel, splitRel, isIgnored, conflictCopyName, timestampForName } from '../sync/paths.js';
import { stateFilePath, loadState, saveState, removeState, emptyState, loadOrCreateDeviceId } from '../sync/state.js';
import { scanFolder, hashFile, hashBuffer } from '../sync/scanner.js';
import { SerialQueue } from '../sync/queue.js';
import { ApiError } from '../sync/api.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xor-test-'));

// ───────── reconcile 결정표 (docs/design.md §2.5의 모든 행) ─────────
const B = { baseVersion: 3, baseHash: 'h-base' };
const L_SAME = { hash: 'h-base' };
const L_EDIT = { hash: 'h-local' };
const S_NEW = { version: 4, hash: 'h-server', deleted: false };
const S_DEL = { version: 3, hash: 'h-base', deleted: true };

test('결정표 1행: L 같음, S 같음 → 없음', () => {
  assert.equal(decide({ local: L_SAME, base: B, remote: null }), 'NONE');
  assert.equal(decide({ local: L_SAME, base: B, remote: { version: 3, hash: 'h-base', deleted: false } }), 'NONE');
  assert.equal(decide({ local: null, base: null, remote: null }), 'NONE');
});

test('결정표 2행: L 다름(있음), S 같음 → 업로드', () => {
  assert.equal(decide({ local: L_EDIT, base: B, remote: null }), 'UPLOAD');
  assert.equal(decide({ local: L_EDIT, base: null, remote: null }), 'UPLOAD'); // 새 파일
});

test('결정표 3행: L 다름(없음), S 같음 → 서버에 삭제 요청', () => {
  assert.equal(decide({ local: null, base: B, remote: null }), 'DELETE_REMOTE');
});

test('결정표 4행: L 같음, S 다름(있음) → 다운로드', () => {
  assert.equal(decide({ local: L_SAME, base: B, remote: S_NEW }), 'DOWNLOAD');
  assert.equal(decide({ local: null, base: null, remote: S_NEW }), 'DOWNLOAD'); // 새 기기: 로컬에 없음
});

test('결정표 5행: L 같음, S 다름(삭제됨) → 로컬 파일을 휴지통으로', () => {
  assert.equal(decide({ local: L_SAME, base: B, remote: S_DEL }), 'TRASH_LOCAL');
});

test('결정표 6행: 둘 다 다름, 양쪽 있음, 해시 같음 → 기준만 갱신', () => {
  assert.equal(decide({ local: { hash: 'h-server' }, base: B, remote: S_NEW }), 'ADOPT');
  assert.equal(decide({ local: { hash: 'h-server' }, base: null, remote: S_NEW }), 'ADOPT'); // 새 기기: 같은 내용
});

test('결정표 7행: 둘 다 다름, 양쪽 있음, 해시 다름 → 충돌 사본 + 업로드', () => {
  assert.equal(decide({ local: L_EDIT, base: B, remote: S_NEW }), 'CONFLICT');
  assert.equal(decide({ local: L_EDIT, base: null, remote: S_NEW }), 'CONFLICT'); // 새 기기: 다른 내용
});

test('결정표 8행: 둘 다 다름, L 없음, S 있음 → 다운로드(수정이 삭제를 이김)', () => {
  assert.equal(decide({ local: null, base: B, remote: S_NEW }), 'DOWNLOAD');
});

test('결정표 9행: 둘 다 다름, L 있음, S 삭제됨 → 새 파일로 업로드(수정이 삭제를 이김)', () => {
  assert.equal(decide({ local: L_EDIT, base: B, remote: S_DEL }), 'UPLOAD_REVIVE');
  // 기준이 없으면 서버의 삭제 상태가 곧 "같음"이므로 평범한 새 파일 업로드(baseVersion 0)가 된다. 결과는 같다.
  assert.equal(decide({ local: L_EDIT, base: null, remote: S_DEL }), 'UPLOAD');
});

test('결정표 10행: 둘 다 다름, L 없음, S 삭제됨 → 기준 항목 제거', () => {
  assert.equal(decide({ local: null, base: B, remote: S_DEL }), 'DROP_BASE');
});

test('결정표: 기준이 없고 서버도 삭제 상태면 아무것도 하지 않는다', () => {
  assert.equal(decide({ local: null, base: null, remote: S_DEL }), 'NONE');
});

test('결정표: 삭제 후 되살아난 파일(버전이 올라감)은 다운로드 대상이다', () => {
  assert.equal(decide({ local: L_SAME, base: B, remote: { version: 4, hash: 'h-new', deleted: false } }), 'DOWNLOAD');
});

// ───────── 경로 정규화 ─────────
test('경로 정규화: 구분자는 /, 앞뒤 구분자 제거', () => {
  assert.equal(normalizeRel('sub\\dir\\a.txt'), 'sub/dir/a.txt');
  assert.equal(normalizeRel('/sub//a.txt/'), 'sub/a.txt');
  assert.equal(normalizeRel('./a.txt'), 'a.txt');
  assert.equal(normalizeRel(''), '');
});

test('경로 정규화: NFD(자모 분리) 한글을 NFC로', () => {
  const nfd = '보고서/초안.docx'.normalize('NFD');
  assert.notEqual(nfd, '보고서/초안.docx');
  assert.equal(normalizeRel(nfd), '보고서/초안.docx');
});

test('경로 나누기: 디렉터리 부분과 파일명', () => {
  assert.deepEqual(splitRel('a.txt'), { dir: '', name: 'a.txt' });
  assert.deepEqual(splitRel('x/y/a.txt'), { dir: 'x/y', name: 'a.txt' });
});

// ───────── 무시 규칙 ─────────
test('무시 규칙: 점 파일, ~$*, *.tmp, .xor-tmp-*, Thumbs.db, desktop.ini', () => {
  for (const p of ['.git/config', '.DS_Store', 'sub/.hidden', '~$보고서.docx', 'sub/~$a.xlsx', 'a.tmp', 'sub/~WRL0001.TMP',
    '.xor-tmp-ab12cd', 'sub/.xor-tmp-ab12cd', 'Thumbs.db', 'sub/thumbs.db', 'desktop.ini', 'Sub/Desktop.ini']) {
    assert.equal(isIgnored(p), true, p);
  }
});

test('무시 규칙: 일반 파일은 통과', () => {
  for (const p of ['a.txt', 'sub/보고서.docx', 'tmp/a.txt', 'a.tmp.txt', 'my~$file.txt', 'x/x', 'thumbs.db.bak', '']) {
    assert.equal(isIgnored(p), false, p);
  }
});

// ───────── 충돌 사본 이름 ─────────
test('충돌 사본 이름: 파일명_기기이름_서버저장시각.확장자', () => {
  assert.equal(conflictCopyName('보고서.docx', 'DESKTOP-A1B2C3', '2026-11-12T21:07:33.123456'), '보고서_DESKTOP-A1B2C3_20261112-210733.docx');
  assert.equal(conflictCopyName('sub/dir/a.txt', '보겸의 MacBook Pro', '2026-11-12T09:05:00'), 'sub/dir/a_보겸의 MacBook Pro_20261112-090500.txt');
});

test('충돌 사본 이름: 확장자 없음, 점이 여러 개, 쓸 수 없는 문자, 기기 이름 없음', () => {
  assert.equal(conflictCopyName('README', 'pc', '2026-01-02T03:04:05'), 'README_pc_20260102-030405');
  assert.equal(conflictCopyName('a.tar.gz', 'pc', '2026-01-02T03:04:05'), 'a.tar_pc_20260102-030405.gz');
  assert.equal(conflictCopyName('a.txt', 'my:pc/1?', '2026-01-02T03:04:05'), 'a_my_pc_1__20260102-030405.txt');
  assert.equal(conflictCopyName('a.txt', null, '2026-01-02T03:04:05'), 'a_다른기기_20260102-030405.txt');
});

test('충돌 사본 이름: 같은 입력이면 항상 같은 이름(재시도해도 사본이 늘지 않는다)', () => {
  const a = conflictCopyName('x/a.txt', 'pc', '2026-01-02T03:04:05.1');
  const b = conflictCopyName('x\\a.txt', 'pc', '2026-01-02T03:04:05.999');
  assert.equal(a, b);
});

test('서버 저장 시각: 글자만 옮기고 시간대 변환을 하지 않는다', () => {
  assert.equal(timestampForName('2026-11-12T23:59:59'), '20261112-235959');
  assert.equal(timestampForName('2026-11-12T23:59'), '20261112-235900');
  assert.equal(timestampForName([2026, 11, 12, 7, 8, 9, 123]), '20261112-070809');
  assert.equal(timestampForName(undefined), 'unknown');
});

// ───────── 상태 파일 ─────────
test('상태 파일: 저장 후 읽으면 같은 내용, 임시 파일이 남지 않는다', () => {
  const dir = tmpDir();
  const file = stateFilePath(path.join(dir, 'sync-state'), 12, 7);
  assert.equal(path.basename(file), '12-7.json');
  assert.equal(loadState(file), null);

  const state = emptyState('C:/Users/me/Documents/보고서');
  state.cursor = 42;
  state.files['초안/a.docx'] = { fileId: 7, baseVersion: 3, baseHash: '9f2c', size: 18234, mtimeMs: 1794300000000.123 };
  saveState(file, state);
  assert.deepEqual(loadState(file), state);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['12-7.json']);

  state.cursor = 43;
  saveState(file, state); // 덮어쓰기
  assert.equal(loadState(file).cursor, 43);

  removeState(file);
  assert.equal(loadState(file), null);
  removeState(file); // 없는 파일을 지워도 오류가 아니다
  fs.rmSync(dir, { recursive: true, force: true });
});

test('상태 파일: 깨진 파일은 보관하고 null을 돌려준다', () => {
  const dir = tmpDir();
  const file = path.join(dir, '1-1.json');
  fs.writeFileSync(file, '{ "localRoot": "x", "cur');
  assert.equal(loadState(file), null);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.readdirSync(dir).some((n) => n.startsWith('1-1.json.corrupt-')), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('기기 ID: 한 번 만들면 계속 같은 값', () => {
  const dir = tmpDir();
  const a = loadOrCreateDeviceId(dir);
  assert.match(a, /^[0-9a-f-]{36}$/);
  assert.equal(loadOrCreateDeviceId(dir), a);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ───────── 스캐너 ─────────
test('스캐너: 하위 폴더를 훑고 무시 목록을 건너뛰며 경로를 정규화한다', async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'sub', '깊은'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
  fs.writeFileSync(path.join(dir, 'sub', '깊은', '보고서.md'), '내용');
  fs.writeFileSync(path.join(dir, 'sub', '~$lock.docx'), 'x');
  fs.writeFileSync(path.join(dir, '.git', 'config'), 'x');
  fs.writeFileSync(path.join(dir, '.xor-tmp-123456'), 'x');
  fs.writeFileSync(path.join(dir, 'Thumbs.db'), 'x');

  const found = await scanFolder(dir);
  assert.deepEqual([...found.keys()].sort(), ['a.txt', 'sub/깊은/보고서.md']);
  assert.equal(found.get('a.txt').size, 5);

  assert.equal(await hashFile(path.join(dir, 'a.txt')), hashBuffer(Buffer.from('hello')));
  assert.equal(hashBuffer(Buffer.from('hello')), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ───────── 큐 ─────────
test('큐: 한 번에 하나씩, 같은 키는 한 건으로 합친다', async () => {
  const q = new SerialQueue();
  const log = [];
  let running = 0;
  let maxRunning = 0;
  const job = (name) => async () => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((r) => setTimeout(r, 5));
    log.push(name);
    running--;
  };
  q.pause();
  q.enqueue('a', job('a1'));
  q.enqueue('b', job('b'));
  q.enqueue('a', job('a2')); // a1을 대체
  q.resume();
  await q.idle();
  assert.deepEqual(log, ['a2', 'b']);
  assert.equal(maxRunning, 1);
});

test('큐: 실행 중인 키가 다시 들어오면 끝난 뒤 한 번 더 돈다', async () => {
  const q = new SerialQueue();
  let runs = 0;
  const fn = async () => {
    runs++;
    if (runs === 1) q.enqueue('k', fn);
    await new Promise((r) => setTimeout(r, 5));
  };
  q.enqueue('k', fn);
  await q.idle();
  assert.equal(runs, 2);
});

test('큐: 네트워크 오류·5xx는 간격을 늘려 다시 시도하고, 그 외 오류는 버린다', async () => {
  const dropped = [];
  const q = new SerialQueue({ baseDelayMs: 5, onError: (key, err) => dropped.push([key, err.message]) });
  let tries = 0;
  q.enqueue('net', async () => {
    tries++;
    if (tries < 3) throw new ApiError(tries === 1 ? 0 : 503, null, '일시 오류');
  });
  q.enqueue('bad', async () => { throw new ApiError(400, null, '잘못된 요청'); });
  await q.idle();
  assert.equal(tries, 3);
  assert.deepEqual(dropped, [['bad', '잘못된 요청']]);
});

test('큐: 재시도 횟수를 넘기면 버린다', async () => {
  const dropped = [];
  const q = new SerialQueue({ baseDelayMs: 1, maxAttempts: 3, onError: (key) => dropped.push(key) });
  let tries = 0;
  q.enqueue('k', async () => { tries++; throw new ApiError(500, null, '서버 오류'); });
  await q.idle();
  assert.equal(tries, 3);
  assert.deepEqual(dropped, ['k']);
});

test('큐: 인증 오류면 멈추고 알린 뒤, resume하면 같은 작업부터 이어 간다', async () => {
  let authCalls = 0;
  const q = new SerialQueue({ onAuthRequired: () => authCalls++ });
  const log = [];
  let tokenValid = false;
  q.enqueue('a', async () => {
    if (!tokenValid) throw new ApiError(403, null, '토큰 만료');
    log.push('a');
  });
  q.enqueue('b', async () => { log.push('b'); });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(authCalls, 1);
  assert.equal(q.paused, true);
  assert.deepEqual(log, []);
  tokenValid = true;
  q.resume();
  await q.idle();
  assert.deepEqual(log.sort(), ['a', 'b']);
});

test('큐: 지연 작업은 그 시각 전에는 돌지 않는다', async () => {
  const q = new SerialQueue();
  const started = Date.now();
  let ranAt = 0;
  q.enqueue('late', async () => { ranAt = Date.now(); }, { delayMs: 60 });
  await q.idle();
  assert.ok(ranAt - started >= 55, `실제 지연 ${ranAt - started}ms`);
});

test('ApiError: 재시도·인증 분류', () => {
  assert.equal(new ApiError(0).retryable, true);
  assert.equal(new ApiError(502).retryable, true);
  assert.equal(new ApiError(409).retryable, false);
  assert.equal(new ApiError(401).auth, true);
  assert.equal(new ApiError(403).auth, true); // 이 서버는 토큰이 없거나 만료되면 403을 준다
  assert.equal(new ApiError(404).auth, false);
});
