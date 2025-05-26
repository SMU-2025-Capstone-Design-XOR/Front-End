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
  // console.log(token);
  // console.log(url);
  const headers = {
    ...(options.headers || {}),
    'Authorization': `Bearer ${token}`,
  };
  const res = await fetch(url, { ...options, headers });
  // console.log(res);
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

  // console.log(safePath);
  const url = `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}/files/${safePath}`;
  // console.log(url);
  return fetchWithAuth(url, { method: 'GET' });
};

// /**
//  * 단일 파일 다운로드 (쿼리파라미터 방식)
//  */
// export const downloadFolderFile = async (syncFolderId, relativePath) => {
//   const userId = getUserIdFromToken();
//   if (!userId) throw new Error('유효한 토큰이 없습니다.');

//   // relativePath 전체를 인코딩 (슬래시 포함)
//   const encodedPath = encodeURIComponent(relativePath);

//   // URL을 쿼리파라미터 형식으로 보냄
//   const url = `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}/files?relativePath=${encodedPath}`;

//   return fetchWithAuth(url, { method: 'GET' });
// };


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
  if (!Array.isArray(list)) return [];
  // 폴더 경로를 저장할 Set (중복 제거용)
  const folderSet = new Set();
  const result = list
    .map(file => {
      const relativePath = file.relativePath || file.originalName || '';
      const segments = relativePath.split('/');
      // const versionNumber = file.versionNumber ?? file.currentVersion ?? 1;
      // const versionType   = file.versionType   ?? 'SNAPSHOT';
      // 폴더 경로 추출 (중간 경로를 모두 폴더로 인식)
      for (let i = 0; i < segments.length - 1; i++) {
        const folderPath = segments.slice(0, i + 1).join('/') + '/';
        folderSet.add(folderPath);
      }
      return {
        ...file,
        type: 'file',  // 파일은 'file'로 명시
        // versionNumber,
        // versionType,
      };
    });
  // 폴더 경로를 배열로 변환하고, 'type' 필드 추가
  const folders = Array.from(folderSet).map(folderPath => ({
    fileId: `dir__${folderPath}`,
    relativePath: folderPath,
    originalName: folderPath,
    type: 'folder',
  }));
  // 폴더와 파일 목록을 합쳐서 반환
  return [...folders, ...result];
};


/**
 * 개별 파일 메타데이터 조회
 * @param {string|number} syncFolderId  싱크 폴더 ID
 * @param {string} relativePath 파일의 상대경로 (subdir/to/file.txt)
 */
export const getFolderFileMeta = async (syncFolderId, relativePath) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');

  const safePath = relativePath
    .split('/')
    .map(encodeURIComponent)
    .join('/');

  const url = `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}` +
              `/files/${safePath}/meta`;
              
  return fetchWithAuth(url, { method: 'GET' });

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


/**
 * 특정 파일의 버전 목록 조회
 * GET /users/{userId}/sync-folders/{folderId}/files/{fileId}/versions
 *
 * @param {string|number} syncFolderId - 싱크 폴더 ID
 * @param {string|number} fileId       - 파일 고유 ID
 * @returns {Promise<Array<VersionDTO>>} - VersionDTO 배열
 */
export const getFileVersions = async (syncFolderId, fileId) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');

  const url = `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}` +
              `/files/${encodeURIComponent(fileId)}/versions`;

  // 서버에서 버전 목록과 메타데이터를 받아옵니다.
  const versions = await fetchWithAuth(url, { method: 'GET' });


  // 각 버전에 lastModified나 createdAt을 포함하도록 가공
  if (Array.isArray(versions)) {
    return versions.map(v => ({
      ...v,
      lastModified: v.lastModified || v.createdAt || null
    }));
  }

  return fetchWithAuth(url, { method: 'GET' });
};


/**
 * 특정 버전 복원 (다운로드)
 * GET /users/{userId}/sync-folders/{folderId}/files/{fileId}/{version}
 *
 * @param {string|number} syncFolderId   - 싱크 폴더 ID
 * @param {string|number} fileId         - 파일 고유 ID
 * @param {string|number} versionNumber  - 복원할 버전 번호
 * @returns {Promise<{ blob: Blob, filename: string, mimeType: string }>}
 */
export const downloadFileVersion = async (syncFolderId, fileId, versionNumber) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');

  const url = `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}` +
              `/files/${encodeURIComponent(fileId)}/${encodeURIComponent(versionNumber)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('token')}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  // 헤더에서 파일명 추출
  const contentDisposition = res.headers.get('content-disposition') || '';
  const filenameMatch = contentDisposition.match(/filename\*?=.*(?:''|")?(.+?)(?:;|$)/i);
  const filename = filenameMatch
    ? decodeURIComponent(filenameMatch[1])
    : `version-${versionNumber}`;

  const mimeType = res.headers.get('content-type') || 'application/octet-stream';
  const blob = await res.blob();

  return { blob, filename, mimeType };
};
