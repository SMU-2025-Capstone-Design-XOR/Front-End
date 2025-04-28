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
    // throw new Error(`HTTP ${res.status}: ${text}`);
    console.errer('API Error ${res.status} respone: ', text);
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
export const uploadFile = async (syncFolderId, localFilePath) => {
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
export const downloadFolderFile = async (syncFolderId, fileName) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');
  const url = new URL(
    `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}/files/${encodeURIComponent(fileName)}`
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
  return fetchWithAuth(
    `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}/files`,
    { method: 'GET' }
  );
};

/**
 * 개별 파일 메타데이터 조회
 * GET /users/{userId}/sync-folders/{folderId}/files/{fileName}/meta
 */
export const getFolderFileMeta = async (syncFolderId, fileName) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');
  return fetchWithAuth(
    `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}/files/${encodeURIComponent(fileName)}/meta`,
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
