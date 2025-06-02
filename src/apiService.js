// src/apiService.js
import { Buffer } from 'buffer';      // Node buffer → 브라우저 Blob 변환에 필요
import path from 'path';
import mime from 'mime-types';

/**
 * JWT 토큰에서 userId(sub)를 추출하는 헬퍼 함수
 * @returns {string|null} userId 또는 토큰이 없으면 null
 */
export const getUserIdFromToken = () => {
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
 * ───────────────────────────────────────────────────────────
 * S3 Presigned Download URL 발급
 *
 * GET /s3/presigned-download?key={S3_KEY}&expire={expireMinutes}
 *
 * @param {string} key    - S3에 저장된 파일의 전체 경로 (예:
 *                         "users/123/sync-folder/456/folder1/report.docx/latest/report.docx")
 * @param {number} expire - Presigned URL 유효 시간(분). 생략 시 백엔드 기본(15분) 사용
 * @returns {Promise<string>} - S3 Presigned URL (문자열)
 *
 */
export const getPresignedDownloadUrl = async (key, expire = 15) => {
  if (!key) {
    throw new Error('Presigned URL을 요청하려면 key가 필요합니다.');
  }

  // URL-safe 인코딩 처리
  const encodedKey = key
    .split('/')
    .map(encodeURIComponent)
    .join('/');

  // 쿼리 파라미터 구성
  const queryParams = [`key=${encodedKey}`];
  if (typeof expire === 'number' && expire > 0) {
    queryParams.push(`expire=${encodeURIComponent(expire)}`);
  }
  const queryString = queryParams.join('&');

  // Blob -> text 변환
  const blob = await fetchWithAuth(
    `${API_BASE}/s3/presigned-download?${queryString}`,
    { method: 'GET' }
  );

  return await blob.text();
};



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

  //로컬 파일 읽기
  const fs = window.require('fs');
  const fileBuffer = fs.readFileSync(localFilePath);
  const fileName   = path.basename(localFilePath);
  const mimeType   = mime.lookup(localFilePath) || 'application/octet-stream';

  // 상대경로 중 “파일명”을 제외한 디렉터리 경로만 전달
  let folderParam = path.dirname(relativePath).replace(/\\/g, '/');
  if (folderParam === '.' || folderParam === '/') folderParam = '';

  // Buffer → Blob 변환
  const blob = new Blob([fileBuffer], { type: mimeType });
  // FormData 준비
  const formData = new FormData();
  formData.append('file', blob, fileName);
  // 항상 relativePath 키를 넘깁니다 (빈 문자열이어도)
  formData.append('relativePath', folderParam);  

  // fetch
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
 * GET /users/{userId}/sync-folders/{folderId}/files/download?path=폴더/서브폴더/파일명
 */
export const downloadFolderFile = async (syncFolderId, relativePath) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');

  // 경로 전체(URL 인코딩)
  const encoded = relativePath
    .split('/')
    .map(encodeURIComponent)
    .join('/');

  const url = `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}` +
              `/files/download?path=${encoded}`;
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
 * GET /users/{userId}/sync-folders/{folderId}/files?path=폴더/서브폴더
 */
export const getFolderFileList = async (syncFolderId, folderPath = '') => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');

  // 빈 문자열이면 path 파라미터 생략
  const query = folderPath
    ? `?path=${folderPath.split('/').map(encodeURIComponent).join('/')}`
    : '';

  const list = await fetchWithAuth(
    `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}/files${query}`,
    { method: 'GET' }
  );
  if (!Array.isArray(list)) return [];

  // 기존 폴더+파일 병합 로직 그대로
  const folderSet = new Set();
  const result = list.map(file => {
    const rel = file.relativePath || file.originalName || '';
    const segs = rel.split('/');
    for (let i = 0; i < segs.length - 1; i++) {
      folderSet.add(segs.slice(0, i + 1).join('/') + '/');
    }
    return { ...file, type: 'file' };
  });
  const folders = Array.from(folderSet).map(p => ({
    fileId: `dir__${p}`,
    relativePath: p,
    originalName: p,
    type: 'folder',
  }));
  return [...folders, ...result];
};

/**
 * 개별 파일 메타데이터 조회
 * GET /users/{userId}/sync-folders/{folderId}/files/meta?path=폴더/서브폴더/파일명
 */
export const getFolderFileMeta = async (syncFolderId, relativePath) => {
  const userId = getUserIdFromToken();
  if (!userId) throw new Error('유효한 토큰이 없습니다.');

  const encoded = relativePath
    .split('/')
    .map(encodeURIComponent)
    .join('/');

  const url = `${API_BASE}/users/${userId}/sync-folders/${syncFolderId}` +
              `/files/meta?path=${encoded}`;
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
