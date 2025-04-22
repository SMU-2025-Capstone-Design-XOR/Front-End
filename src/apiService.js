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
  const response = await fetch('http://15.164.33.175:8080/api/backup', {
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


  /**
 * 범용 파일 다운로드 함수
 * @param {string} filePath - 서버 저장소 상의 파일 경로 (URL 인코딩 필요)
 * @returns {Promise<Blob>} 응답으로 받은 파일 Blob
 */
export const downloadFile = async (filePath) => {
  const token = localStorage.getItem('token');
  // JWT에서 userId 추출 (sendSyncFolder/getSyncFolder와 동일)
  const payloadPart = token.split('.')[1];
  const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
  const { sub: userId } = JSON.parse(window.atob(base64));

  // GET 요청: 파일 경로를 쿼리 파라미터로 전달
  const url = new URL(`http://15.164.33.175:8080/users/${userId}/files/download`);
  url.searchParams.set('filePath', filePath);
  // 최종 요청주소 = /users/{userId}/files/download?filePath={인코딩된경로} 형태가 된다.


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

  // Blob으로 변환하여 반환
  return response.blob();
};


/**
 * 서버에 저장된 싱크 폴더 삭제
 * @param {string} folderId
 * @returns {Promise<void>}
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