// test/engine-pause.test.js
// 동기화 중지·다시 시작, 위치 다시 지정을 가짜 서버로 확인한다 (네트워크·Electron 없음).
// 가장 중요한 것: 어떤 경우에도 "없는 파일 = 삭제"로 서버에 전파되지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SyncEngine } from '../sync/engine.js';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const USER = 1;

/** 서버의 동작 중 엔진이 쓰는 부분만 흉내 낸다 (폴더 1개 이상, 파일은 경로로 식별, 변경 일련번호). */
class FakeServer {
  constructor() {
    this.folders = [];          // { id, name, folderPath }
    this.files = new Map();     // `${folderId}:${rel}` → { fileId, rel, version, hash, content, deleted, changeSeq }
    this.seq = new Map();       // folderId → changeSeq
    this.nextId = 1;
    this.calls = { upload: [], delete: [], download: [], list: 0 };
  }
  #bump(folderId) {
    const n = (this.seq.get(folderId) || 0) + 1;
    this.seq.set(folderId, n);
    return n;
  }
  #change(f) {
    return { fileId: f.fileId, relativePath: f.rel, version: f.version, hash: f.hash, size: f.content.length, deleted: f.deleted, changeSeq: f.changeSeq };
  }
  addFolder(name) {
    const folder = { id: this.nextId++, name, folderPath: `/somewhere/${name}` };
    this.folders.push(folder);
    return folder;
  }
  /** 다른 기기가 올린 것처럼 서버의 파일을 바꾼다 */
  put(folderId, rel, text) {
    const key = `${folderId}:${rel}`;
    const content = Buffer.from(text);
    const f = this.files.get(key) || { fileId: this.nextId++, rel, version: 0 };
    Object.assign(f, { version: f.version + 1, hash: sha(content), content, deleted: false, changeSeq: this.#bump(folderId) });
    this.files.set(key, f);
    return f;
  }
  live(folderId) {
    return [...this.files.values()].filter((f) => !f.deleted && this.files.get(`${folderId}:${f.rel}`) === f).map((f) => f.rel).sort();
  }
  api() {
    const fail = (status, body = null) => Object.assign(new Error(`HTTP ${status}`), { status, body });
    return {
      listFolders: async () => { this.calls.list++; return this.folders.map((f) => ({ ...f })); },
      registerFolder: async (_u, localPath) => {
        const name = localPath.replace(/\\/g, '/').split('/').pop();
        if (this.folders.some((f) => f.name === name)) throw fail(409, { current: this.folders.find((f) => f.name === name) });
        return this.addFolder(name);
      },
      changes: async (_u, folderId, since) => ({
        cursor: this.seq.get(folderId) || 0,
        changes: [...this.files.entries()].filter(([k, f]) => k.startsWith(`${folderId}:`) && f.changeSeq > since)
          .map(([, f]) => this.#change(f)).sort((a, b) => a.changeSeq - b.changeSeq),
      }),
      upload: async (_u, folderId, { relPath, buffer, baseVersion }) => {
        this.calls.upload.push(relPath);
        const key = `${folderId}:${relPath}`;
        const f = this.files.get(key);
        const hash = sha(buffer);
        if (f && !f.deleted && f.hash === hash) return { ...this.#change(f), status: 'UNCHANGED' };
        if (f && baseVersion !== undefined && baseVersion !== null && baseVersion !== f.version && !(f.deleted && baseVersion === 0)) {
          throw fail(409, { current: this.#change(f) });
        }
        const next = this.put(folderId, relPath, buffer);
        return { ...this.#change(next), status: f ? 'UPDATED' : 'CREATED' };
      },
      deleteFile: async (_u, folderId, fileId, baseVersion) => {
        const f = [...this.files.values()].find((x) => x.fileId === fileId);
        this.calls.delete.push(f ? f.rel : `#${fileId}`);
        if (!f) throw fail(404);
        if (baseVersion !== undefined && baseVersion !== null && baseVersion !== f.version) throw fail(409, { current: this.#change(f) });
        if (!f.deleted) { f.deleted = true; f.changeSeq = this.#bump(folderId); }
        return { changeSeq: f.changeSeq };
      },
      download: async (_u, folderId, relPath, destPath) => {
        this.calls.download.push(relPath);
        const f = this.files.get(`${folderId}:${relPath}`);
        if (!f || f.deleted) throw fail(404);
        fs.writeFileSync(destPath, f.content);
        return { version: f.version, hash: f.hash, actualHash: f.hash, size: f.content.length };
      },
      versions: async (_u, folderId, fileId) => {
        const f = [...this.files.values()].find((x) => x.fileId === fileId);
        return f ? [{ versionNumber: f.version, deviceName: '다른기기', createdDate: '2026-11-15T10:00:00' }] : [];
      },
    };
  }
}

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xor-pause-'));
  const server = new FakeServer();
  const engines = [];
  const trashed = [];
  const make = () => {
    const engine = new SyncEngine({
      api: server.api(), userId: USER, username: 'me',
      stateDir: path.join(dir, 'state'), xorRoot: path.join(dir, 'XOR'),
      trash: async (abs) => { trashed.push(abs); fs.rmSync(abs, { force: true }); },
      watch: false, pollIntervalMs: 3600000, deleteDelayMs: 5, retryBaseMs: 5, recoverDelayMs: 20,
    });
    engines.push(engine);
    return engine;
  };
  t.after(async () => {
    for (const e of engines) await e.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, server, make, trashed };
}

const write = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const settle = async (engine) => { engine.pollNow(); await engine.idle(); await new Promise((r) => setTimeout(r, 30)); await engine.idle(); };

test('폴더별 중지: 멈춘 동안 올리지도 받지도 않고, 껐다 켜도 유지되며, 다시 시작하면 양쪽이 맞춰진다', async (t) => {
  const { dir, server, make } = setup(t);
  const root = path.join(dir, '문서');
  write(root, 'a.txt', 'a1');
  let engine = make();
  engine.start();
  assert.equal((await engine.registerFolder(root)).ok, true);
  await settle(engine);
  const folderId = server.folders[0].id;
  assert.deepEqual(server.live(folderId), ['a.txt']);

  assert.equal(await engine.pauseFolder(folderId), true);
  const uploadsBefore = server.calls.upload.length;
  write(root, 'a.txt', 'a2 이 PC에서 고침');     // 이 PC의 수정
  write(root, 'b.txt', 'b1 이 PC에서 추가');     // 이 PC의 새 파일
  server.put(folderId, 'c.txt', 'c1 다른 기기');  // 다른 기기의 새 파일
  await settle(engine);
  assert.equal(server.calls.upload.length, uploadsBefore, '멈춘 동안 올리지 않는다');
  assert.equal(fs.existsSync(path.join(root, 'c.txt')), false, '멈춘 동안 받지 않는다');
  assert.equal(engine.folderList()[0].paused, true);

  // 앱을 껐다 켠다
  await engine.stop();
  engine = make();
  engine.start();
  await settle(engine);
  assert.equal(engine.folderList()[0].paused, true, '껐다 켜도 멈춘 상태');
  assert.equal(server.calls.upload.length, uploadsBefore);
  assert.equal(fs.existsSync(path.join(root, 'c.txt')), false);

  assert.equal(engine.resumeFolder(folderId), true);
  await settle(engine);
  assert.deepEqual(server.live(folderId), ['a.txt', 'b.txt', 'c.txt']);
  assert.equal(server.files.get(`${folderId}:a.txt`).content.toString(), 'a2 이 PC에서 고침');
  assert.equal(read(root, 'c.txt'), 'c1 다른 기기');
  assert.deepEqual(server.calls.delete, [], '삭제 요청은 한 번도 없다');
});

test('전체 중지: 껐다 켜도 유지되고, 멈춘 중 등록한 폴더는 다시 시작할 때 올라가며, 따로 멈춘 폴더는 풀리지 않는다', async (t) => {
  const { dir, server, make } = setup(t);
  const one = path.join(dir, '하나');
  const two = path.join(dir, '둘');
  write(one, 'x.txt', 'x1');
  let engine = make();
  engine.start();
  await engine.registerFolder(one);
  await settle(engine);
  const oneId = server.folders[0].id;

  await engine.pauseFolder(oneId);                 // 폴더 하나는 따로 멈춰 둔다
  assert.equal(await engine.pauseAll(), true);
  assert.equal(engine.getStatus().pausedAll, true);

  // 전체 중지 중 새 폴더 등록: 서버에 이름은 등록되지만 파일은 올라가지 않는다
  write(two, 'y.txt', 'y1');
  assert.equal((await engine.registerFolder(two)).ok, true);
  const twoId = server.folders[1].id;
  const listCalls = server.calls.list;
  await settle(engine);
  assert.deepEqual(server.live(twoId), []);
  assert.equal(server.calls.list, listCalls, '멈춘 동안 주기적 확인도 하지 않는다');

  await engine.stop();
  engine = make();
  assert.equal(engine.getStatus().pausedAll, true, '껐다 켜도 전체 중지');
  engine.start();
  await engine.idle();
  assert.deepEqual(server.live(twoId), []);

  write(one, 'x.txt', 'x2');
  assert.equal(engine.resumeAll(), true);
  await settle(engine);
  assert.deepEqual(server.live(twoId), ['y.txt'], '다시 시작하면 새 폴더의 파일이 올라간다');
  assert.equal(server.files.get(`${oneId}:x.txt`).content.toString(), 'x1', '따로 멈춘 폴더는 전체를 다시 시작해도 그대로');
  assert.equal(engine.folderList().find((f) => f.id === oneId).paused, true);

  engine.resumeFolder(oneId);
  await settle(engine);
  assert.equal(server.files.get(`${oneId}:x.txt`).content.toString(), 'x2');
});

test('멈춘 동안 폴더가 통째로 없어지면 다시 시작할 때 멈춤(blocked)이 되고 삭제를 전파하지 않는다', async (t) => {
  const { dir, server, make } = setup(t);
  const root = path.join(dir, '자료');
  write(root, 'a.txt', 'a1');
  write(root, 'sub/b.txt', 'b1');
  const engine = make();
  engine.start();
  await engine.registerFolder(root);
  await settle(engine);
  const folderId = server.folders[0].id;

  await engine.pauseFolder(folderId);
  fs.rmSync(root, { recursive: true, force: true });
  engine.resumeFolder(folderId);
  await settle(engine);

  assert.equal(engine.folderList()[0].blocked, true);
  assert.equal(engine.getStatus().blocked, 1, '화면에 알릴 멈춘 폴더 수');
  assert.deepEqual(server.calls.delete, []);
  assert.deepEqual(server.live(folderId), ['a.txt', 'sub/b.txt']);

  // 폴더를 내용이 든 채로 되돌려 놓고 다시 시작하면 이어진다
  write(root, 'a.txt', 'a1');
  write(root, 'sub/b.txt', 'b1');
  await engine.pauseFolder(folderId);
  engine.resumeFolder(folderId);
  await settle(engine);
  assert.equal(engine.folderList()[0].blocked, false);
  assert.equal(engine.getStatus().blocked, 0);
  assert.deepEqual(server.calls.delete, []);
});

test('위치 다시 지정: 새 위치에 없는 파일은 내려받고, 같은 파일은 그대로 두고, 새 파일은 올린다. 삭제는 없다', async (t) => {
  const { dir, server, make } = setup(t);
  const oldRoot = path.join(dir, '보고서');
  write(oldRoot, 'same.txt', '같은 내용');
  write(oldRoot, 'missing.txt', '새 위치에는 없는 파일');
  write(oldRoot, 'changed.txt', '서버 내용');
  let engine = make();
  engine.start();
  await engine.registerFolder(oldRoot);
  await settle(engine);
  const folderId = server.folders[0].id;
  await engine.stop();

  // 앱이 꺼진 동안 폴더를 다른 이름·위치로 옮겼고, 내용도 조금 달라졌다
  const newRoot = path.join(dir, '옮긴 곳', '보고서-2026');
  write(newRoot, 'same.txt', '같은 내용');
  write(newRoot, 'changed.txt', '옮긴 뒤 이 PC에서 고친 내용');
  write(newRoot, 'new.txt', '옮긴 뒤 새로 만든 파일');
  fs.rmSync(oldRoot, { recursive: true, force: true });

  engine = make();
  engine.start();
  await settle(engine);
  assert.equal(engine.folderList()[0].blocked, true);
  assert.equal(engine.relocateFolder(folderId, path.join(dir, '없는 곳')).ok, false);

  const uploadsBefore = server.calls.upload.filter((p) => p === 'same.txt').length;
  const result = engine.relocateFolder(folderId, newRoot);
  assert.equal(result.ok, true);
  await settle(engine);

  assert.equal(engine.folderList()[0].blocked, false);
  assert.equal(engine.folderList()[0].localRoot, path.resolve(newRoot));
  assert.deepEqual(server.calls.delete, [], '삭제 요청은 한 번도 없다');
  assert.equal(read(newRoot, 'missing.txt'), '새 위치에는 없는 파일', '없는 파일은 내려받는다');
  assert.equal(server.files.get(`${folderId}:same.txt`).version, 1, '같은 내용은 새 버전을 만들지 않는다');
  assert.ok(server.live(folderId).includes('new.txt'), '새 파일은 올린다');
  // 내용이 다른 파일은 충돌 처리: 이 PC의 내용이 원래 이름으로 올라가고 서버본은 사본으로 남는다
  assert.equal(server.files.get(`${folderId}:changed.txt`).content.toString(), '옮긴 뒤 이 PC에서 고친 내용');
  const copies = fs.readdirSync(newRoot).filter((n) => n.startsWith('changed_'));
  assert.equal(copies.length, 1);
  assert.equal(read(newRoot, copies[0]), '서버 내용');
  assert.ok(uploadsBefore >= 1);

  // 껐다 켜도 새 위치를 기억한다 (폴더 이름과 디렉터리 이름이 달라도 상태를 버리지 않는다)
  await engine.stop();
  engine = make();
  engine.start();
  await settle(engine);
  assert.equal(engine.folderList()[0].blocked, false);
  assert.equal(engine.folderList()[0].localRoot, path.resolve(newRoot));
  assert.deepEqual(server.calls.delete, []);
});

test('실행 중에 폴더가 통째로 없어지면 멈추고 삭제를 전파하지 않는다. 내용이 든 채로 돌아오면 스스로 이어 간다', async (t) => {
  const { dir, server, make } = setup(t);
  const root = path.join(dir, '과제');
  write(root, 'a.txt', 'a1');
  write(root, 'sub/b.txt', 'b1');
  const engine = make();
  engine.start();
  await engine.registerFolder(root);
  await settle(engine);
  const folderId = server.folders[0].id;

  // 앱이 켜진 채로 폴더를 통째로 지웠다. 그 뒤 다른 기기의 변경이 들어온다.
  fs.rmSync(root, { recursive: true, force: true });
  server.put(folderId, 'c.txt', 'c1 다른 기기');
  await settle(engine);
  assert.equal(engine.folderList()[0].blocked, true);
  assert.equal(engine.getStatus().blocked, 1);
  assert.deepEqual(server.calls.delete, [], '폴더가 없어진 것을 파일 삭제로 전파하지 않는다');
  assert.deepEqual(server.live(folderId), ['a.txt', 'c.txt', 'sub/b.txt']);
  assert.equal(fs.existsSync(root), false, '멈춘 동안 폴더를 다시 만들거나 내려받지 않는다');

  // 같은 자리에 빈 폴더만 만들면 이어 가지 않는다 (이어 가면 전부 삭제로 전파된다)
  fs.mkdirSync(root, { recursive: true });
  await settle(engine);
  await new Promise((r) => setTimeout(r, 40));
  await settle(engine);
  assert.equal(engine.folderList()[0].blocked, true);
  assert.deepEqual(server.calls.delete, []);

  // 휴지통에서 복원한 것처럼 내용이 든 채로 돌아오면, 잠시 뒤의 확인에서 스스로 이어 간다
  write(root, 'a.txt', 'a1');
  write(root, 'sub/b.txt', 'b1');
  await settle(engine);
  assert.equal(engine.folderList()[0].blocked, true, '돌아온 것을 처음 본 확인에서는 아직 기다린다');
  await new Promise((r) => setTimeout(r, 40));
  await settle(engine);
  assert.equal(engine.folderList()[0].blocked, false);
  assert.equal(engine.getStatus().blocked, 0);
  assert.deepEqual(server.calls.delete, []);
  assert.equal(read(root, 'c.txt'), 'c1 다른 기기', '멈춘 동안의 다른 기기 변경을 받는다');
  assert.deepEqual(server.live(folderId), ['a.txt', 'c.txt', 'sub/b.txt']);
});

test('앱이 꺼진 동안 폴더가 비워졌으면(같은 자리에 빈 폴더만 다시 만든 경우 포함) 멈추고 삭제를 전파하지 않는다', async (t) => {
  const { dir, server, make } = setup(t);
  const root = path.join(dir, '실습');
  write(root, 'a.txt', 'a1');
  write(root, 'sub/b.txt', 'b1');
  let engine = make();
  engine.start();
  await engine.registerFolder(root);
  await settle(engine);
  const folderId = server.folders[0].id;
  await engine.stop();

  // 앱이 꺼진 동안 폴더를 지우고 같은 자리에 빈 폴더만 다시 만들었다 (무시되는 파일만 있어도 빈 것으로 본다)
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'desktop.ini'), '');

  engine = make();
  engine.start();
  await settle(engine);
  assert.equal(engine.folderList()[0].blocked, true);
  assert.equal(engine.folderList()[0].blockedReason, 'empty');
  assert.deepEqual(server.calls.delete, [], '빈 폴더를 "전부 지움"으로 전파하지 않는다');
  assert.deepEqual(server.live(folderId), ['a.txt', 'sub/b.txt']);

  // 동기화 중지를 걸었다 풀어도 마찬가지로 멈춰 있다
  await engine.pauseFolder(folderId);
  engine.resumeFolder(folderId);
  await settle(engine);
  assert.equal(engine.folderList()[0].blocked, true);
  assert.deepEqual(server.calls.delete, []);

  // 같은 폴더로 위치를 다시 지정하면 서버의 파일을 전부 내려받는다
  assert.equal(engine.relocateFolder(folderId, root).ok, true);
  await settle(engine);
  assert.equal(engine.folderList()[0].blocked, false);
  assert.equal(engine.folderList()[0].blockedReason, null);
  assert.equal(read(root, 'a.txt'), 'a1');
  assert.equal(read(root, 'sub/b.txt'), 'b1');
  assert.deepEqual(server.calls.delete, []);

  // 그 뒤 앱이 켜진 상태에서 파일을 지우는 것은 평소대로 전파된다
  fs.rmSync(path.join(root, 'a.txt'));
  engine.pauseFolder(folderId).then(() => engine.resumeFolder(folderId)); // 감시 없이 도는 테스트라 전체 점검을 다시 시킨다
  await new Promise((r) => setTimeout(r, 30));
  await settle(engine);
  assert.deepEqual(server.calls.delete, ['a.txt']);
});

test('getStatus: 기다리는 파일 수와 경로를 폴더별로 센다', async (t) => {
  const { make } = setup(t);
  const engine = make();
  engine.queue.pause();
  engine.queue.enqueue('file:3:a/b.txt', async () => {});
  engine.queue.enqueue('file:3:c.txt', async () => {});
  engine.queue.enqueue('file:12:d.txt', async () => {});
  engine.queue.enqueue('poll:3', async () => {});
  const status = engine.getStatus();
  assert.equal(status.pending, 3);
  assert.deepEqual(status.folders.find((f) => f.id === 3), { id: 3, pending: 2, paths: ['a/b.txt', 'c.txt'] });
  assert.equal(status.pausedAll, false);
  engine.queue.clear();
  engine.queue.resume();
});
