// sync/api.js
// main 프로세스에서 쓰는 서버 호출. 모든 요청에 토큰과 기기 헤더를 붙인다.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { splitRel } from './paths.js';

/** 서버가 오류로 응답했거나 서버에 닿지 못했을 때. status가 0이면 네트워크 오류다. */
export class ApiError extends Error {
  constructor(status, body, message) {
    super(message || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body; // 파싱된 JSON 본문 ({ status, error, message, current? }) 또는 null
    // 네트워크 오류·5xx·408·429는 간격을 늘려 다시 시도한다
    this.retryable = status === 0 || status >= 500 || status === 408 || status === 429;
    // 토큰이 없거나 만료되면 이 서버는 403을 돌려준다(401이 아님). 둘 다 재로그인 대상으로 본다.
    this.auth = status === 401 || status === 403;
  }
}

const JSON_TIMEOUT_MS = 30000;

/**
 * @param {object} opts
 *   baseUrl     예: http://localhost:8080 (설정값, 하드코딩하지 않는다)
 *   getToken    () => JWT
 *   deviceId    userData에 저장된 UUID
 *   deviceName  호스트명 (헤더에는 퍼센트 인코딩해 보낸다)
 */
export function createApi({ baseUrl, getToken, deviceId, deviceName, fetchImpl = globalThis.fetch }) {
  const base = String(baseUrl).replace(/\/+$/, '');

  function headers(extra = {}) {
    return {
      Authorization: `Bearer ${getToken()}`,
      'X-Device-Id': deviceId,
      'X-Device-Name': encodeURIComponent(deviceName),
      ...extra,
    };
  }

  async function request(method, urlPath, { body, json, timeoutMs } = {}) {
    const init = { method, headers: headers() };
    if (json !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(json);
    } else if (body !== undefined) {
      init.body = body;
    }
    if (timeoutMs) init.signal = AbortSignal.timeout(timeoutMs);
    let res;
    try {
      res = await fetchImpl(base + urlPath, init);
    } catch (err) {
      throw new ApiError(0, null, `서버에 연결하지 못했습니다: ${err.cause?.code || err.message}`);
    }
    return res;
  }

  async function toError(res) {
    let body = null;
    let text = '';
    try {
      text = await res.text();
      body = JSON.parse(text);
    } catch { /* 본문이 JSON이 아님 */ }
    return new ApiError(res.status, body, `HTTP ${res.status}: ${body?.message || text.slice(0, 200)}`);
  }

  async function requestJson(method, urlPath, opts = {}) {
    const res = await request(method, urlPath, { timeoutMs: JSON_TIMEOUT_MS, ...opts });
    if (!res.ok) throw await toError(res);
    try {
      return await res.json();
    } catch (err) {
      throw new ApiError(0, null, `응답을 읽지 못했습니다: ${err.message}`);
    }
  }

  const folderUrl = (userId, folderId) => `/users/${userId}/sync-folders/${folderId}`;

  return {
    /** 등록된 동기화 폴더 목록 [{ id, name, folderPath, ... }] */
    listFolders: (userId) => requestJson('GET', `/users/${userId}/sync-folders`),

    /** 폴더 등록. 같은 이름이 이미 있으면 409이고 err.body.current가 기존 폴더다. */
    registerFolder: (userId, folderPath) => requestJson('POST', `/users/${userId}/sync-folders`, { json: { folderPath } }),

    /** since 이후 바뀐 파일들의 현재 상태 { cursor, changes: [FileChange] } */
    changes: (userId, folderId, since) => requestJson('GET', `${folderUrl(userId, folderId)}/changes?since=${since}`),

    /**
     * 업로드. relPath는 파일명까지 포함한 상대 경로이고, 서버에는 디렉터리 부분만 relativePath로 보낸다.
     * 409면 err.body.current가 서버의 현재 FileChange(없는 파일이면 null)다.
     */
    upload(userId, folderId, { relPath, buffer, baseVersion, hash, conflictWith }) {
      const { dir, name } = splitRel(relPath);
      const form = new FormData();
      form.append('file', new Blob([buffer]), name);
      form.append('relativePath', dir);
      if (baseVersion !== undefined && baseVersion !== null) form.append('baseVersion', String(baseVersion));
      if (hash) form.append('hash', hash);
      if (conflictWith !== undefined && conflictWith !== null) form.append('conflictWith', String(conflictWith));
      return requestJson('POST', `${folderUrl(userId, folderId)}/upload`, { body: form, timeoutMs: 0 });
    },

    /** 삭제(툼스톤). baseVersion이 낡았으면 409 + current. */
    deleteFile: (userId, folderId, fileId, baseVersion) =>
      requestJson('DELETE', `${folderUrl(userId, folderId)}/files/${fileId}?baseVersion=${baseVersion}`),

    /** 버전 목록 (충돌 사본 이름에 쓸 기기 이름·저장 시각을 여기서 얻는다) */
    versions: (userId, folderId, fileId) => requestJson('GET', `${folderUrl(userId, folderId)}/files/${fileId}/versions`),

    /**
     * 최신본을 destPath에 내려받는다. 본문의 SHA-256을 직접 구해 함께 돌려준다.
     * 메타 조회와 본문 전송 사이에 새 버전이 올라올 수 있으므로 호출자가 hash와 actualHash를 비교해야 한다.
     * @returns {{ version: number, hash: string, actualHash: string, size: number }}
     */
    async download(userId, folderId, relPath, destPath) {
      const res = await request('GET', `${folderUrl(userId, folderId)}/files/download?path=${encodeURIComponent(relPath)}`);
      if (!res.ok) throw await toError(res);
      const digest = createHash('sha256');
      let size = 0;
      const meter = new Transform({
        transform(chunk, _enc, cb) {
          digest.update(chunk);
          size += chunk.length;
          cb(null, chunk);
        },
      });
      try {
        await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(destPath));
      } catch (err) {
        await fs.promises.rm(destPath, { force: true }).catch(() => {});
        if (err.code && err.code !== 'UND_ERR_SOCKET' && err.code !== 'ECONNRESET') throw err; // 디스크 오류
        throw new ApiError(0, null, `다운로드가 끊겼습니다: ${err.message}`);
      }
      return {
        version: Number(res.headers.get('x-file-version')),
        hash: res.headers.get('x-file-hash'),
        actualHash: digest.digest('hex'),
        size,
      };
    },
  };
}
