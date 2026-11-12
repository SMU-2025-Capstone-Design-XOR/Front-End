// sync/scanner.js
// 폴더 순회와 스트림 SHA-256
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeRel, isIgnored } from './paths.js';

/** 파일을 스트림으로 읽어 SHA-256(16진수)을 구한다. 큰 파일도 메모리에 다 올리지 않는다. */
export function hashFile(abs) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(abs);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function hashBuffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** 일반 파일이면 { size, mtimeMs }, 없거나 파일이 아니면 null. */
export async function statFile(abs) {
  try {
    const st = await fs.promises.stat(abs);
    return st.isFile() ? { size: st.size, mtimeMs: st.mtimeMs } : null;
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
    throw err;
  }
}

/**
 * 폴더를 훑어 Map(상대 경로 → { size, mtimeMs })을 돌려준다.
 * 상대 경로는 `/` 구분·NFC. 무시 목록과 심볼릭 링크는 건너뛴다. 해시는 여기서 구하지 않는다.
 */
export async function scanFolder(root) {
  const result = new Map();
  async function walk(dirAbs, dirRel) {
    let entries;
    try {
      entries = await fs.promises.readdir(dirAbs, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return; // 훑는 도중 지워진 디렉터리
      throw err;
    }
    for (const entry of entries) {
      const rel = normalizeRel(dirRel ? `${dirRel}/${entry.name}` : entry.name);
      if (isIgnored(rel)) continue;
      const abs = path.join(dirAbs, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile()) {
        const st = await statFile(abs);
        if (st) result.set(rel, st);
      }
    }
  }
  await walk(root, '');
  return result;
}
