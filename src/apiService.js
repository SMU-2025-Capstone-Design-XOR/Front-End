// src/apiService.js

// 폴더 정보를 서버에 전송하는 함수
export const sendSyncFolder = async (folderPath) => {
  const token = localStorage.getItem('token');
  
  // 토큰을 '.'으로 분리하여 두 번째 부분(페이로드)을 디코딩
  const payloadPart = token.split('.')[1];
  // Base64Url 디코딩: 먼저 Base64Url 형식을 일반 Base64 형식으로 변환해 주어야 함
  const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
  const decodedPayload = JSON.parse(window.atob(base64));
  const userId = decodedPayload.sub; // 여기서 "sub"가 userId임
  
  // 실제 API 엔드포인트에 userId 값을 삽입
  const response = await fetch(`http://15.164.33.175:8080/users/${userId}/sync-folders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ folderPath })
  });
  
  // 응답 바디를 한 번만 읽는다.
  const responseText = await response.text();
  let responseData;
  try {
    responseData = JSON.parse(responseText);
  } catch (e) {
    // JSON 파싱에 실패하면, 원문 텍스트를 에러 메시지에 포함시킴
    throw new Error(`폴더 전송 실패, 응답 파싱 에러: ${responseText}`);
  }

  if (!response.ok) {
    throw new Error(`폴더 전송 실패, 서버 응답: ${responseText}`);
  }
  return responseData;
  // if (!response.ok) {
  //   throw new Error('폴더 전송 실패');
  // }
  // return response.json();
};

// GET 방식: 서버에 저장된 폴더 정보를 받아오는 함수
export const getSyncFolder = async () => {
  const token = localStorage.getItem('token');
  
  // JWT 디코딩으로 userId 추출 (sendSyncFolder와 동일)
  const payloadPart = token.split('.')[1];
  const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
  const decodedPayload = JSON.parse(window.atob(base64));
  const userId = decodedPayload.sub;
  
  const response = await fetch(`http://15.164.33.175:8080/users/${userId}/sync-folders`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  if (!response.ok) {
    throw new Error('폴더 정보 불러오기 실패');
  }
  return response.json();
};

// 파일 백업 API 호출 함수 (단일 버전, 덮어쓰기)이
export const backupFile = async (backupData) => {
  const token = localStorage.getItem('token');
  const response = await fetch('http://15.164.33.175:8080/users/{{userId}}/folders/{{syncFolderId}}/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(backupData)
  });
  if (!response.ok) {
    throw new Error('백업 실패');
  }
  return response.json();
};


// 싱크 폴더에 파일 업로드 API
/**
 * 파일 업로드 호출
 * @param {number|string} syncFolderId   서버에 저장된 싱크 폴더의 ID
 * @param {string} filePath             로컬 절대 경로 또는 서버 상대 경로
 * @returns {Promise<object>}           서버 응답 JSON ({ filePath, message })
 */
export const uploadFile = async (syncFolderId, filePath) => {
  const token = localStorage.getItem('token');
  const payloadPart = token.split('.')[1];
  const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
  const { sub: userId } = JSON.parse(window.atob(base64));

  const response = await fetch(
    `http://15.164.33.175:8080/users/${userId}/folders/${syncFolderId}/upload`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ filePath, message: '파일 업로드 성공' })
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`파일 업로드 실패 (HTTP ${response.status}): ${text}`);
  }
  return response.json();
};

// 싱크 폴더 내 파일 다운로드 API
/**
 * 서버에 저장된 파일 다운로드
 * @param {number|string} syncFolderId   서버에 저장된 싱크 폴더의 ID
 * @param {string} fileName             다운로드할 파일 이름 (또는 경로)
 * @returns {Promise<Blob>}             파일 Blob
 */
export const downloadFolderFile = async (syncFolderId, fileName) => {
  const token = localStorage.getItem('token');
  const payloadPart = token.split('.')[1];
  const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
  const { sub: userId } = JSON.parse(window.atob(base64));

  const url = new URL(
    `http://15.164.33.175:8080/users/${userId}/folders/${syncFolderId}/files/${encodeURIComponent(fileName)}`
  );

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`파일 다운로드 실패 (HTTP ${response.status}): ${text}`);
  }
  return response.blob();
};

/**
 * 서버에 저장된 싱크 폴더 삭제
*/

export const deleteSyncFolder = async (folderId) => {
  const token = localStorage.getItem('token');
  // JWT에서 userId 추출 (sendSyncFolder/getSyncFolder와 동일)
  const payloadPart = token.split('.')[1];
  const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
  const { sub: userId } = JSON.parse(window.atob(base64));

  const response = await fetch(
    `http://15.164.33.175:8080/users/${userId}/sync-folders/${folderId}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`폴더 삭제 실패 (HTTP ${response.status}): ${text}`);
  }
};

/**
 * 초기 스캔: 폴더 내 파일 리스트와 메타데이터를 서버에 전달
 * @param {number|string} syncFolderId
 * @param {{fileName:string,modifiedTime:number,size:number}[]} filesMeta
 */
export const scanFolderFiles = async (syncFolderId, filesMeta) => {
  const token = localStorage.getItem('token');
  const payload = JSON.parse(window.atob(token.split('.')[1]
    .replace(/-/g,'+').replace(/_/g,'/')));
  const userId = payload.sub;

  const res = await fetch(
    `http://15.164.33.175:8080/users/${userId}/sync-folders/${syncFolderId}/files/scan`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ files: filesMeta })
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`스캔 전송 실패 (${res.status}): ${text}`);
  }
  return res.json();
};


/**
 *  서버에 저장된 싱크 폴더 안의 파일 목록 조회
 */
export const getFolderFileList = async (syncFolderId) => {
  const token = localStorage.getItem('token');
  const payload = JSON.parse(window.atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  const userId = payload.sub;

  const res = await fetch(
    `http://15.164.33.175:8080/users/${userId}/folders/${syncFolderId}/files`,
    { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`파일 목록 조회 실패: ${res.status}`);
  return res.json(); // ["foo.txt","bar.txt",…]
};

/**
 *  서버에 저장된 파일의 메타데이터 조회
 *  -> { fileName, modifiedTime } 형태로 내려준다는 가정
 *  @param {number|string} syncFolderId
 *  @param {string} fileName
 *  @returns {Promise<{fileName:string, modifiedTime:number}>}
 */
export const getFolderFileMeta = async (syncFolderId, fileName) => {
  const token = localStorage.getItem('token');
  const payload = JSON.parse(window.atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  const userId = payload.sub;

  const res = await fetch(
    `http://15.164.33.175:8080/users/${userId}/folders/${syncFolderId}/files/${encodeURIComponent(fileName)}/meta`,
    { method: 'GET', headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`메타데이터 조회 실패: ${res.status}`);
  return res.json(); // { fileName, modifiedTime: 1671234567890 }
};
