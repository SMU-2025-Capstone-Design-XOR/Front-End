// sync/config.js
// 실행 설정: 환경변수 > {userData}/config.json > 기본값
//   apiBase         서버 주소 (XOR_API_BASE, 기본 http://localhost:8080)
//   pollIntervalMs  폴링 주기 (XOR_POLL_MS, 기본 15000) — 5장 실험 변수
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = { apiBase: 'http://localhost:8080', pollIntervalMs: 15000 };

export function loadConfig(userDataDir, env = process.env) {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(userDataDir, 'config.json'), 'utf8')) || {};
  } catch { /* 설정 파일이 없거나 깨졌으면 기본값 */ }
  const apiBase = String(env.XOR_API_BASE || file.apiBase || DEFAULT_CONFIG.apiBase).replace(/\/+$/, '');
  const poll = Number(env.XOR_POLL_MS || file.pollIntervalMs);
  return {
    apiBase,
    pollIntervalMs: Number.isFinite(poll) && poll >= 1000 ? poll : DEFAULT_CONFIG.pollIntervalMs,
  };
}
