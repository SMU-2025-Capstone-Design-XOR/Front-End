// src/pages/Home.jsx
import React, { useState, useEffect } from 'react';
import '../auth.css';
import { sendSyncFolder, backupFile } from '../apiService';

// nodeIntegration 활성화되어 있으므로, window.require 사용
const chokidar = window.require('chokidar');
const fs = window.require('fs');

const Home = () => {
  const [folderPath, setFolderPath] = useState('');
  const [fileStatuses, setFileStatuses] = useState([]);
  const [authStatus, setAuthStatus] = useState(''); // 인증 상태를 표시하기 위한 상태

  const { ipcRenderer } = window.require('electron');

  // 보호된 API 호출을 통해 JWT 토큰이 유효한지 확인하는 함수
  const checkAuth = async () => {
    const token = localStorage.getItem('token');
    try {
      const response = await fetch('http://localhost:8080/auth/protected', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error('인증 실패');
      }
      const data = await response.json();
      console.log('보호된 API 응답:', data);
      setAuthStatus('인증 성공');
    } catch (error) {
      console.error('보호된 API 호출 에러:', error);
      setAuthStatus('인증 실패');
      // 필요하면 인증 실패 시 로그인 화면으로 리다이렉트 처리
    }
  };

  // 폴더 선택 함수
  const handleSelectFolder = async () => {
    const selectedFolder = await ipcRenderer.invoke('open-folder-dialog');
    if (selectedFolder) {
      setFolderPath(selectedFolder);
      console.log('선택된 폴더:', selectedFolder);
      try {
        const result = await sendSyncFolder(selectedFolder);
        console.log('폴더 전송 성공:', result);
      } catch (error) {
        console.error('폴더 전송 에러:', error);
      }
    }
  };

  // 파일별 상태 업데이트 함수 (배열로 관리)
  const updateFileStatus = (filePath, status) => {
    setFileStatuses(prevStatuses => {
      const idx = prevStatuses.findIndex(item => item.filePath === filePath);
      if (idx !== -1) {
        const newStatuses = [...prevStatuses];
        newStatuses[idx] = { filePath, status };
        return newStatuses;
      } else {
        return [...prevStatuses, { filePath, status }];
      }
    });
  };

  // folderPath가 설정되면, 해당 폴더 내의 .txt 파일을 감시
  useEffect(() => {
    if (folderPath) {
      const watcher = chokidar.watch(`${folderPath}/**/*.txt`, {
        persistent: true,
        ignoreInitial: true
      });
      
      watcher.on('change', async (filePath) => {
        console.log(`변경 감지: ${filePath}`);
        updateFileStatus(filePath, '백업 중...');
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const result = await backupFile({ filePath, content });
          console.log('백업 성공:', result);
          updateFileStatus(filePath, '백업 성공');
        } catch (error) {
          console.error('백업 에러:', error);
          updateFileStatus(filePath, '백업 실패');
        }
      });
      
      return () => watcher.close();
    }
  }, [folderPath]);

  // 앱 시작 시, 보호된 API를 호출하여 인증 상태 확인
  useEffect(() => {
    checkAuth();
  }, []);

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>홈 화면</h1>
        <p>로그인 후 표시될 홈 화면입니다.</p>
        {authStatus && <p>인증 상태: {authStatus}</p>}
        <button onClick={handleSelectFolder}>파일 선택</button>
        {folderPath && <p>선택된 폴더: {folderPath}</p>}
        {fileStatuses.length > 0 && (
          <div>
            <h2>파일 백업 상태</h2>
            <ul>
              {fileStatuses.map((item) => (
                <li key={item.filePath}>
                  <strong>{item.filePath}</strong>: {item.status}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default Home;


// import React, { useState, useEffect } from 'react';
// import '../styles.css';
// import { sendSyncFolder, backupFile } from '../apiService';

// // nodeIntegration 활성화되어 있으므로, window.require 사용
// const chokidar = window.require('chokidar');
// const fs = window.require('fs');

// const Home = () => {
//   const [folderPath, setFolderPath] = useState('');
//   const [backupStatus, setBackupStatus] = useState('');
  
//   // Electron IPC를 통해 폴더 선택 다이얼로그 호출
//   const { ipcRenderer } = window.require('electron');

//   const handleSelectFolder = async () => {
//     const selectedFolder = await ipcRenderer.invoke('open-folder-dialog');
//     if (selectedFolder) {
//       setFolderPath(selectedFolder);
//       console.log('선택된 폴더:', selectedFolder);
//       // 선택된 폴더 정보를 백엔드에 전송 (싱크 폴더 지정)
//       try {
//         const result = await sendSyncFolder(selectedFolder);
//         console.log('폴더 전송 성공:', result);
//       } catch (error) {
//         console.error('폴더 전송 에러:', error);
//       }
//     }
//   };

//   // 폴더 경로가 설정되면, 해당 폴더 내 .txt 파일을 감시하는 watcher 설정
//   useEffect(() => {
//     if (folderPath) {
//       const watcher = chokidar.watch(`${folderPath}/**/*.txt`, {
//         persistent: true,
//         ignoreInitial: true
//       });
      
//       watcher.on('change', async (filePath) => {
//         console.log(`변경 감지: ${filePath}`);
//         setBackupStatus(`백업 중: ${filePath}`);
//         try {
//           // 파일 내용을 읽음 (UTF-8 인코딩)
//           const content = fs.readFileSync(filePath, 'utf8');
//           // 백업 API 호출: 파일 경로와 내용을 백엔드에 전송 (S3 연동)
//           const result = await backupFile({ filePath, content });
//           console.log('백업 성공:', result);
//           setBackupStatus(`백업 성공: ${filePath}`);
//         } catch (error) {
//           console.error('백업 에러:', error);
//           setBackupStatus(`백업 실패: ${filePath}`);
//         }
//       });
      
//       return () => watcher.close();
//     }
//   }, [folderPath]);

//   return (
//     <div className="auth-container">
//       <div className="auth-box">
//         <h1>홈 화면</h1>
//         <p>로그인 후 표시될 홈 화면입니다.</p>
//         <button onClick={handleSelectFolder}>파일 선택</button>
//         {folderPath && <p>선택된 폴더: {folderPath}</p>}
//         {backupStatus && <p>{backupStatus}</p>}
//       </div>
//     </div>
//   );
// };

// export default Home;



// // 해당 코드는 파일별 백업 상태를 배열로 관리하고 UI에 목록으로 표시하는 방식
// // 사용자가 선택한 폴더 내의 .txt 파일 변경 사항을 감지하고, 각 파일의 백업 상태를 업데이트하여 화면에 표시
// // 다만, 실제 API URL과 백엔드와의 통신 부분(예: sendSyncFolder, backupFile 함수의 엔드포인트)을 실제 환경에 맞게 설정해야 함.


// // 예시: 파일별 백업 상태를 배열로 관리하는 방법
// import React, { useState, useEffect } from 'react';
// import '../styles.css';
// import { sendSyncFolder, backupFile } from '../apiService';

// const chokidar = window.require('chokidar');
// const fs = window.require('fs');

// const Home = () => {
//   const [folderPath, setFolderPath] = useState('');
//   const [fileStatuses, setFileStatuses] = useState([]); // 배열 형태로 변경

//   const { ipcRenderer } = window.require('electron');

//   const handleSelectFolder = async () => {
//     const selectedFolder = await ipcRenderer.invoke('open-folder-dialog');
//     if (selectedFolder) {
//       setFolderPath(selectedFolder);
//       console.log('선택된 폴더:', selectedFolder);
//       try {
//         const result = await sendSyncFolder(selectedFolder);
//         console.log('폴더 전송 성공:', result);
//       } catch (error) {
//         console.error('폴더 전송 에러:', error);
//       }
//     }
//   };

//   // 특정 파일의 상태를 업데이트하는 함수
//   const updateFileStatus = (filePath, status) => {
//     setFileStatuses(prevStatuses => {
//       const idx = prevStatuses.findIndex(item => item.filePath === filePath);
//       if (idx !== -1) {
//         const newStatuses = [...prevStatuses];
//         newStatuses[idx] = { filePath, status };
//         return newStatuses;
//       } else {
//         return [...prevStatuses, { filePath, status }];
//       }
//     });
//   };

//   useEffect(() => {
//     if (folderPath) {
//       const watcher = chokidar.watch(`${folderPath}/**/*.txt`, {
//         persistent: true,
//         ignoreInitial: true
//       });
      
//       watcher.on('change', async (filePath) => {
//         console.log(`변경 감지: ${filePath}`);
//         updateFileStatus(filePath, '백업 중...');
//         try {
//           const content = fs.readFileSync(filePath, 'utf8');
//           const result = await backupFile({ filePath, content });
//           console.log('백업 성공:', result);
//           updateFileStatus(filePath, '백업 성공');
//         } catch (error) {
//           console.error('백업 에러:', error);
//           updateFileStatus(filePath, '백업 실패');
//         }
//       });
      
//       return () => watcher.close();
//     }
//   }, [folderPath]);

//   return (
//     <div className="auth-container">
//       <div className="auth-box">
//         <h1>홈 화면</h1>
//         <p>로그인 후 표시될 홈 화면입니다.</p>
//         <button onClick={handleSelectFolder}>파일 선택</button>
//         {folderPath && <p>선택된 폴더: {folderPath}</p>}
//         {fileStatuses.length > 0 && (
//           <div>
//             <h2>파일 백업 상태</h2>
//             <ul>
//               {fileStatuses.map((item) => (
//                 <li key={item.filePath}>
//                   <strong>{item.filePath}</strong>: {item.status}
//                 </li>
//               ))}
//             </ul>
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };

// export default Home;
