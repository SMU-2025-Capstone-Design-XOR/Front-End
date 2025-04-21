// src/pages/Home.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../css/home.css';
import '../css/all.css';
import { sendSyncFolder, backupFile, downloadFile, getSyncFolder } from '../apiService';

// nodeIntegration 활성화되어 있으므로, window.require 사용
const chokidar = window.require('chokidar');
const fs = window.require('fs');
const path = window.require('path');

const Home = () => {
  // 현재 로그인한 사용자의 이름은 "currentUser"에 저장됨. 없으면 "default" 사용.
  const currentUser = localStorage.getItem('currentUser') || 'default';
  const localKey = `syncFolder_${currentUser}`;
  
  // 초기 상태: localStorage에서 폴더 정보가 있으면 사용, 없으면 빈 문자열.
  const [folderPath, setFolderPath] = useState(localStorage.getItem(localKey) || '');
  const [fileStatuses, setFileStatuses] = useState([]);
  const navigate = useNavigate();
  const { ipcRenderer } = window.require('electron');

  // 폴더 선택 함수: 사용자가 다이얼로그를 통해 폴더 선택 시 처리
  const handleSelectFolder = async () => {
    const selectedFolder = await ipcRenderer.invoke('open-folder-dialog');
    if (selectedFolder) {
      setFolderPath(selectedFolder);
      localStorage.setItem(localKey, selectedFolder);
      console.log('새로 선택된 폴더:', selectedFolder);
      const result = await sendSyncFolder(selectedFolder);
      // try {
      //   const result = await sendSyncFolder(selectedFolder);
      //   console.log('폴더 전송 성공:', result);
      // } catch (error) {
      //   console.error('폴더 전송 에러:', error);
      // }
    }
  };

  // 로그아웃 함수: 토큰과 계정 관련 정보를 제거하고 로그인 페이지로 이동
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    // 폴더 정보 (localKey)는 유지하거나 필요에 따라 제거할 수 있음.
    navigate('/');
  };

  // 파일 상태 업데이트 함수
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

  // **초기 폴더 전체 스캔 및 메타데이터 수집**  
  // (필요에 따라 파일 메타데이터 수집 로직을 추가할 수 있음; 여기서는 스캔 예시만 보여줌)
  useEffect(() => {
    if (folderPath) {
      fs.readdir(folderPath, (err, files) => {
        if (err) {
          console.error('폴더 읽기 실패:', err);
          return;
        }
        const txtFiles = files.filter(file => file.endsWith('.txt'));
        const metadata = {};
        txtFiles.forEach(file => {
          const fileFullPath = path.join(folderPath, file);
          try {
            const stats = fs.statSync(fileFullPath);
            metadata[fileFullPath] = {
              modifiedTime: stats.mtime,
              size: stats.size,
            };
          } catch (statErr) {
            console.error('파일 상태 확인 에러:', statErr);
          }
        });
        console.log('초기 폴더 스캔 메타데이터:', metadata);
        // 추후 클라우드 메타데이터와 비교하는 작업 추가 가능
      });
    }
  }, [folderPath]);

  // **서버에서 폴더 정보를 불러오는 useEffect (최초 마운트 시)**
  useEffect(() => {
    // localStorage에 폴더 정보가 없으면, 서버에서 불러오도록 한다.
    if (!folderPath) {
      const fetchFolderFromServer = async () => {
        try {
          const data = await getSyncFolder();
          // 서버 응답이 { "folderPath": "/home/" } 형태라고 가정.
          if (data && data.folderPath) {
            setFolderPath(data.folderPath);
            localStorage.setItem(localKey, data.folderPath);
            console.log('서버에서 불러온 폴더:', data.folderPath);
          } else {
            console.log('서버에 저장된 폴더 정보가 없습니다.');
          }
        } catch (err) {
          console.error('서버 폴더 정보 불러오기 실패:', err);
        }
      };

      fetchFolderFromServer();
    }
  }, []);  // 컴포넌트 최초 마운트 시 실행

  // **파일 변경 감지 기능:** 폴더 내의 .txt 파일 변경 시 백업 API 호출
  useEffect(() => {
    if (folderPath) {
      const watcher = chokidar.watch(`${folderPath}/*.txt`, {
        persistent: true,
        ignoreInitial: true,
      });

      watcher.on('change', async (filePath) => {
        console.log(`변경 감지: ${filePath}`);
        updateFileStatus(filePath, '백업 중...');
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const backupData = { filePath, content };
          const result = await backupFile(backupData);
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

  // **백업 파일 다운로드(검증) 기능:**
  const handleDownloadBackup = async (filePath) => {
    try {
      const blob = await downloadFile(filePath);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filePath.split('/').pop();
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('다운로드 에러:', error);
      alert('다운로드 실패');
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>HOME</h1>
        <button onClick={handleLogout}>로그아웃</button>
        <button onClick={handleSelectFolder}>싱크용 폴더 선택</button>
        {folderPath && <p>선택된 폴더: {folderPath}</p>}
        {fileStatuses.length > 0 && (
          <div>
            <h2>파일 백업 상태</h2>
            <ul>
              {fileStatuses.map((item) => (
                <li key={item.filePath}>
                  <strong>{item.filePath}</strong>: {item.status}{' '}
                  <button onClick={() => handleDownloadBackup(item.filePath)}>
                    다운로드 확인
                  </button>
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


// // src/pages/Home.jsx
// import React, { useState, useEffect } from 'react';
// import { useNavigate } from 'react-router-dom';
// import '../css/home.css';
// import '../css/all.css';
// import { sendSyncFolder, backupFile, downloadBackupFile, getSyncFolder } from '../apiService';

// // nodeIntegration 활성화되어 있으므로, window.require 사용
// const chokidar = window.require('chokidar');
// const fs = window.require('fs');
// const path = window.require('path');

// const Home = () => {
//   // 현재 로그인한 사용자의 이름은 "currentUser"에 저장됨. 없으면 "default" 사용.
//   const currentUser = localStorage.getItem('currentUser') || 'default';
//   const localKey = `syncFolder_${currentUser}`;
  
//   // 초기 상태: localStorage에서 폴더 정보가 있으면 사용, 없으면 빈 문자열.
//   const [folderPath, setFolderPath] = useState(localStorage.getItem(localKey) || '');
//   const [fileStatuses, setFileStatuses] = useState([]);
//   const navigate = useNavigate();
//   const { ipcRenderer } = window.require('electron');

//   // 폴더 선택 함수: 항상 폴더 선택 다이얼로그를 호출하여 사용자가 언제든지 폴더를 변경할 수 있도록 함
//   const handleSelectFolder = async () => {
//     const selectedFolder = await ipcRenderer.invoke('open-folder-dialog');
//     if (selectedFolder) {
//       setFolderPath(selectedFolder);
//       // 계정별 키로 localStorage에 저장
//       localStorage.setItem(localKey, selectedFolder);
//       console.log('새로 선택된 폴더:', selectedFolder);
//       try {
//         const result = await sendSyncFolder(selectedFolder);
//         console.log('폴더 전송 성공:', result);
//       } catch (error) {
//         console.error('폴더 전송 에러:', error);
//       }
//     }
//   };

//   // 로그아웃 함수: JWT 토큰과 계정 관련 정보를 모두 제거하고, 로그인 페이지로 이동
//   const handleLogout = () => {
//     localStorage.removeItem('token');
//     localStorage.removeItem('currentUser');
//     navigate('/');
//   };

//   // 파일별 상태 업데이트 함수 (배열로 관리)
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



//   // **초기 폴더 전체 스캔 및 메타데이터 수집**
//   // 클라이언트가 시작하면, 폴더에 있는 모든 .txt 파일의 메타데이터(파일명, 수정 시간 등)를 읽어온다.
//   useEffect(() => {
//     if (folderPath) {
//       fs.readdir(folderPath, (err, files) => {
//         if (err) {
//           console.error('폴더 읽기 실패:', err);
//           return;
//         }
//         // .txt 파일만 필터링
//         const txtFiles = files.filter(file => file.endsWith('.txt'));
//         const metadata = {};
//         txtFiles.forEach(file => {
//           const fileFullPath = path.join(folderPath, file);
//           // 파일의 메타데이터 가져오기 (비동기로 할 수도 있으나 여기서는 예시로 동기적 stat 사용)
//           try {
//             const stats = fs.statSync(fileFullPath);
//             // 예: 마지막 수정 시간(mtime)을 저장
//             metadata[fileFullPath] = {
//               modifiedTime: stats.mtime,
//               size: stats.size,
//             };
//           } catch (statErr) {
//             console.error('파일 상태 확인 에러:', statErr);
//           }
//         });
//         // 수집된 메타데이터를 상태에 저장
//         setLocalMetadata(metadata);
//         console.log('초기 폴더 스캔 메타데이터:', metadata);
//         // 여기서 이후 클라우드 메타데이터와 비교하는 API 호출도 추가할 수 있음.
//       });
//     }
//   }, [folderPath]);



//   // **파일 변경 감지 기능**: 폴더 내의 .txt 파일에 변화가 생기면 즉시 감지해서 백업 API 호출
//   useEffect(() => {
//     if (folderPath) {
//       const watcher = chokidar.watch(`${folderPath}/*.txt`, {
//         persistent: true,
//         ignoreInitial: true,
//       });

//       watcher.on('change', async (filePath) => {
//         console.log(`변경 감지: ${filePath}`);
//         updateFileStatus(filePath, '백업 중...');
//         try {
//           const content = fs.readFileSync(filePath, 'utf8');
//           // 단일 버전 덮어쓰기 (diff 없이 전체 내용을 백업)
//           const backupData = { filePath, content };
//           const result = await backupFile(backupData);
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

// // useEffect - 최초 마운트 시 서버에서 폴더 정보를 불러옴
// useEffect(() => {
//   const fetchFolderFromServer = async () => {
//     try {
//       const data = await getSyncFolder();
//       // data가 배열이라고 가정하고 첫 번째 경로를 사용
//       if (Array.isArray(data) && data.length > 0) {
//         const serverFolderPath = data[0].path || data[0]; // 서버가 { path: "C:/..." } 형태로 보낸다면
//         setFolderPath(serverFolderPath);
//         localStorage.setItem(localKey, serverFolderPath);
//         console.log('서버에서 불러온 폴더:', serverFolderPath);
//       } else {
//         console.log('서버에 저장된 폴더 경로가 없습니다.');
//       }
//     } catch (err) {
//       console.error('서버 폴더 정보 불러오기 실패:', err);
//     }
//   };

//   if (!folderPath) {
//     fetchFolderFromServer();
//   }
// }, []);



//   // 백업 파일 다운로드(검증) 기능
//   const handleDownloadBackup = async (filePath) => {
//     try {
//       const blob = await downloadBackupFile(filePath);
//       const url = window.URL.createObjectURL(blob);
//       const a = document.createElement('a');
//       a.href = url;
//       a.download = filePath.split('/').pop();
//       a.click();
//       window.URL.revokeObjectURL(url);
//     } catch (error) {
//       console.error('다운로드 에러:', error);
//       alert('다운로드 실패');
//     }
//   };

//   return (
//     <div className="auth-container">
//       <div className="auth-box">
//         <h1>HOME</h1>
//         <button onClick={handleLogout}>로그아웃</button>
//         <button onClick={handleSelectFolder}>싱크용 폴더 선택</button>
//         {folderPath && <p>선택된 폴더: {folderPath}</p>}
//         {/* 초기 스캔된 메타데이터 출력 (예시) */}
//         {/* {Object.keys(localMetadata).length > 0 && (
//           <div>
//             <h2>초기 폴더 메타데이터</h2>
//             <ul>
//               {Object.entries(localMetadata).map(([filePath, meta]) => (
//                 <li key={filePath}>
//                   <strong>{filePath}</strong>: 수정시간 {meta.modifiedTime.toString()}, 크기 {meta.size} bytes
//                 </li>
//               ))}
//             </ul>
//           </div>
//         )} */}
//         {fileStatuses.length > 0 && (
//           <div>
//             <h2>파일 백업 상태</h2>
//             <ul>
//               {fileStatuses.map((item) => (
//                 <li key={item.filePath}>
//                   <strong>{item.filePath}</strong>: {item.status}{' '}
//                   <button onClick={() => handleDownloadBackup(item.filePath)}>다운로드 확인</button>
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

