// scripts/exp-sync.mjs
// 동기화 실험 (docs/design.md 5.5): 한 PC에서 엔진 2개(기기 A, B)를 Electron 없이 돌려
//   (1) 폴링 주기별 전파 지연 — A가 파일을 쓴 시각부터 B의 디스크에 같은 내용이 생긴 시각까지
//   (2) 동시 수정 n회 — 두 기기가 같은 파일을 거의 동시에 다르게 고쳤을 때 유실 0건·충돌 사본 n건인지
//   (3) 요청 부하 — 변화가 없을 때 폴링 1회(changes?since=커서)의 응답 크기와 전체 목록(GET /files)의 크기
// 를 잰다. 구성은 test/e2e/sync.mjs와 같다(기기별 상태 디렉터리·로컬 폴더·기기 ID, 휴지통은 trash 디렉터리).
// 일회용 계정과 폴더를 만들고 끝나면 폴더를 지운다.
//
// 실행: BE를 local 프로필로 띄운 뒤 (Front-end/ 에서)
//   node scripts/exp-sync.mjs --out ../docs/experiments/raw [--polls 5000,15000,30000] [--n 10] [--conflicts 10]
//   XOR_API_BASE (기본 http://localhost:8080)
//
// 결과 (--out 폴더): sync-propagation.csv(시행별), sync-conflict.csv(시행별), sync-summary.csv(집계)
//
// 전파 지연의 구성: A의 감시 안정 대기(awaitWriteFinish 1초) + 업로드 + B의 다음 폴링까지 기다림(0~폴링 주기) + 내려받기.
// 쓰는 시점이 B의 폴링 위상에 대해 고르게 퍼지도록 시행 사이에 0~폴링 주기의 임의 대기를 넣는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { createApi } from '../sync/api.js';
import { SyncEngine } from '../sync/engine.js';
import { loadOrCreateDeviceId } from '../sync/state.js';
import { scanFolder, hashFile, hashBuffer } from '../sync/scanner.js';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const BASE = process.env.XOR_API_BASE || 'http://localhost:8080';
const OUT = opt('out');
const POLLS = opt('polls', '5000,15000,30000').split(',').map(Number);
const N = Number(opt('n', 10));
const CONFLICTS = Number(opt('conflicts', 10));
const CONFLICT_POLL_MS = 5000;
if (!OUT) {
  console.error('사용법: node scripts/exp-sync.mjs --out <폴더> [--polls 5000,15000,30000] [--n 10] [--conflicts 10]');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, timeoutMs, stepMs = 20) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try { if (await cond()) return true; } catch { /* 아직 아님 */ }
    if (Date.now() > end) return false;
    await sleep(stepMs);
  }
}
const writeCsv = (file, header, rows) => fs.writeFileSync(path.join(OUT, file),
  '﻿' + [header, ...rows].map((r) => r.join(',')).join('\n') + '\n');
const stats = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return { mean: s.reduce((a, b) => a + b, 0) / s.length, min: s[0], max: s[s.length - 1], median: s[Math.floor((s.length - 1) / 2)] };
};

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

const username = `exps_${randomBytes(4).toString('hex')}`;
const password = randomBytes(12).toString('hex'); // 로컬 시험 계정용 임의 값
await http('POST', '/auth/signup', { json: { username, password, email: `${username}@example.test` } });
const login = await http('POST', '/auth/login', { json: { username, password } });
const token = login.body?.token;
if (!token) { console.error(`로그인 실패 (${login.status}). BE가 ${BASE}에 떠 있는지 확인하세요.`); process.exit(2); }
const userId = Number(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'xor-exp-sync-'));

