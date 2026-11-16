// sync/engine.js
// 동기화 엔진: reconcile(path), 폴링, 시작 시 전체 점검 (docs/design.md §2.5)
//
// 상태 기반으로 동작한다. 감시 이벤트·폴링 결과는 "이 경로를 다시 보라"는 신호일 뿐이고,
// 무엇을 할지는 디스크(L)·기준(B)·서버(S) 세 상태를 비교해 정한다. 같은 처리를 여러 번 돌려도 결과가 같다.
// Electron에 의존하지 않는다(휴지통·화면 알림은 주입받는다). 그래서 스크립트에서도 그대로 돌릴 수 있다.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { normalizeRel, isIgnored, conflictCopyName } from './paths.js';
import { stateFilePath, loadState, saveState, removeState, emptyState, settingsFilePath, loadSettings, saveSettings } from './state.js';
import { scanFolder, statFile, hashFile, hashBuffer } from './scanner.js';
import { startWatcher } from './watcher.js';
import { SerialQueue } from './queue.js';

/** 로컬 파일이 잠겨 있거나 처리 도중 바뀌었을 때: 잠시 뒤 다시 시도한다. */
class RetryLater extends Error {
  constructor(message) {
    super(message);
    this.retryable = true;
  }
}

const BUSY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE']);
function asRetry(err, what) {
  if (err && BUSY_CODES.has(err.code)) return new RetryLater(`${what}: 파일이 사용 중입니다 (${err.code})`);
  return err;
}

/**
 * reconcile 결정표 (docs/design.md §2.5). 순수 함수.
 *
 * @param {object} s
 *   local   디스크의 현재 상태. 없으면 null, 있으면 { hash }
 *   base    상태 파일의 기준. 없으면 null, 있으면 { baseVersion, baseHash }
 *   remote  변경 목록으로 알게 된 서버 상태. 새 소식이 없으면 null(= 기준과 같다고 본다),
 *           있으면 { version, hash, deleted }
 * @returns {'NONE'|'UPLOAD'|'DELETE_REMOTE'|'DOWNLOAD'|'TRASH_LOCAL'|'ADOPT'|'CONFLICT'|'UPLOAD_REVIVE'|'DROP_BASE'}
 */
export function decide({ local, base, remote }) {
  // L vs B: 기준이 있으면 해시 비교, 기준이 없으면 "디스크에도 없음"이 같은 상태다
  const localSame = base ? !!local && local.hash === base.baseHash : !local;
  // S vs B: 기준이 있으면 "삭제되지 않았고 버전이 같음", 기준이 없으면 "서버에도 없음(삭제됨)"이 같은 상태다
  const remoteSame = !remote || (base ? !remote.deleted && remote.version === base.baseVersion : !!remote.deleted);

  if (localSame && remoteSame) return 'NONE';
  if (!localSame && remoteSame) return local ? 'UPLOAD' : 'DELETE_REMOTE';
  if (localSame && !remoteSame) return remote.deleted ? 'TRASH_LOCAL' : 'DOWNLOAD';
  // 양쪽 다 바뀜
  if (local && !remote.deleted) return local.hash === remote.hash ? 'ADOPT' : 'CONFLICT';
  if (!local && !remote.deleted) return 'DOWNLOAD';       // 수정이 삭제를 이김 (서버 쪽 수정)
  if (local && remote.deleted) return 'UPLOAD_REVIVE';    // 수정이 삭제를 이김 (로컬 쪽 수정)
  return 'DROP_BASE';
}

export class SyncEngine {
  /**
   * @param {object} opts
   *   api             createApi()의 결과
   *   userId, username
   *   stateDir        상태 파일 디렉터리 (Electron에서는 userData/sync-state)
   *   xorRoot         다른 기기가 등록한 폴더를 둘 기본 위치의 뿌리 (~/XOR)
   *   trash(absPath)  로컬 파일을 휴지통으로 보내는 함수 (Electron: shell.trashItem). 완전 삭제하지 않는다.
   *   emit(channel, payload)  화면 알림
   *   pollIntervalMs  폴링 주기 (기본 15초)
   *   deleteDelayMs   파일이 없어진 것을 삭제로 인정하기까지 기다리는 시간 (기본 2초)
   *   recoverDelayMs  없어졌던 폴더가 돌아온 것을 본 뒤 다시 이어 가기까지 기다리는 시간 (기본 5초)
   *   watch           false면 감시하지 않는다(시험용)
   *   log(message)
   */
  constructor(opts) {
    this.api = opts.api;
    this.userId = opts.userId;
    this.username = opts.username;
    this.stateDir = opts.stateDir;
    this.xorRoot = opts.xorRoot;
    this.trash = opts.trash;
    this.emit = opts.emit || (() => {});
    this.pollIntervalMs = opts.pollIntervalMs ?? 15000;
    this.deleteDelayMs = opts.deleteDelayMs ?? 2000;
    // 없어졌던 폴더가 돌아온 뒤 다시 이어 가기까지 기다리는 시간 (휴지통에서 복원하는 중일 수 있다)
    this.recoverDelayMs = opts.recoverDelayMs ?? 5000;
    this.watch = opts.watch !== false;
    this.log = opts.log || (() => {});

    this.folders = new Map();      // folderId → ctx
    this.pendingRoots = new Map(); // 등록 중인 폴더 이름 → 이 기기에서 고른 경로
    this.pollingPaused = false;
    this.pollTimer = null;
    this.stopped = false;
    this.status = { state: 'idle' };
    this.lastPollAt = null; // 서버의 폴더 목록을 마지막으로 받아 온 시각 (화면의 "마지막 확인")
    // 사용자가 건 전체 동기화 중지. 앱을 껐다 켜도 유지한다 (폴더별 중지는 폴더 상태 파일의 paused)
    this.settingsFile = settingsFilePath(this.stateDir, this.userId);
    this.pausedAll = loadSettings(this.settingsFile).pausedAll;

    this.queue = new SerialQueue({
      baseDelayMs: opts.retryBaseMs ?? 1000,
      onActive: (active) => {
        if (this.status.state === 'auth-required') return;
        this.#setStatus({ state: active ? 'syncing' : 'idle' });
      },
      onAuthRequired: (err) => {
        this.log(`인증 오류로 동기화를 멈춥니다: ${err.message}`);
        this.#setStatus({ state: 'auth-required', message: '다시 로그인해 주세요.' });
      },
      onRetry: (key, err) => {
        // 네트워크·5xx 등으로 미룬 작업이 있다. 화면에 "다시 시도 중"으로 알린다 (판단 로직과는 무관)
        if (this.status.state === 'auth-required') return;
        this.#setStatus({ state: 'error', retrying: true, message: err.message, key });
      },
      onError: (key, err) => {
        this.log(`작업 실패(${key}): ${err.message}`);
        this.#setStatus({ state: 'error', message: err.message, key });
      },
    });
  }

