// src/format.js
// 화면에 보여 줄 크기·시각 문자열 (전부 한국어)

/** 바이트 → "1KB", "90KB", "2.2MB" */
export function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n === 0) return '0KB';
  const MB = 1024 * 1024;
  if (n < MB) return `${Math.max(1, Math.round(n / 1024))}KB`;
  if (n < 1024 * MB) return `${(n / MB).toFixed(1)}MB`;
  return `${(n / (1024 * MB)).toFixed(1)}GB`;
}

function clock(d) {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${m}`;
}

function dayStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "오늘 오전 5:58", "어제 오후 9:41", "11월 11일 오후 4:20", 해가 다르면 "2025년 11월 11일 오후 4:20" */
export function formatWhen(value, now = new Date()) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((dayStart(now) - dayStart(d)) / 86400000);
  if (days === 0) return `오늘 ${clock(d)}`;
  if (days === 1) return `어제 ${clock(d)}`;
  const date = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return d.getFullYear() === now.getFullYear() ? `${date} ${clock(d)}` : `${d.getFullYear()}년 ${date} ${clock(d)}`;
}

/** "2026년 11월 13일 오전 5:58" */
export function formatFull(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${clock(d)}`;
}

/** 지난 시간: "방금", "40초 전", "3분 전", 그보다 오래면 시각 */
export function formatAgo(ms, now = Date.now()) {
  if (!ms) return '아직 없음';
  const sec = Math.max(0, Math.round((now - ms) / 1000));
  if (sec < 20) return '방금';
  if (sec < 60) return `${sec}초 전`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  return formatWhen(ms);
}

/** 확인 주기: 15000 → "15초마다", 120000 → "2분마다" */
export function formatInterval(ms) {
  const sec = Math.round(Number(ms) / 1000);
  if (!Number.isFinite(sec) || sec <= 0) return '';
  return sec % 60 === 0 ? `${sec / 60}분마다` : `${sec}초마다`;
}

/** 받침에 따라 조사를 고른다: josa('초안.txt', '을', '를') */
export function josa(word, withFinal, withoutFinal) {
  const last = (word || '').slice(-1);
  // 한글로 끝나지 않으면(.txt 같은 확장자) 받침 없는 쪽을 쓴다
  if (!/[가-힣]/.test(last)) return withoutFinal;
  return (last.charCodeAt(0) - 0xac00) % 28 === 0 ? withoutFinal : withFinal;
}

/**
 * 충돌 사본 이름(`이름_기기이름_YYYYMMDD-HHMMSS.확장자`, sync/paths.js의 conflictCopyName)을 풀어 본다.
 * 원래 파일이 무엇인지는 이름만으로 정할 수 없으므로(이름에 _가 들어갈 수 있다) 후보를 모두 돌려준다.
 * @returns {{ stamp: string, candidates: Array<{ original: string, device: string }> } | null}
 */
export function parseConflictCopy(fileName) {
  const m = /^(.+)_(\d{8}-\d{6})(\.[^.]*)?$/.exec(fileName || '');
  if (!m) return null;
  const [, head, stamp, ext = ''] = m;
  const candidates = [];
  for (let i = head.indexOf('_'); i > 0; i = head.indexOf('_', i + 1)) {
    const device = head.slice(i + 1);
    if (device) candidates.push({ original: head.slice(0, i) + ext, device });
  }
  return candidates.length ? { stamp, candidates } : null;
}