// 한 번의 실험 구성: 기기 2대와 새 동기화 폴더
async function setup(label, pollMs) {
  const folderName = `exp-${label}-${randomBytes(2).toString('hex')}`;
  const makeDevice = (name, deviceName) => {
    const home = path.join(work, label, name);
    const dev = {
      name, deviceName,
      stateDir: path.join(home, 'userData', 'sync-state'),
      xorRoot: path.join(home, 'XOR'),
      trashDir: path.join(home, 'trash'),
      uploadDone: new Map(), // 파일 이름 → 업로드 응답을 받은 시각
      conflicts: 0,
    };
    fs.mkdirSync(dev.trashDir, { recursive: true });
    dev.deviceId = loadOrCreateDeviceId(path.join(home, 'userData'));
    const api = createApi({ baseUrl: BASE, getToken: () => token, deviceId: dev.deviceId, deviceName });
    const upload = api.upload;
    api.upload = async (...a) => {
      const result = await upload(...a);
      const rel = result?.relativePath;
      if (rel) dev.uploadDone.set(rel, Date.now());
      return result;
    };
    dev.engine = new SyncEngine({
      api, userId, username,
      stateDir: dev.stateDir, xorRoot: dev.xorRoot, pollIntervalMs: pollMs,
      trash: async (abs) => fs.renameSync(abs, path.join(dev.trashDir, `${Date.now()}-${path.basename(abs)}`)),
      emit: (channel, payload) => { if (channel === 'sync:status' && payload.state === 'conflict') dev.conflicts++; },
      log: () => {},
    });
    return dev;
  };
  const A = makeDevice('A', 'PC-A');
  const B = makeDevice('B', 'PC-B');
  A.root = path.join(work, label, 'A', 'Documents', folderName);
  fs.mkdirSync(A.root, { recursive: true });
  fs.writeFileSync(path.join(A.root, 'seed.txt'), 'seed\n');
  A.engine.start();
  const reg = await A.engine.registerFolder(A.root);
  if (!reg.ok) throw new Error(`폴더 등록 실패: ${JSON.stringify(reg)}`);
  const folderId = reg.folder.id;
  B.engine.start();
  B.root = path.join(B.xorRoot, username, folderName);
  if (!await waitFor(() => fs.existsSync(path.join(B.root, 'seed.txt')), pollMs * 3 + 20000, 100)) throw new Error('B가 폴더에 연결되지 않음');
  const folderUrl = `/users/${userId}/sync-folders/${folderId}`;
  const teardown = async () => {
    await A.engine.stop().catch(() => {});
    await B.engine.stop().catch(() => {});
    const del = await http('DELETE', folderUrl, { token });
    console.log(`  폴더 ${folderId} 삭제: ${del.status}`);
  };
  return { A, B, folderId, folderUrl, teardown };
}

async function tree(root) {
  const out = {};
  for (const rel of [...(await scanFolder(root)).keys()].sort()) out[rel] = await hashFile(path.join(root, rel));
  return out;
}

