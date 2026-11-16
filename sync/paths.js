// sync/paths.js
// 경로·이름에 관한 순수 함수 모음 (디스크·네트워크를 쓰지 않는다)

/**
 * 상대 경로를 서버와 같은 형태로 맞춘다: 구분자 `/`, 유니코드 NFC, 앞뒤 `/` 제거.
 * macOS는 한글 파일명을 NFD로 돌려주므로 정규화하지 않으면 Windows와 경로가 달라진다.
 */
export function normalizeRel(p) {
  return String(p ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.')
    .join('/')
    .normalize('NFC');
}

/** 상대 경로를 디렉터리 부분과 파일명으로 나눈다. 루트의 파일은 dir가 빈 문자열이다. */
export function splitRel(rel) {
  const i = rel.lastIndexOf('/');
  return i < 0 ? { dir: '', name: rel } : { dir: rel.slice(0, i), name: rel.slice(i + 1) };
}

/**
 * 동기화에서 제외할 경로인지 판정한다.
 * 점으로 시작하는 이름(.xor-tmp-* 포함), ~$*(Office 잠금 파일), *.tmp, Thumbs.db, desktop.ini.
 * 경로의 어느 조각이든 해당하면 제외한다.
 */
export function isIgnored(rel) {
  const segs = normalizeRel(rel).split('/');
  if (segs.length === 1 && segs[0] === '') return false; // 폴더 루트 자신
  return segs.some((seg) => {
    const lower = seg.toLowerCase();
    return (
      seg.startsWith('.') ||
      seg.startsWith('~$') ||
      lower.endsWith('.tmp') ||
      lower === 'thumbs.db' ||
      lower === 'desktop.ini'
    );
  });
}

/** 파일명에 쓸 수 없는 문자를 `_`로 바꾼다 (Windows 기준). */
function safeNamePart(s) {
  return String(s)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
}

/**
 * 서버 저장 시각(시간대 없는 LocalDateTime 문자열)을 파일명용 `YYYYMMDD-HHMMSS`로 바꾼다.
 * 시간대 변환은 하지 않고 글자만 옮긴다.
 */
export function timestampForName(createdDate) {
  if (Array.isArray(createdDate)) {
    const [y, mo = 1, d = 1, h = 0, mi = 0, s = 0] = createdDate;
    const p = (n) => String(n).padStart(2, '0');
    return `${y}${p(mo)}${p(d)}-${p(h)}${p(mi)}${p(s)}`;
  }
  const m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(createdDate ?? ''));
  if (!m) return 'unknown';
  return `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6] ?? '00'}`;
}

/**
 * 충돌 사본의 상대 경로: `파일명_기기이름_서버저장시각.확장자` (같은 디렉터리).
 * 이름이 서버 버전(vN)의 기기 이름과 저장 시각만으로 정해지므로 재시도해도 같은 이름이 나온다.
 */
export function conflictCopyName(rel, deviceName, createdDate) {
  const { dir, name } = splitRel(normalizeRel(rel));
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const device = safeNamePart(deviceName || '') || '다른기기';
  const copy = `${stem}_${device}_${timestampForName(createdDate)}${ext}`.normalize('NFC');
  return dir ? `${dir}/${copy}` : copy;
}
