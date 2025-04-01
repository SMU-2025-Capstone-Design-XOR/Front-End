// src/apiService.js

// 폴더 정보를 서버에 전송하는 함수
export const sendSyncFolder = async (folderPath) => {
    const token = localStorage.getItem('token'); // 로그인 시 저장된 JWT 토큰
    const response = await fetch('백엔드 서버 api/sync-folder', {
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
  
  // 파일 백업 API 호출 함수 (예시)
  export const backupFile = async (backupData) => {
    const token = localStorage.getItem('token');
    const response = await fetch('백엔드 서버 api/backup', {
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
  
  //   서비스 파일로 분리:
  // 만약 백업 관련 API 호출 로직이 여러 곳에서 필요하다면, 이를 별도의 서비스 파일(예: apiService.js)에 분리하여 재사용하는 방식도 좋습니다.
    