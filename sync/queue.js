// sync/queue.js
// 직렬 실행 큐: 한 번에 하나씩, 같은 키는 한 건으로 합치고, 실패하면 간격을 늘려 다시 시도한다.

export class SerialQueue {
  /**
   * @param {object} opts
   *   onAuthRequired(err)  인증 오류(err.auth)로 큐가 멈췄을 때
   *   onError(key, err)    다시 시도하지 않고 버린 작업
   *   onActive(bool)       큐가 일하기 시작/모두 끝남
   *   onRetry(key, err)    실패한 작업을 나중에 다시 하기로 했을 때 (화면의 "다시 시도 중" 표시용)
   *   baseDelayMs/maxDelayMs/maxAttempts  재시도 간격(지수 증가)과 횟수
   */
  constructor({ onAuthRequired, onError, onActive, onRetry, baseDelayMs = 1000, maxDelayMs = 60000, maxAttempts = 8 } = {}) {
    this.jobs = new Map(); // key → { fn, notBefore, attempts }
    this.running = null;   // 실행 중인 키
    this.rerun = null;     // 실행 중인 키가 다시 들어오면 끝난 뒤 한 번 더 돌린다
    this.paused = false;
    this.timer = null;
    this.idleWaiters = [];
    this.active = false;
    this.onAuthRequired = onAuthRequired;
    this.onError = onError;
    this.onActive = onActive;
    this.onRetry = onRetry;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.maxAttempts = maxAttempts;
  }

  /** 작업을 넣는다. 같은 키가 이미 기다리고 있으면 합친다(더 이른 시각을 따른다). */
  enqueue(key, fn, { delayMs = 0 } = {}) {
    const notBefore = Date.now() + delayMs;
    if (this.running === key) {
      this.rerun = { fn, notBefore, attempts: 0 };
      return;
    }
    const existing = this.jobs.get(key);
    if (existing) {
      existing.fn = fn;
      existing.notBefore = Math.min(existing.notBefore, notBefore);
    } else {
      this.jobs.set(key, { fn, notBefore, attempts: 0 });
    }
    this.#schedule();
  }

  has(key) {
    return this.jobs.has(key) || this.running === key;
  }

  /** 기다리거나 실행 중인 작업의 키 목록 (화면의 진행 표시용) */
  keys() {
    const keys = [...this.jobs.keys()];
    if (this.running && !this.jobs.has(this.running)) keys.push(this.running);
    return keys;
  }

  get size() {
    return this.jobs.size + (this.running ? 1 : 0);
  }

  pause() {
    this.paused = true;
    clearTimeout(this.timer);
    this.timer = null;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.#schedule();
  }

  /** 기다리는 작업을 모두 버린다 (실행 중인 것은 끝까지 간다). */
  clear() {
    this.jobs.clear();
    this.rerun = null;
    clearTimeout(this.timer);
    this.timer = null;
    this.#checkIdle();
  }

  /** 큐가 비고 실행 중인 작업이 없을 때 끝나는 Promise. 멈춘 상태면 끝나지 않는다. */
  idle() {
    if (this.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  #setActive(value) {
    if (this.active === value) return;
    this.active = value;
    if (this.onActive) this.onActive(value);
  }

  #checkIdle() {
    if (this.size !== 0) return;
    this.#setActive(false);
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  #schedule() {
    if (this.paused || this.running || this.timer) return;
    if (this.jobs.size === 0) return;
    // 실행 가능 시각이 가장 이른 작업을 고른다 (같으면 먼저 들어온 것)
    let nextKey = null;
    let next = null;
    for (const [key, job] of this.jobs) {
      if (!next || job.notBefore < next.notBefore) { nextKey = key; next = job; }
    }
    const wait = next.notBefore - Date.now();
    if (wait > 0) {
      this.timer = setTimeout(() => { this.timer = null; this.#schedule(); }, wait);
      return;
    }
    this.jobs.delete(nextKey);
    this.#run(nextKey, next);
  }

  async #run(key, job) {
    this.running = key;
    this.#setActive(true);
    let failure = null;
    try {
      await job.fn();
    } catch (err) {
      failure = err;
    }
    this.running = null;
    const rerun = this.rerun;
    this.rerun = null;

    if (failure && failure.auth) {
      // 인증 오류: 작업을 되돌려 놓고 멈춘다. 다시 로그인하면 resume()으로 이어 간다.
      this.jobs.set(key, rerun ?? { fn: job.fn, notBefore: Date.now(), attempts: 0 });
      this.pause();
      if (this.onAuthRequired) this.onAuthRequired(failure);
      return;
    }
    if (rerun) {
      this.jobs.set(key, rerun);
    } else if (failure) {
      const attempts = job.attempts + 1;
      if (failure.retryable && attempts < this.maxAttempts) {
        const delay = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempts - 1));
        // 그 사이 같은 키가 새로 들어왔으면 그쪽을 따른다
        if (!this.jobs.has(key)) this.jobs.set(key, { fn: job.fn, notBefore: Date.now() + delay, attempts });
        if (this.onRetry) this.onRetry(key, failure);
      } else if (this.onError) {
        this.onError(key, failure);
      }
    }
    this.#checkIdle();
    this.#schedule();
  }
}
