// src/pages/Backup.jsx
import React from 'react';

const Backup = () => {
  const handleBackup = async () => {
    const token = localStorage.getItem('token');
    try {
      const response = await fetch('백엔드 서버 api/backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          // 여기에 백업할 파일 데이터 또는 diff 데이터를 넣습니다.
          fileData: "백업 데이터 예시"
        })
      });
      if (!response.ok) {
        throw new Error('백업 실패');
      }
      const result = await response.json();
      alert('백업 성공!');
      console.log(result);
    } catch (error) {
      console.error('백업 에러:', error);
      alert('백업 실패. 다시 시도해주세요.');
    }
  };

  return (
    <div style={{ margin: '50px', textAlign: 'center' }}>
      <h1>백업 기능 테스트</h1>
      <button onClick={handleBackup}>파일 백업 실행</button>
    </div>
  );
};

export default Backup;


// 컴포넌트 통합:
// 위와 같이 Backup.jsx를 만든 후, App.jsx 또는 적절한 페이지에서 라우터를 통해 이 컴포넌트를 호출하여 사용할 수 있습니다.