  // ───────── 시작·정지 ─────────

  /** 서버의 폴더 목록을 받아 폴더마다 전체 점검 → 변경 목록 순으로 시작하고, 폴링을 건다. */
  start() {
    this.stopped = false;
    this.#enqueueFolderRefresh();
    this.pollTimer = setInterval(() => this.#tick(), this.pollIntervalMs);
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.queue.clear();
    const closing = [...this.folders.values()].map((ctx) => ctx.watcher?.close());
    await Promise.all(closing);
    await this.queue.idle(); // 실행 중이던 작업 하나는 끝까지 기다린다
    this.folders.clear();
  }

  /** 큐가 빌 때까지 기다린다 (시험·스크립트용). */
  idle() {
    return this.queue.idle();
  }

  /** 폴링을 멈춘다. 감시와 업로드는 계속된다 (충돌 시험·실험용). */
  pausePolling() {
    this.pollingPaused = true;
  }

  resumePolling() {
    this.pollingPaused = false;
    this.pollNow();
  }

  /** 지금 한 번 폴더 목록과 변경 목록을 확인한다. 전체 중지 중에는 하지 않는다. */
  pollNow() {
    if (this.stopped || this.pausedAll) return;
    this.#enqueueFolderRefresh();
  }

  /**
   * 이 기기에서 각 폴더가 놓인 위치 [{ id, name, localRoot, blocked, blockedReason, paused }]
   * blockedReason  'missing'(폴더가 없음) | 'empty'(폴더는 있는데 완전히 비어 있음) | null
   * paused         이 폴더를 따로 멈춰 둠
   */
  folderList() {
    return [...this.folders.values()].map((ctx) => ({
      id: ctx.id, name: ctx.name, localRoot: ctx.localRoot, blocked: ctx.blocked, blockedReason: ctx.blocked ? (ctx.blockedReason ?? 'missing') : null, paused: ctx.paused,
    }));
  }

  // ───────── 동기화 중지·다시 시작 (사용자가 거는 것. 이 기기에만 해당한다) ─────────
  //
  // 중지는 자동으로 오가는 것(올리기·받기·삭제 전파·주기적 확인)을 모두 멈춘다.
  // 다시 시작은 앱을 껐다 켠 것과 같다: 폴더를 훑고(전체 점검) 변경 목록을 받아 같은 결정표로 처리한다.
  // 폴더는 "전체도 안 멈췄고 그 폴더도 안 멈췄을 때"만 돈다. 전체를 다시 시작해도 따로 멈춘 폴더는 풀리지 않는다.

  async pauseFolder(folderId) {
    const ctx = this.folders.get(Number(folderId));
    if (!ctx || ctx.paused) return false;
    ctx.paused = true;
    this.#savePaused(ctx);
    await this.#deactivate(ctx);
    this.log(`[${ctx.name}] 동기화 중지`);
    this.emit('sync:status', this.status);
    return true;
  }

  resumeFolder(folderId) {
    const ctx = this.folders.get(Number(folderId));
    if (!ctx || !ctx.paused) return false;
    ctx.paused = false;
    this.#savePaused(ctx);
    this.log(`[${ctx.name}] 동기화 다시 시작`);
    if (!this.pausedAll) this.#activate(ctx);
    this.emit('sync:status', this.status);
    return true;
  }

  async pauseAll() {
    if (this.pausedAll) return false;
    this.pausedAll = true;
    saveSettings(this.settingsFile, { pausedAll: true });
    this.queue.drop((key) => key === 'folders');
    await Promise.all([...this.folders.values()].map((ctx) => this.#deactivate(ctx)));
    this.log('전체 동기화 중지');
    this.emit('sync:status', this.status);
    return true;
  }

  resumeAll() {
    if (!this.pausedAll) return false;
    this.pausedAll = false;
    saveSettings(this.settingsFile, { pausedAll: false });
    this.log('전체 동기화 다시 시작');
    for (const ctx of this.folders.values()) {
      if (!ctx.paused) this.#activate(ctx);
    }
    this.#enqueueFolderRefresh();
    this.emit('sync:status', this.status);
    return true;
  }

  /**
   * 로컬 폴더가 없어져 멈춘 폴더(blocked)에 새 위치를 지정한다.
   * 기준 항목을 버리고 커서를 0으로 되돌려 "새 기기 최초 연결"과 같은 경로로 다시 맞춘다:
   * 서버 파일이 새 위치에 없으면 내려받고, 내용이 같으면 기준만 기록하고, 다르면 충돌로 처리한다.
   * 기준이 없으므로 "없는 파일 = 삭제"로 판단되는 일이 없다.
   * @returns {{ ok: true, localRoot } | { ok: false, message }}
   */
  relocateFolder(folderId, newRoot) {
    const ctx = this.folders.get(Number(folderId));
    if (!ctx) return { ok: false, message: '폴더를 찾을 수 없습니다.' };
    if (!ctx.blocked) return { ok: false, message: '위치를 다시 지정할 필요가 없는 폴더입니다.' };
    let stat = null;
    try { stat = fs.statSync(newRoot); } catch { /* 없음 */ }
    if (!stat || !stat.isDirectory()) return { ok: false, message: '고른 위치가 폴더가 아닙니다.' };
    const target = path.resolve(newRoot);
    for (const other of this.folders.values()) {
      if (other === ctx) continue;
      const root = path.resolve(other.localRoot);
      if (target === root || target.startsWith(root + path.sep) || root.startsWith(target + path.sep)) {
        return { ok: false, message: `다른 동기화 폴더(${other.name})와 겹치는 위치입니다.` };
      }
    }
    const state = emptyState(target);
    state.folderName = ctx.name;
    if (ctx.paused) state.paused = true;
    saveState(ctx.stateFile, state);
    ctx.state = state;
    ctx.localRoot = target;
    ctx.blocked = false;
    ctx.blockedReason = null;
    ctx.remote.clear();
    ctx.absentSince.clear();
    this.log(`[${ctx.name}] 위치 다시 지정: ${target} (서버 내용과 처음부터 다시 맞춥니다)`);
    if (!this.#paused(ctx)) this.#activate(ctx);
    this.emit('sync:status', this.status);
    return { ok: true, localRoot: target };
  }

  #paused(ctx) {
    return this.pausedAll || ctx.paused;
  }

  #savePaused(ctx) {
    if (ctx.paused) ctx.state.paused = true;
    else delete ctx.state.paused;
    // 폴더가 없어 멈춘(blocked) 폴더도 상태 파일은 있다. 중지 여부만 고쳐 적는다.
    saveState(ctx.stateFile, ctx.state);
  }

  /**
   * 화면 표시용 상태. 엔진의 상태에 진행 정보를 덧붙인다:
   *   lastPollAt  마지막으로 서버를 확인한 시각(ms)
   *   pending     처리를 기다리는 파일 수
   *   folders     [{ id, pending, paths }] 폴더별 기다리는 파일 경로
   */
  getStatus() {
    const byFolder = new Map();
    for (const key of this.queue.keys()) {
      const m = /^file:(\d+):(.*)$/s.exec(key);
      if (!m) continue;
      const id = Number(m[1]);
      if (!byFolder.has(id)) byFolder.set(id, []);
      byFolder.get(id).push(m[2]);
    }
    const folders = [...byFolder].map(([id, paths]) => ({ id, pending: paths.length, paths: paths.slice(0, 500) }));
    const pending = folders.reduce((n, f) => n + f.pending, 0);
    // 로컬 폴더가 없어져 멈춘 폴더 수. 큐가 비면 state는 'idle'이 되므로 화면은 이 값으로 "모두 동기화됨"이 아님을 안다
    const blocked = [...this.folders.values()].filter((ctx) => ctx.blocked).length;
    return { ...this.status, lastPollAt: this.lastPollAt, pending, folders, pausedAll: this.pausedAll, blocked };
  }

  /**
   * 이 기기에서 고른 폴더를 서버에 등록하고 감시를 시작한다. 등록한 기기는 고른 경로를 그대로 쓴다.
   * @returns {{ ok: true, folder } | { ok: false, status, message, current }}
   */
  async registerFolder(localPath) {
    const name = normalizeRel(localPath).split('/').pop();
    this.pendingRoots.set(name, localPath);
    try {
      const folder = await this.api.registerFolder(this.userId, localPath);
      this.#attach(folder, localPath);
      return { ok: true, folder };
    } catch (err) {
      // 409: 같은 이름의 폴더가 이미 있다 (current = 기존 폴더)
      return { ok: false, status: err.status ?? 0, message: err.body?.message || err.message, current: err.body?.current ?? null };
    } finally {
      this.pendingRoots.delete(name);
    }
  }

  /** 폴더 동기화를 그만둔다. 로컬 파일은 건드리지 않고 감시와 상태 파일만 없앤다. */
  async removeFolder(folderId) {
    const ctx = this.folders.get(Number(folderId));
    if (ctx) await this.#detach(ctx);
  }

  // ───────── 폴더 연결 ─────────

  #tick() {
    if (this.stopped || this.pollingPaused || this.pausedAll) return;
    this.#enqueueFolderRefresh();
  }

  #enqueueFolderRefresh() {
    this.queue.enqueue('folders', () => this.#refreshFolders());
  }

  /** 서버의 폴더 목록과 맞춘다: 새 폴더는 연결하고, 서버에서 없어진 폴더는 감시만 멈춘다. */
  async #refreshFolders() {
    const list = await this.api.listFolders(this.userId);
    if (!Array.isArray(list)) throw new Error('폴더 목록 응답이 배열이 아닙니다');
    this.lastPollAt = Date.now();
    const ids = new Set(list.map((f) => Number(f.id)));
    for (const folder of list) {
      if (!this.folders.has(Number(folder.id))) {
        this.#attach(folder, null);
        this.emit('dosync-folder-added', folder);
      }
    }
    for (const ctx of [...this.folders.values()]) {
      if (!ids.has(ctx.id)) {
        this.log(`[${ctx.name}] 서버에서 폴더가 삭제됨 → 감시를 멈춥니다 (로컬 파일은 그대로 둡니다)`);
        await this.#detach(ctx);
        this.emit('sync-folder-removed', { folderId: ctx.id });
      }
    }
    for (const ctx of this.folders.values()) {
      this.#maybeRecover(ctx);
      this.#enqueuePoll(ctx);
    }
  }

