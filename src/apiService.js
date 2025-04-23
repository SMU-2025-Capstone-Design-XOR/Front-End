// src/apiService.js

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
 * 단일 파일 업로드
 */
export const uploadFile = async (syncFolderId, filePath) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');
  return fetchWithAuth(
    `${API_BASE}/users/${userId}/folders/${syncFolderId}/upload`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, message: '파일 업로드 성공' }),
    }
  );
};

/**
 * 단일 파일 다운로드
 */
export const downloadFolderFile = async (syncFolderId, fileName) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');
  const url = new URL(
    `${API_BASE}/users/${userId}/folders/${syncFolderId}/files/${encodeURIComponent(fileName)}`
  ).toString();
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
 * 초기 스캔: 전체 파일 메타데이터 전송
 */
export const scanFolderFiles = async (syncFolderId, filesMeta) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');
  return fetchWithAuth(
    `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}/files/scan`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: filesMeta }),
    }
  );
};

/**
 * 폴더 내 파일 목록 조회
 */
export const getFolderFileList = async (syncFolderId) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');
  return fetchWithAuth(
    `${API_BASE}/users/${userId}/folders/${syncFolderId}/files`,
    { method: 'GET' }
  );
};

/**
 * 개별 파일 메타데이터 조회
 */
export const getFolderFileMeta = async (syncFolderId, fileName) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');
  return fetchWithAuth(
    `${API_BASE}/users/${userId}/folders/${syncFolderId}/files/${encodeURIComponent(fileName)}/meta`,
    { method: 'GET' }
  );
};

// === 동기화 구현을 위한 추가 API 함수들 ===

/**
 * 전체 파일 메타데이터 일괄 조회 (bulk)
 * @param {string|number} syncFolderId
 * @returns {Promise<{fileName:string, modifiedTime:number, size:number}[]>}
 */
export const getAllFilesMeta = async (syncFolderId) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');
  return fetchWithAuth(
    `${API_BASE}/users/${userId}/folders/${syncFolderId}/files/meta`,
    { method: 'GET' }
  );
};

/**
 * 변경된 파일 메타데이터 전송 (증분 스캔)
 * @param {string|number} syncFolderId
 * @param {{fileName:string, modifiedTime:number, size:number}[]} changedFiles
 * @returns {Promise<any>}
 */
export const scanFolderChanges = async (syncFolderId, changedFiles) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');
  return fetchWithAuth(
    `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}/files/changes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: changedFiles }),
    }
  );
};
