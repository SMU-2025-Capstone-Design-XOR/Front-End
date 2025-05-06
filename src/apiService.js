// src/apiService.js
import { Buffer } from 'buffer';      // Node buffer → 브라우저 Blob 변환에 필요
import path from 'path';
import mime from 'mime-types';

/**
 * JWT 토큰에서 userId(sub)를 추출하는 헬퍼 함수
 * @returns {string|null} userId 또는 토큰이 없으면 null
 */
const getUserIdFromToken = () => {
  const token = localStorage.getItem('token');
  if (!token) return null;
  try {
    const payloadPart = token.split('.')[1];
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(window.atob(base64));
    return decoded.sub;
  } catch (e) {
    console.error('토큰 디코딩 오류:', e);
    return null;
  }
};

/**
 * 공통 Fetch 래퍼 (JSON, Blob 처리)
 * @param {string} url
 * @param {object} options fetch 옵션
 * @returns {Promise<any>}
 */
const fetchWithAuth = async (url, options = {}) => {
  const token = localStorage.getItem('token');
  const headers = {
    ...(options.headers || {}),
    'Authorization': `Bearer ${token}`,
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    console.error(`API Error ${res.status} response:`, text);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.blob();
};

// API 서버 기본 URL
const API_BASE = 'http://15.164.33.175:8080';

/**** API 함수들 ****/

/**
 * 싱크 폴더 등록
 */
export const sendSyncFolder = async (folderPath) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');
  return fetchWithAuth(
    `${API_BASE}/users/${userId}/sync-folders`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath }),
    }
  );
};

/**
 * 등록된 싱크 폴더 목록 조회
 */
export const getSyncFolder = async () => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');
  return fetchWithAuth(
    `${API_BASE}/users/${userId}/sync-folders`,
    { method: 'GET' }
  );
};


/**
 * 단일 파일 업로드 (multipart/form-data)
 * POST /users/{userId}/sync-folders/{folderId}/upload
 */
export const uploadFile = async (syncFolderId, localFilePath, relativePath) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');

  // 1) 로컬 파일 읽기
  const fileBuffer = window.require('fs').readFileSync(localFilePath);
  const fileName   = path.basename(localFilePath);
  const mimeType   = mime.lookup(localFilePath) || 'application/octet-stream';

  // 2) Buffer → Blob 변환
  const blob = new Blob([fileBuffer], { type: mimeType });

  // 3) FormData 준비
  const formData = new FormData();
  formData.append('file', blob, fileName);
  formData.append('relativePath', relativePath);

  // 4) fetch
  return fetchWithAuth(
    `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}/upload`,
    {
      method: 'POST',
      // FormData 쓰면 Content-Type 헤더를 직접 설정하지 마세요
      body: formData,
    }
  );
};


/**
 * 단일 파일 다운로드
 */
export const downloadFolderFile = async (syncFolderId, relativePath) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');

  // "/" 단위로 URI 인코딩
  const safePath = relativePath
    .split('/')
    .map(encodeURIComponent)
    .join('/');

  const url = `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}/files/${safePath}`;
  return fetchWithAuth(url, { method: 'GET' });
};


/**
 * 싱크 폴더 삭제
 */
export const deleteSyncFolder = async (folderId) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');
  return fetchWithAuth(
    `${API_BASE}/users/${userId}/sync-folders/${folderId}`,
    { method: 'DELETE' }
  );
};



/**
 * 초기 동기화: 전체 파일 메타데이터 전송
 * POST /users/{userId}/sync-folders/{folderId}/sync
 */
export const syncFolder = async (syncFolderId, clientFiles = [], deletedFileIds = []) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');
  return fetchWithAuth(
    `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}/sync`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientFiles, deletedFileIds }),
    }
  );
};


/**
 * 폴더 내 파일 목록 조회
 * GET /users/{userId}/sync-folders/{folderId}/files
 */
export const getFolderFileList = async (syncFolderId) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');

  const list = await fetchWithAuth(
    `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}/files`,
    { method: 'GET' }
  );

  // ── 필터: 빈 string 이거나 "/" 로만 끝나는 항목은 폴더 마커이므로 제거 ──
  return Array.isArray(list)
    ? list.filter(f => {
        const p = f.relativePath || f.originalName || '';
        return p !== '' && !p.endsWith('/');
      })
    : [];
};


/**
 * 개별 파일 메타데이터 조회
 * (서버가 /files/{fileName}/meta 를 지원하지 않으므로,
 *  파일 목록에서 찾아서 리턴합니다.)
 *
 * @param {string|number} syncFolderId
 * @param {string} fileName  상대경로 또는 originalName
 */
export const getFolderFileMeta = async (syncFolderId, fileName) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');

  // 1) 전체 리스트 조회
  const list = await getFolderFileList(syncFolderId);

  // 2) 원하는 파일 찾기
  const meta = list.find(f =>
    (f.relativePath === fileName) ||
    (f.originalName === fileName)
  );
  if (!meta) {
    throw new Error(`파일 메타를 찾을 수 없습니다: ${fileName}`);
  }

  // 3) 그대로 반환
  // return meta;
  return { ...meta, id: meta.id ?? meta.fileId};
};


/**
 * 폴더 내 개별 파일 삭제
 * DELETE /users/{userId}/sync-folders/{folderId}/files/{fileId}
 *
 * @param {string|number} syncFolderId 싱크 폴더 ID
 * @param {string|number} fileId        삭제할 파일의 ID
 * @returns {Promise<any>}
 */
export const deleteFolderFile = async (syncFolderId, fileId) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');

  const encodedFileId = encodeURIComponent(fileId);
  const url = `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}/files/${encodedFileId}`;

  return fetchWithAuth(url, { method: 'DELETE' });
};