  #attach(folder, chosenRoot) {
    const id = Number(folder.id);
    if (this.folders.has(id)) return;
    const name = String(folder.name ?? '').normalize('NFC');
    const stateFile = stateFilePath(this.stateDir, this.userId, id);
    const preferred = chosenRoot ?? this.pendingRoots.get(name) ?? null;

    let state = loadState(stateFile);
    // 서버 DB가 초기화되면 폴더 id가 다시 쓰인다. 이름이 다른 폴더의 옛 상태 파일은 버린다.
    // (상태에 폴더 이름이 적혀 있으면 그것으로, 예전 상태 파일이면 localRoot의 마지막 요소로 비교한다)
    const stateName = state ? (state.folderName ?? path.basename(state.localRoot)).normalize('NFC') : null;
    if (state && stateName !== name) state = null;
    if (state && preferred && path.resolve(state.localRoot) !== path.resolve(preferred)) state = null;
    if (!state) state = emptyState(preferred ?? path.join(this.xorRoot, this.username, name));
    state.folderName = name;

    const ctx = {
      id, name, stateFile, state,
      localRoot: state.localRoot,
      remote: new Map(),      // 경로 → FileChange (기준과 다른 서버 상태)
      absentSince: new Map(), // 경로 → 디스크에서 없어진 것을 처음 본 시각
      watcher: null,
      blocked: false,
      paused: state.paused === true, // 사용자가 이 폴더를 멈춰 두었는가
    };
    this.folders.set(id, ctx);
    this.#activate(ctx);
  }

  /**
   * 폴더의 감시·전체 점검·폴링을 시작한다. 처음 연결할 때와 중지했다가 다시 시작할 때 모두 여기를 거친다.
   * 그래서 "폴더가 통째로 없으면 멈춤" 검사도 두 경우 모두에 적용된다.
   */
  #activate(ctx) {
    const { id, name, state } = ctx;
    const hasBase = Object.keys(state.files).length > 0;
    const exists = fs.existsSync(ctx.localRoot);
    if (!exists && !hasBase) fs.mkdirSync(ctx.localRoot, { recursive: true });
    // 기준은 있는데 폴더가 통째로 없거나(이동·드라이브 분리 등) 완전히 비어 있다(같은 자리에 빈 폴더만 다시 만든 경우).
    // 이대로 훑으면 전부 "삭제"로 서버에 전파되므로 멈춘다. 실행 중에 사용자가 안의 파일을 지우는 것은 여기로 오지 않는다.
    const reason = !hasBase ? null : !exists ? 'missing' : !this.#rootHasContent(ctx) ? 'empty' : null;
    if (reason) {
      ctx.blocked = true;
      ctx.blockedReason = reason;
      this.log(reason === 'missing'
        ? `[${name}] 로컬 폴더가 없습니다: ${ctx.localRoot} → 이 폴더는 동기화하지 않습니다`
        : `[${name}] 로컬 폴더가 비어 있습니다: ${ctx.localRoot} → 삭제로 전파하지 않도록 이 폴더는 동기화하지 않습니다`);
      this.#setStatus({ state: 'error', folderId: id, message: reason === 'missing' ? `로컬 폴더를 찾을 수 없습니다: ${ctx.localRoot}` : `로컬 폴더가 비어 있습니다: ${ctx.localRoot}` });
      return;
    }
    ctx.blocked = false; // 없어졌던 폴더가 돌아왔으면 다시 돈다
    ctx.blockedReason = null;
    saveState(ctx.stateFile, state);
    if (this.#paused(ctx)) {
      this.log(`[${name}] 연결(동기화 중지 상태): ${ctx.localRoot}`);
      return;
    }
    this.log(`[${name}] 연결: ${ctx.localRoot} (cursor ${state.cursor}, 기준 ${Object.keys(state.files).length}개)`);

    if (this.watch && !ctx.watcher) {
      ctx.watcher = startWatcher(ctx.localRoot, {
        onDirty: (rel) => this.#enqueueReconcile(ctx, rel),
        onDirRemoved: (rel) => {
          for (const p of Object.keys(ctx.state.files)) {
            if (p.startsWith(`${rel}/`)) this.#enqueueReconcile(ctx, p);
          }
        },
        onError: (err) => this.log(`[${name}] 감시 오류: ${err.message}`),
      });
    }
    this.queue.enqueue(`scan:${id}`, () => this.#fullScan(ctx));
  }

  /** 동기화 폴더에 (무시 목록이 아닌) 항목이 하나라도 있는가. 폴더가 없으면 false */
  #rootHasContent(ctx) {
    try {
      return fs.readdirSync(ctx.localRoot).some((entry) => !isIgnored(entry));
    } catch {
      return false;
    }
  }

  /** 기준은 있는데 동기화 폴더 자체가 없는가 (통째로 지워짐·옮겨짐·드라이브 분리) */
  #rootGone(ctx) {
    return Object.keys(ctx.state.files).length > 0 && !fs.existsSync(ctx.localRoot);
  }

  /**
   * 실행 중에 동기화 폴더가 통째로 없어졌다. 안의 파일을 "삭제"로 전파하지 않고 이 폴더만 멈춘다.
   * (앱이 꺼져 있던 동안 없어진 경우와 같은 처리. 폴더 안의 파일·하위 폴더를 지우는 것은 평소대로 전파된다)
   */
  async #block(ctx) {
    if (ctx.blocked) return;
    ctx.blocked = true;
    ctx.blockedReason = 'missing';
    ctx.rootSeenAt = null;
    this.log(`[${ctx.name}] 로컬 폴더가 없어졌습니다: ${ctx.localRoot} → 삭제를 전파하지 않고 이 폴더의 동기화를 멈춥니다`);
    await this.#deactivate(ctx);
    this.#setStatus({ state: 'error', folderId: ctx.id, message: `로컬 폴더를 찾을 수 없습니다: ${ctx.localRoot}` });
  }

  /**
   * 멈춘(blocked) 폴더가 원래 자리에 내용이 든 채로 돌아왔으면 다시 이어 간다 (휴지통에서 복원, 드라이브 다시 연결).
   * 빈 폴더는 이어 가지 않는다: 기준과 비교하면 전부 "삭제"가 되기 때문이다.
   * 복원하는 도중일 수 있으므로 돌아온 것을 처음 본 뒤 recoverDelayMs가 지난 다음 확인 때 이어 간다.
   */
  #maybeRecover(ctx) {
    if (!ctx.blocked || this.#paused(ctx)) return;
    if (!this.#rootHasContent(ctx)) {
      // 여전히 없거나 비어 있다. 사유만 지금 상태에 맞춘다 (없던 자리에 빈 폴더가 생긴 경우)
      ctx.rootSeenAt = null;
      const reason = fs.existsSync(ctx.localRoot) ? 'empty' : 'missing';
      if (ctx.blockedReason !== reason) { ctx.blockedReason = reason; this.emit('sync:status', this.status); }
      return;
    }
    if (!ctx.rootSeenAt) { ctx.rootSeenAt = Date.now(); return; }
    if (Date.now() - ctx.rootSeenAt < this.recoverDelayMs) return;
    ctx.rootSeenAt = null;
    this.log(`[${ctx.name}] 로컬 폴더가 돌아왔습니다: ${ctx.localRoot} → 동기화를 이어 갑니다`);
    this.#activate(ctx);
    this.emit('sync:status', this.status);
  }

  /** 폴더의 감시를 멈추고 기다리는 작업을 버린다 (동기화 중지). 상태 파일과 커서는 그대로 둔다. */
  async #deactivate(ctx) {
    const watcher = ctx.watcher;
    ctx.watcher = null;
    this.queue.drop((key) => key === `scan:${ctx.id}` || key === `poll:${ctx.id}` || key.startsWith(`file:${ctx.id}:`));
    // 받아 둔 서버 변경은 버린다. 커서를 올리지 않았으므로 다시 시작할 때 같은 변경을 다시 받는다.
    ctx.remote.clear();
    ctx.absentSince.clear();
    if (watcher) await watcher.close();
  }

  async #detach(ctx) {
    this.folders.delete(ctx.id);
    if (ctx.watcher) await ctx.watcher.close();
    removeState(ctx.stateFile);
  }

  #alive(ctx) {
    return !this.stopped && !ctx.blocked && !this.#paused(ctx) && this.folders.get(ctx.id) === ctx;
  }

  // ───────── 전체 점검·폴링 ─────────

  /** 시작 시 전체 점검: 상태 파일과 다른 경로(추가·수정·삭제)를 모두 큐에 넣고, 이어서 변경 목록을 받는다. */
  async #fullScan(ctx) {
    if (!this.#alive(ctx)) return;
    const disk = await scanFolder(ctx.localRoot);
    let dirty = 0;
    for (const [rel, st] of disk) {
      const base = ctx.state.files[rel];
      if (!base || base.size !== st.size || base.mtimeMs !== st.mtimeMs) {
        this.#enqueueReconcile(ctx, rel);
        dirty++;
      }
    }
    for (const rel of Object.keys(ctx.state.files)) {
      if (!disk.has(rel)) {
        this.#enqueueReconcile(ctx, rel);
        dirty++;
      }
    }
    this.log(`[${ctx.name}] 전체 점검: 디스크 ${disk.size}개 중 확인 필요 ${dirty}개`);
    this.#enqueuePoll(ctx);
  }

  #enqueuePoll(ctx) {
    if (this.pollingPaused || !this.#alive(ctx)) return;
    this.queue.enqueue(`poll:${ctx.id}`, () => this.#poll(ctx));
  }

  #enqueueReconcile(ctx, rel, delayMs = 0) {
    if (isIgnored(rel)) return;
    this.queue.enqueue(`file:${ctx.id}:${rel}`, () => this.reconcile(ctx, rel), { delayMs });
  }

  /**
   * 변경 목록을 받아 ctx.remote에 반영한다. 커서는 여기서 올리지 않는다.
   * @returns {{ cursor: number, orphaned: string[] }} orphaned = 서버가 모르는 기준 항목(전체 조회일 때만)
   */
  async #fetchChanges(ctx) {
    let since = ctx.state.cursor;
    let resp = await this.api.changes(this.userId, ctx.id, since);
    if (resp.cursor < since) {
      // 서버의 일련번호가 내 커서보다 작다 = 서버가 초기화됐다. 처음부터 다시 받는다.
      this.log(`[${ctx.name}] 서버 커서(${resp.cursor})가 내 커서(${since})보다 작음 → 0부터 다시 받습니다`);
      since = 0;
      ctx.state.cursor = 0;
      saveState(ctx.stateFile, ctx.state);
      resp = await this.api.changes(this.userId, ctx.id, 0);
    }
    const seen = new Set();
    for (const change of resp.changes || []) {
      const rel = normalizeRel(change.relativePath);
      if (!rel || isIgnored(rel)) continue;
      seen.add(rel);
      ctx.remote.set(rel, change);
    }
    const orphaned = [];
    if (since === 0) {
      // 전체 조회인데 서버에 없는 기준 항목: 서버가 모르는 파일이므로 기준을 지워 새 파일로 다시 올리게 한다
      for (const rel of Object.keys(ctx.state.files)) {
        if (!seen.has(rel)) orphaned.push(rel);
      }
    }
    return { cursor: resp.cursor, orphaned };
  }

  /** 폴링 1회: 변경 목록 → 경로마다 reconcile → 전부 반영됐을 때만 커서를 올린다. */
  async #poll(ctx) {
    if (!this.#alive(ctx)) return;
    let fetched;
    try {
      fetched = await this.#fetchChanges(ctx);
    } catch (err) {
      if (err.status === 404 || err.status === 400) {
        // 폴더가 서버에서 없어졌을 수 있다. 폴더 목록을 다시 맞춘다.
        this.#enqueueFolderRefresh();
        return;
      }
      throw err;
    }
    for (const rel of fetched.orphaned) {
      delete ctx.state.files[rel];
      this.#enqueueReconcile(ctx, rel);
    }
    if (fetched.orphaned.length) saveState(ctx.stateFile, ctx.state);

    let allApplied = true;
    for (const rel of [...ctx.remote.keys()]) {
      if (!this.#alive(ctx)) return;
      try {
        await this.reconcile(ctx, rel);
      } catch (err) {
        if (err.auth || (err.retryable && err.status !== undefined)) throw err; // 서버 문제: 폴링 전체를 나중에 다시
        allApplied = false;
        this.log(`[${ctx.name}] ${rel}: 반영 실패, 다음 폴링에서 다시 시도 (${err.message})`);
        this.#enqueueReconcile(ctx, rel, 3000);
      }
    }
    // 처리 도중 폴더가 멈췄으면(동기화 중지, 폴더 없어짐) 변경을 다 반영한 것이 아니다. 커서를 올리지 않는다.
    if (!this.#alive(ctx)) return;
    // 반영하지 못한 변경이 있으면 커서를 그대로 둔다. 다음 폴링이 같은 변경을 다시 받아도 결과는 같다.
    if (allApplied && fetched.cursor !== ctx.state.cursor) {
      ctx.state.cursor = fetched.cursor;
      saveState(ctx.stateFile, ctx.state);
    }
  }

  // ───────── reconcile ─────────

  /** 한 경로의 디스크·기준·서버 상태를 비교해 결정표대로 처리한다. */
  async reconcile(ctx, rel) {
    for (let round = 0; round < 6; round++) {
      if (!this.#alive(ctx)) return;
      // 폴더가 통째로 없어졌으면 파일 하나하나를 "삭제"로 보지 않고 폴더를 멈춘다
      if (this.#rootGone(ctx)) { await this.#block(ctx); return; }
      const abs = path.join(ctx.localRoot, rel);
      const base = ctx.state.files[rel] ?? null;

      let remote = ctx.remote.get(rel) ?? null;
      if (remote && base && !remote.deleted && remote.version === base.baseVersion) {
        ctx.remote.delete(rel); // 이미 반영한 변경 (내가 올린 것 포함)
        remote = null;
      }

      // L: 크기·수정 시각이 기준과 같으면 해시를 다시 구하지 않는다
      let st;
      let local = null;
      try {
        st = await statFile(abs);
        if (st) {
          const untouched = base && base.size === st.size && base.mtimeMs === st.mtimeMs;
          local = { hash: untouched ? base.baseHash : await hashFile(abs) };
        }
      } catch (err) {
        if (err.code === 'ENOENT') { st = null; local = null; } else throw asRetry(err, rel);
      }
      if (st && base && local.hash === base.baseHash && (base.size !== st.size || base.mtimeMs !== st.mtimeMs)) {
        // 내용은 그대로이고 시각만 바뀜: 다음 점검에서 해시를 다시 구하지 않도록 기록만 고친다
        base.size = st.size;
        base.mtimeMs = st.mtimeMs;
        saveState(ctx.stateFile, ctx.state);
      }

      const action = decide({ local, base, remote });

      if (action === 'DELETE_REMOTE') {
        // Office는 "삭제 → 추가"로 저장한다. 없어진 지 deleteDelayMs가 지나도 여전히 없을 때만 삭제로 본다.
        const now = Date.now();
        const since = ctx.absentSince.get(rel) ?? now;
        ctx.absentSince.set(rel, since);
        const wait = this.deleteDelayMs - (now - since);
        if (wait > 0) {
          this.#enqueueReconcile(ctx, rel, wait);
          return;
        }
      }
      ctx.absentSince.delete(rel);

      let again = false;
      switch (action) {
        case 'NONE':
          if (remote && !base && remote.deleted) ctx.remote.delete(rel);
          return;
        case 'UPLOAD':
          again = await this.#upload(ctx, rel, abs, { baseVersion: base ? base.baseVersion : 0, conflictWith: base?.conflictWith });
          break;
        case 'UPLOAD_REVIVE': // 서버에서는 삭제됐지만 로컬에서 고쳤다: 새 파일로 올린다(같은 FileMeta가 되살아난다)
          again = await this.#upload(ctx, rel, abs, { baseVersion: 0 });
          break;
        case 'DELETE_REMOTE':
          again = await this.#deleteRemote(ctx, rel, base);
          break;
        case 'DOWNLOAD':
          again = await this.#download(ctx, rel, abs, remote, st);
          break;
        case 'TRASH_LOCAL':
          await this.#trashLocal(ctx, rel, abs);
          break;
        case 'ADOPT': // 양쪽이 같은 내용: 기준만 갱신
          this.#setBase(ctx, rel, { fileId: remote.fileId, baseVersion: remote.version, baseHash: remote.hash, size: st.size, mtimeMs: st.mtimeMs });
          ctx.remote.delete(rel);
          break;
        case 'CONFLICT':
          again = await this.#conflict(ctx, rel, abs, remote);
          break;
        case 'DROP_BASE':
          delete ctx.state.files[rel];
          ctx.remote.delete(rel);
          saveState(ctx.stateFile, ctx.state);
          break;
        default:
          throw new Error(`알 수 없는 동작: ${action}`);
      }
      if (!again) return;
    }
    throw new RetryLater(`${rel}: 상태가 계속 바뀌어 처리를 미룹니다`);
  }

  #setBase(ctx, rel, entry) {
    ctx.state.files[rel] = entry;
    saveState(ctx.stateFile, ctx.state);
  }

  /** 업로드. 반환값 true = 서버 상태를 새로 알았으니 같은 경로를 다시 판단하라. */
  async #upload(ctx, rel, abs, { baseVersion, conflictWith }) {
    let st;
    let buffer;
    try {
      st = await statFile(abs); // 읽기 전에 잰다: 읽는 도중 바뀌면 다음 점검에서 시각이 달라 다시 보게 된다
      if (!st) return true;
      buffer = await fs.promises.readFile(abs);
    } catch (err) {
      if (err.code === 'ENOENT') return true;
      throw asRetry(err, rel);
    }
    const hash = hashBuffer(buffer);
    let res;
    try {
      res = await this.api.upload(this.userId, ctx.id, { relPath: rel, buffer, baseVersion, hash, conflictWith });
    } catch (err) {
      if (err.status !== 409) throw err;
      // 서버 버전이 내 기준과 다르다. 서버의 현재 상태를 받아 다시 판단한다(충돌·기준 갱신 등).
      const current = err.body?.current ?? null;
      if (current) {
        ctx.remote.set(rel, current);
      } else {
        if (!ctx.state.files[rel]) throw err; // 기준도 없는데 409: 더 할 수 있는 것이 없다
        delete ctx.state.files[rel];          // 서버에 없는 파일: 새 파일로 다시 올린다
        ctx.remote.delete(rel);
        saveState(ctx.stateFile, ctx.state);
      }
      this.log(`[${ctx.name}] ${rel}: 서버 버전이 달라 다시 판단 (409)`);
      return true;
    }
    this.#setBase(ctx, rel, { fileId: res.fileId, baseVersion: res.version, baseHash: res.hash || hash, size: st.size, mtimeMs: st.mtimeMs });
    const known = ctx.remote.get(rel);
    if (known && known.version <= res.version) ctx.remote.delete(rel);
    this.log(`[${ctx.name}] 업로드 ${rel} → v${res.version} (${res.status}${conflictWith ? `, v${conflictWith}과 충돌 후 저장` : ''})`);
    if (res.status !== 'UNCHANGED') {
      this.emit(res.status === 'CREATED' ? 'sync-file-added' : 'sync-file-updated', { folderId: ctx.id, relativePath: rel });
      this.#enqueuePoll(ctx); // 내가 올린 직후에는 바로 한 번 확인한다
    }
    return false;
  }

  async #deleteRemote(ctx, rel, base) {
    try {
      await this.api.deleteFile(this.userId, ctx.id, base.fileId, base.baseVersion);
    } catch (err) {
      if (err.status === 409) {
        // 다른 기기가 그 사이에 고쳤다: 수정이 삭제를 이긴다 → 다시 판단하면 다운로드가 된다
        const current = err.body?.current ?? null;
        if (current) ctx.remote.set(rel, current);
        this.log(`[${ctx.name}] ${rel}: 삭제하려 했으나 서버에 더 새 버전이 있음 → 수정이 이김`);
        return !!current;
      }
      if (err.status !== 404) throw err;
    }
    delete ctx.state.files[rel];
    ctx.remote.delete(rel);
    saveState(ctx.stateFile, ctx.state);
    this.log(`[${ctx.name}] 서버에 삭제 요청 ${rel}`);
    this.emit('sync-file-deleted', { folderId: ctx.id, relativePath: rel });
    this.#enqueuePoll(ctx);
    return false;
  }

  /**
   * 서버 최신본을 같은 폴더의 .xor-tmp-* 에 내려받아 해시를 확인한다.
   * @returns {{ tmp, version, hash, size } | null} 서버에 파일이 없으면(404) null
   */
  async #fetchToTemp(ctx, rel, destAbs) {
    const dir = path.dirname(destAbs);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.xor-tmp-${randomBytes(6).toString('hex')}`);
    for (let attempt = 1; ; attempt++) {
      let got;
      try {
        got = await this.api.download(this.userId, ctx.id, rel, tmp);
      } catch (err) {
        await fs.promises.rm(tmp, { force: true }).catch(() => {});
        if (err.status === 404) return null;
        throw asRetry(err, rel);
      }
      // 메타 조회와 본문 전송 사이에 새 버전이 올라오면 본문이 X-File-Hash와 다를 수 있다 → 다시 받는다
      if (got.hash && got.actualHash === got.hash) return { tmp, version: got.version, hash: got.hash, size: got.size };
      await fs.promises.rm(tmp, { force: true }).catch(() => {});
      if (attempt >= 3) throw new RetryLater(`${rel}: 내려받은 내용의 해시가 서버 값과 다릅니다`);
    }
  }

  async #download(ctx, rel, abs, remote, statAtDecision) {
    const got = await this.#fetchToTemp(ctx, rel, abs);
    if (!got) {
      // 그 사이 서버에서 삭제됨: 낡은 소식을 버리고 다음 폴링(툼스톤)을 기다린다
      ctx.remote.delete(rel);
      this.#enqueuePoll(ctx);
      return false;
    }
    try {
      // 내려받는 동안 로컬 파일이 바뀌었으면 덮어쓰지 않고 다시 판단한다
      const now = await statFile(abs);
      const same = (!now && !statAtDecision)
        || (now && statAtDecision && now.size === statAtDecision.size && now.mtimeMs === statAtDecision.mtimeMs);
      if (!same) {
        await fs.promises.rm(got.tmp, { force: true });
        return true;
      }
      await fs.promises.rename(got.tmp, abs);
    } catch (err) {
      await fs.promises.rm(got.tmp, { force: true }).catch(() => {});
      throw asRetry(err, rel);
    }
    // 이름을 바꾼 직후 기준을 갱신한다. 뒤따르는 감시 이벤트는 "L = B"라 아무 일도 하지 않는다(감시 루프 방지).
    const st = await statFile(abs);
    this.#setBase(ctx, rel, { fileId: remote.fileId, baseVersion: got.version, baseHash: got.hash, size: st?.size ?? got.size, mtimeMs: st?.mtimeMs ?? 0 });
    if (got.version >= remote.version) ctx.remote.delete(rel);
    this.log(`[${ctx.name}] 다운로드 ${rel} ← v${got.version}`);
    this.emit(statAtDecision ? 'sync-file-updated' : 'sync-file-added', { folderId: ctx.id, relativePath: rel });
    return false;
  }

  async #trashLocal(ctx, rel, abs) {
    try {
      await this.trash(abs); // 완전 삭제하지 않는다
    } catch (err) {
      if (!fs.existsSync(abs)) { /* 이미 없음 */ } else throw new RetryLater(`${rel}: 휴지통으로 보내지 못했습니다 (${err.message})`);
    }
    delete ctx.state.files[rel];
    ctx.remote.delete(rel);
    saveState(ctx.stateFile, ctx.state);
    this.log(`[${ctx.name}] 서버에서 삭제됨 → 휴지통으로 ${rel}`);
    this.emit('sync-file-deleted', { folderId: ctx.id, relativePath: rel });
    // 비게 된 상위 디렉터리는 치운다 (rmdir은 비어 있을 때만 성공한다)
    let dir = path.dirname(abs);
    while (path.resolve(dir) !== path.resolve(ctx.localRoot) && dir.startsWith(ctx.localRoot)) {
      try { await fs.promises.rmdir(dir); } catch { break; }
      dir = path.dirname(dir);
    }
  }

  /**
   * 충돌: 서버본(vN)을 `파일명_기기이름_서버저장시각.확장자`로 내려받고, 기준을 N으로 기록한다.
   * 그다음 다시 판단하면 "업로드(baseVersion=N, conflictWith=N)"가 되어 내 파일이 vN+1이 된다.
   * 기준에 conflictWith를 적어 두므로 여기서 앱이 죽어도 다음 실행 때 같은 업로드가 이어진다.
   */
  async #conflict(ctx, rel, abs, remote) {
    const versions = await this.api.versions(this.userId, ctx.id, remote.fileId);
    const row = Array.isArray(versions) ? versions.find((v) => v.versionNumber === remote.version) : null;
    const deviceName = row?.deviceName || (remote.deviceId ? String(remote.deviceId).slice(0, 8) : '');
    const copyRel = conflictCopyName(rel, deviceName, row?.createdDate);
    const copyAbs = path.join(ctx.localRoot, copyRel);

    if (!fs.existsSync(copyAbs)) {
      const got = await this.#fetchToTemp(ctx, rel, copyAbs);
      if (!got || got.version !== remote.version) {
        // 사본을 받는 사이 서버가 또 바뀌었다: 변경 목록을 다시 받아 처음부터 판단한다
        if (got) await fs.promises.rm(got.tmp, { force: true }).catch(() => {});
        ctx.remote.delete(rel);
        await this.#fetchChanges(ctx);
        return true;
      }
      try {
        await fs.promises.rename(got.tmp, copyAbs);
      } catch (err) {
        await fs.promises.rm(got.tmp, { force: true }).catch(() => {});
        throw asRetry(err, copyRel);
      }
    }
    // 사본은 새 파일로 감지돼 평소대로 업로드되고 다른 기기에도 내려간다
    this.#enqueueReconcile(ctx, copyRel);

    this.#setBase(ctx, rel, {
      fileId: remote.fileId, baseVersion: remote.version, baseHash: remote.hash,
      size: -1, mtimeMs: -1, // 로컬 내용은 기준과 다르다: 다음 판단에서 반드시 해시를 다시 구한다
      conflictWith: remote.version,
    });
    ctx.remote.delete(rel);
    this.log(`[${ctx.name}] 충돌 ${rel}: 서버 v${remote.version}을 ${copyRel}로 보관, 내 파일을 다시 올립니다`);
    this.emit('sync:status', { state: 'conflict', folderId: ctx.id, relativePath: rel, copyPath: copyRel, conflictWith: remote.version });
    return true;
  }

  #setStatus(status) {
    this.status = status;
    this.emit('sync:status', status);
  }
}
