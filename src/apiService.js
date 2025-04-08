// src/apiService.js

// 폴더 정보를 서버에 전송하는 함수
export const sendSyncFolder = async (folderPath) => {
    const token = localStorage.getItem('token'); // 로그인 시 저장된 JWT 토큰
    const response = await fetch('http://15.164.33.175:8080/api/sync-folder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ folderPath })
    });
    if (!response.ok) {
      throw new Error('폴더 전송 실패');
    }
    return response.json();
  };
  
  // 파일 백업 API 호출 함수 (단일 버전, 덮어쓰기)
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
  
  // 백업 파일 다운로드 (검증용) API 호출 함수 예시
  export const downloadBackupFile = async (filePath) => {
    const token = localStorage.getItem('token');
    const response = await fetch(`http://15.164.33.175:8080/api/download?filePath=${encodeURIComponent(filePath)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if (!response.ok) {
      throw new Error('다운로드 실패');
    }
    // 예시로 Blob으로 반환된 파일을 다운로드할 수 있음
    return response.blob();
  };

  //   서비스 파일로 분리:
  // 만약 백업 관련 API 호출 로직이 여러 곳에서 필요하다면, 이를 별도의 서비스 파일(예: apiService.js)에 분리하여 재사용하는 방식도 좋습니다.
    