const propagation = [];
const conflictRows = [];
const summary = [];
try {
  // ───────── 1. 전파 지연 ─────────
  for (const pollMs of POLLS) {
    console.log(`전파 지연: 폴링 ${pollMs}ms, ${N}회`);
    const env = await setup(`p${pollMs}`, pollMs);
    try {
      for (let i = 1; i <= N; i++) {
        await sleep(Math.random() * pollMs); // B의 폴링 위상에 대해 고르게
        // 홀수 시행은 새 파일, 짝수 시행은 직전 파일 수정
        const name = `f${Math.ceil(i / 2)}.txt`;
        const kind = i % 2 === 1 ? 'create' : 'modify';
        const content = `${randomBytes(16).toString('hex')}\n`.repeat(200); // 약 6.6KB
        const hash = hashBuffer(Buffer.from(content));
        const target = path.join(env.B.root, name);
        env.A.uploadDone.delete(name);
        const t0 = Date.now();
        fs.writeFileSync(path.join(env.A.root, name), content);
        const ok = await waitFor(() => fs.existsSync(target) && hashBuffer(fs.readFileSync(target)) === hash, pollMs * 3 + 30000);
        const total = Date.now() - t0;
        const uploadMs = env.A.uploadDone.has(name) ? env.A.uploadDone.get(name) - t0 : '';
        if (!ok) console.log(`  시행 ${i}: 제한 시간 안에 전파되지 않음`);
        propagation.push([pollMs, i, kind, ok ? total : '', uploadMs, ok ? 1 : 0]);
        console.log(`  ${i}/${N} ${kind}: ${ok ? `${total}ms (업로드 완료까지 ${uploadMs}ms)` : '실패'}`);
      }
      const ok = propagation.filter((r) => r[0] === pollMs && r[5] === 1);
      if (ok.length) {
        const t = stats(ok.map((r) => r[3]));
        const u = stats(ok.filter((r) => r[4] !== '').map((r) => r[4]));
        summary.push(['propagation', pollMs, N, ok.length, t.mean.toFixed(0), t.median, t.min, t.max, u.mean.toFixed(0), '']);
      } else summary.push(['propagation', pollMs, N, 0, '', '', '', '', '', '']);
    } finally {
      await env.teardown();
    }
    writeCsv('sync-propagation.csv', ['poll_ms', 'trial', 'kind', 'total_ms', 'upload_done_ms', 'ok'], propagation);
  }

  // ───────── 2. 동시 수정 ─────────
  console.log(`동시 수정: 폴링 ${CONFLICT_POLL_MS}ms, ${CONFLICTS}회`);
  const env = await setup('conflict', CONFLICT_POLL_MS);
  try {
    const { A, B } = env;
    const serverHashes = async () => Object.fromEntries((await http('GET', `${env.folderUrl}/files`, { token })).body
      .map((f) => [f.relativePath, f.hash]).sort((x, y) => (x[0] < y[0] ? -1 : 1)));
    const converged = async () => {
      await Promise.all([A.engine.idle(), B.engine.idle()]);
      const [ta, tb, ts] = await Promise.all([tree(A.root), tree(B.root), serverHashes()]);
      return JSON.stringify(ta) === JSON.stringify(tb) && JSON.stringify(ta) === JSON.stringify(ts) ? ta : null;
    };
    for (let i = 1; i <= CONFLICTS; i++) {
      const name = `c${i}.txt`;
      const base = `시행 ${i} 원본\n`.repeat(50);
      fs.writeFileSync(path.join(A.root, name), base);
      const baseHash = hashBuffer(Buffer.from(base));
      if (!await waitFor(() => fs.existsSync(path.join(B.root, name)) && hashBuffer(fs.readFileSync(path.join(B.root, name))) === baseHash, 40000, 100)) {
        throw new Error(`${name} 준비 실패`);
      }
      await sleep(1500); // 내려받은 뒤의 감시 이벤트가 지나가게 둔다
      await Promise.all([A.engine.idle(), B.engine.idle()]);

      const contentA = base + `A가 고친 줄 ${randomBytes(4).toString('hex')}\n`;
      const contentB = base + `B가 고친 줄 ${randomBytes(4).toString('hex')}\n`;
      const hashA = hashBuffer(Buffer.from(contentA)), hashB = hashBuffer(Buffer.from(contentB));
      const conflictsBefore = A.conflicts + B.conflicts;
      const t0 = Date.now();
      fs.writeFileSync(path.join(A.root, name), contentA); // 두 기기가 거의 동시에(수 ms 차이) 다르게 고친다
      fs.writeFileSync(path.join(B.root, name), contentB);
      let final = null;
      // 수렴: 세 곳(A·B·서버)의 파일 목록과 해시가 같고, 두 수정이 모두 들어 있을 때
      const done = await waitFor(async () => {
        final = await converged();
        if (!final) return false;
        const hashes = Object.entries(final).filter(([rel]) => rel === name || rel.startsWith(`c${i}_`)).map(([, h]) => h);
        return hashes.includes(hashA) && hashes.includes(hashB);
      }, 90000, 250);
      const ms = Date.now() - t0;
      final = final || (await tree(A.root));
      const related = Object.entries(final).filter(([rel]) => rel === name || rel.startsWith(`c${i}_`));
      const hashes = related.map(([, h]) => h);
      const lost = (hashes.includes(hashA) ? 0 : 1) + (hashes.includes(hashB) ? 0 : 1);
      const copies = related.filter(([rel]) => rel !== name).length;
      const winner = final[name] === hashA ? 'A' : final[name] === hashB ? 'B' : '?';
      const events = A.conflicts + B.conflicts - conflictsBefore;
      conflictRows.push([i, done ? 1 : 0, lost, copies, winner, events, ms]);
      console.log(`  ${i}/${CONFLICTS}: 수렴 ${done ? 'O' : 'X'}, 유실 ${lost}, 사본 ${copies}, 원래 이름은 ${winner}의 내용, ${ms}ms`);
      writeCsv('sync-conflict.csv', ['trial', 'converged', 'lost_edits', 'conflict_copies', 'original_name_holds', 'conflict_events', 'converge_ms'], conflictRows);
    }
    summary.push(['conflict', CONFLICT_POLL_MS, CONFLICTS, conflictRows.filter((r) => r[1] === 1).length, '', '', '', '', '',
      `유실 ${conflictRows.reduce((a, r) => a + r[2], 0)}건 / 충돌 사본 ${conflictRows.reduce((a, r) => a + r[3], 0)}건`]);

    // ───────── 3. 요청 부하 ─────────
    const changesAll = await http('GET', `${env.folderUrl}/changes?since=0`, { token });
    const cursor = changesAll.body.cursor;
    const idlePoll = await http('GET', `${env.folderUrl}/changes?since=${cursor}`, { token });
    const fullList = await http('GET', `${env.folderUrl}/files`, { token });
    summary.push(['request-load', '', '', '', '', '', '', '', '',
      `파일 ${fullList.body.length}개(삭제 포함 ${changesAll.body.changes.length}개)일 때: 변화 없는 폴링 응답 ${Buffer.byteLength(idlePoll.text)}바이트 / 전체 목록(GET files) ${Buffer.byteLength(fullList.text)}바이트 / changes?since=0 ${Buffer.byteLength(changesAll.text)}바이트`]);
  } finally {
    await env.teardown();
  }
} finally {
  writeCsv('sync-summary.csv',
    ['kind', 'poll_ms', 'trials', 'ok', 'total_ms_mean', 'total_ms_median', 'total_ms_min', 'total_ms_max', 'upload_done_ms_mean', 'note'], summary);
  fs.rmSync(work, { recursive: true, force: true });
}
console.log('완료:', OUT);
process.exit(0);
