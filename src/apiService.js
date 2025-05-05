// src/apiService.js
import { Buffer } from 'buffer';      // Node buffer → 브라우저 Blob 변환에 필요
import path from 'path';
import mime from 'mime-types';


const API_BASE = 'http://15.164.33.175:8080';
function getUserIdFromToken() {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('유효한 토큰이 없습니다.');
  const payload = JSON.parse(window.atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  return payload.sub;
}
async function fetchWithAuth(url, opts = {}) {
  const token = localStorage.getItem('token');
  const res = await fetch(url, {
    ...opts,
    headers: { 
      Authorization: `Bearer ${token}`,
      'Cache-Control': 'no-cache',
      ...(opts.headers||{}) 
    }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  const ct = res.headers.get('content-type')||'';
  return ct.includes('application/json') ? res.json() : res.blob();
}

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
  // ← 반드시 상대 경로 전체를 같이 전송
  formData.append('relativePath', relativePath);  

  // 4) fetch
  return fetchWithAuth(
    `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}/upload?relativePath=${encodeURIComponent(relativePath)}`,
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
export async function downloadFolderFile(syncFolderId, relativePath) {
  const userId = getUserIdFromToken();
  // 경로 세그먼트별로 인코딩
  const safePath = relativePath
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const url = `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}/files/${safePath}`;
  return fetchWithAuth(url, { method: 'GET' });
}

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
