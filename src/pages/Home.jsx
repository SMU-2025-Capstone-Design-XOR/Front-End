// // src/pages/Home.jsx
// import React, { useState, useEffect, useRef } from 'react';
// import { useNavigate }                    from 'react-router-dom';
// import '../css/home.css';
// import '../css/all.css';
// import {
//   sendSyncFolder,
//   getSyncFolder,
//   scanFolderFiles,
//   uploadFile,
//   downloadFolderFile,
//   getFolderFileList,
//   deleteSyncFolder
// } from '../apiService';

// const { ipcRenderer, remote } = window.require('electron');
// const chokidar = window.require('chokidar');
// const fs       = window.require('fs');
// const path     = window.require('path');

// export default function Home() {
//   const navigate    = useNavigate();
//   const currentUser = localStorage.getItem('currentUser') || 'default';
//   const localKey    = `syncFolder_${currentUser}`;

//   const [folderPath, setFolderPath]     = useState(localStorage.getItem(localKey) || '');
//   const [syncFolders, setSyncFolders]   = useState([]);    // { id, folderPath }[]
//   const [selectedFolder, setSelectedFolder] = useState(null); 
//     // { id, folderPath } or null
//   const [fileList, setFileList]         = useState([]);    // 서버 파일 목록
//   const [fileStatuses, setFileStatuses] = useState([]);    // 상태 메시지들

//   // 1) 서버 폴더 목록 불러오기
//   useEffect(() => {
//     async function loadFolders() {
//       try {
//         const data = await getSyncFolder();
//         setSyncFolders(Array.isArray(data) ? data : []);
//       } catch {
//         alert('싱크 폴더 로드 실패');
//       }
//     }
//     loadFolders();
//   }, []);

//   // 2) 폴더 선택 Dialog → 서버 등록 → 목록 갱신
//   const handleSelectFolder = async () => {
//     const sel = await ipcRenderer.invoke('open-folder-dialog');
//     if (!sel) return;
//     setFolderPath(sel);
//     localStorage.setItem(localKey, sel);
//     try {
//       await sendSyncFolder(sel);
//       // 다시 목록
//       const data = await getSyncFolder();
//       setSyncFolders(Array.isArray(data) ? data : []);
//     } catch {
//       alert('이미 등록된 폴더이거나 오류');
//     }
//   };

//   // 3) 폴더 클릭 → 해당 폴더의 서버 파일 목록 조회
//   const openFolder = async (folder) => {
//     setSelectedFolder(folder);
//     try {
//       const files = await getFolderFileList(folder.id);
//       setFileList(files);
//     } catch {
//       alert('폴더 내 파일 조회 실패');
//     }
//   };

//   // 4) 파일 업로드 (로컬 변경 감지 로직 생략)
//   const handleUpload = async (filePath) => {
//     if (!selectedFolder) return;
//     try {
//       await uploadFile(selectedFolder.id, filePath);
//       updateStatus(filePath, '업로드 성공');
//     } catch {
//       updateStatus(filePath, '업로드 실패');
//     }
//   };

//   // 5) 파일 다운로드
//   const handleDownload = async (fileName) => {
//     if (!selectedFolder) return;
//     try {
//       const blob = await downloadFolderFile(selectedFolder.id, fileName);
//       const arrayBuf = await blob.arrayBuffer();
//       const localFp = path.join(selectedFolder.folderPath, fileName);
//       fs.writeFileSync(localFp, Buffer.from(arrayBuf));
//       updateStatus(localFp, '다운로드 완료');
//     } catch {
//       updateStatus(fileName, '다운로드 실패');
//     }
//   };

//   // 상태 업데이트 헬퍼
//   const updateStatus = (fp, msg) => {
//     setFileStatuses(prev => {
//       const idx = prev.findIndex(x => x.filePath === fp);
//       if (idx >= 0) {
//         const copy = [...prev];
//         copy[idx] = { filePath: fp, status: msg };
//         return copy;
//       }
//       return [...prev, { filePath: fp, status: msg }];
//     });
//   };

//   // 6) 로그아웃
//   const handleLogout = () => {
//     localStorage.clear();
//     navigate('/');
//   };

//   return (
//     <div className="auth-container">
//       <div className="auth-box">

//         <div style={{ display:'flex', gap:8, marginBottom:16 }}>
//           <button onClick={handleLogout}>로그아웃</button>
//           <button onClick={handleSelectFolder}>폴더 선택</button>
//         </div>

//         {/* 7) 폴더 목록 또는 파일 목록 분기 */}
//         { !selectedFolder ? (
//           <section>
//             <h2>서버 싱크 폴더</h2>
//             <ul>
//               {syncFolders.map(f => (
//                 <li key={f.id}
//                     onDoubleClick={() => openFolder(f)}
//                     style={{ cursor:'pointer', margin:'4px 0' }}>
//                   📁 {f.folderPath}
//                 </li>
//               ))}
//             </ul>
//           </section>
//         ) : (
//           <section>
//             <h2>폴더: {selectedFolder.folderPath}</h2>
//             <button onClick={() => setSelectedFolder(null)}>← 뒤로</button>
//             <ul>
//               {fileList.map(name => (
//                 <li key={name} style={{ margin:'4px 0' }}>
//                   📄 {name}{' '}
//                   <button onClick={() => handleUpload(path.join(selectedFolder.folderPath, name))}>
//                     업로드
//                   </button>{' '}
//                   <button onClick={() => handleDownload(name)}>
//                     다운로드
//                   </button>
//                 </li>
//               ))}
//             </ul>
//           </section>
//         )}

//         {/* 8) 파일 상태 로그 */}
//         {fileStatuses.length > 0 && (
//           <section style={{ marginTop:24 }}>
//             <h2>파일 상태</h2>
//             <ul>
//               {fileStatuses.map(({filePath, status}) => (
//                 <li key={filePath}>
//                   <strong>{filePath}</strong>: {status}
//                 </li>
//               ))}
//             </ul>
//           </section>
//         )}

//       </div>
//     </div>
//   );
// }

// src/pages/Home.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentWindow, Menu, MenuItem } from '@electron/remote';
import '../css/home.css';
import '../css/all.css';
import {
  sendSyncFolder,
  getSyncFolder,
  scanFolderFiles,
  getFolderFileList,
  uploadFile,
  downloadFolderFile,
  deleteSyncFolder,
} from '../apiService';

// const { ipcRenderer, remote } = window.require('electron');
const { ipcRenderer } = window.require('electron');

// @electron/remote 로부터, Menu, MenuItem 가져오기
// const { Menu, MenuItem } = window.require('@electron/remote');


const fs   = window.require('fs');
const path = window.require('path');

export default function Home() {
  const navigate      = useNavigate();
  const currentUser   = localStorage.getItem('currentUser') || 'default';
  const localKey      = `syncFolder_${currentUser}`;

  const [folderPath, setFolderPath]           = useState(localStorage.getItem(localKey) || '');
  const [syncFolders, setSyncFolders]         = useState([]);    // 서버에 등록된 폴더 목록
  const [selectedFolder, setSelectedFolder]   = useState(null);  // {id, folderPath}
  const [fileList, setFileList]               = useState([]);    // 서버에서 가져온 파일 이름 배열
  const [fileStatuses, setFileStatuses]       = useState([]);    // 업로드/다운로드 상태

  /** 1) 서버에 등록된 싱크 폴더 목록 로드 */
  useEffect(() => {
    (async () => {
      try {
        const data = await getSyncFolder();
        setSyncFolders(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
        alert('싱크 폴더 목록 로드 실패');
      }
    })();
  }, []);

  /** 2) 폴더 선택 → 서버 등록 → 초기 스캔 전송 → 목록 재갱신 */
  const handleSelectFolder = async () => {
    const sel = await ipcRenderer.invoke('open-folder-dialog');
    if (!sel) return;

    setFolderPath(sel);
    localStorage.setItem(localKey, sel);

    try {
      // 2-1) 서버에 폴더 등록 (리턴값에 id, folderPath를 기대)
      const created = await sendSyncFolder(sel);

      // 2-2) 로컬 폴더 내 txt 파일 스캔
      const filesMeta = fs.readdirSync(sel)
        .filter(f => f.endsWith('.txt'))
        .map(f => {
          const full = path.join(sel, f);
          const stat = fs.statSync(full);
          return {
            fileName: f,
            modifiedTime: stat.mtimeMs,
            size: stat.size,
          };
        });

      // 2-3) 서버로 초기 스캔 전송
      await scanFolderFiles(created.id, filesMeta);

      // 2-4) 최신 폴더 목록 다시 로드
      const data = await getSyncFolder();
      setSyncFolders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      alert('폴더 등록 또는 스캔 전송 중 오류');
    }
  };

  /** 3) 폴더 더블클릭 → 해당 폴더 내 파일 목록 조회 */
  const openFolder = async folder => {
    setSelectedFolder(folder);
    try {
      const files = await getFolderFileList(folder.id);
      setFileList(Array.isArray(files) ? files : []);
      setFileStatuses([]); // 이전 상태 로그 초기화
    } catch (err) {
      console.error(err);
      alert('폴더 내 파일 목록 조회 실패');
    }
  };

  /** 4) 선택된 파일 업로드 */
  const handleUpload = async filePath => {
    if (!selectedFolder) return;
    try {
      await uploadFile(selectedFolder.id, filePath);
      updateStatus(filePath, '업로드 성공');
    } catch (err) {
      console.error(err);
      updateStatus(filePath, '업로드 실패');
    }
  };

  /** 5) 선택된 파일 다운로드 */
  const handleDownload = async fileName => {
    if (!selectedFolder) return;
    try {
      const blob = await downloadFolderFile(selectedFolder.id, fileName);
      const arrayBuf = await blob.arrayBuffer();
      const localFp  = path.join(selectedFolder.folderPath, fileName);
      fs.writeFileSync(localFp, Buffer.from(arrayBuf));
      updateStatus(localFp, '다운로드 완료');
    } catch (err) {
      console.error(err);
      updateStatus(fileName, '다운로드 실패');
    }
  };

  /** 6) 상태 메시지 추가/갱신 */
  const updateStatus = (fp, msg) => {
    setFileStatuses(prev => {
      const idx = prev.findIndex(x => x.filePath === fp);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { filePath: fp, status: msg };
        return copy;
      }
      return [...prev, { filePath: fp, status: msg }];
    });
  };

  /** 7) 우클릭 컨텍스트 메뉴로 폴더 삭제 */
  const handleContextMenu = id => e => {
    e.preventDefault();
    // const menu = new remote.Menu();
    const menu = new Menu();
    menu.append(new MenuItem({
      label: '폴더 삭제',
      click: async () => {
        if (!window.confirm('정말 삭제하시겠습니까?')) return;
        try {
          await deleteSyncFolder(id);
          // 폴더 목록 갱신
          const data = await getSyncFolder();
          setSyncFolders(Array.isArray(data) ? data : []);
          // 선택된 폴더 초기화
          if (selectedFolder?.id === id) setSelectedFolder(null);
        } catch (err) {
          console.error(err);
          alert('삭제 실패');
        }
      }
    }));
    // menu.popup({ window: remote.getCurrentWindow() });
    menu.popup({ window: getCurrentWindow() });
  };

  /** 8) 로그아웃 */
  const handleLogout = () => {
    localStorage.clear();
    navigate('/');
  };

  return (
    <div className="auth-container">
      <div className="auth-box">

        {/* 상단 버튼 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={handleLogout}>로그아웃</button>
          <button onClick={handleSelectFolder}>폴더 선택</button>
        </div>

        {/* 디렉토리 목록 vs 파일 목록 화면 분기 */}
        {!selectedFolder ? (
          <section>
            <h2>서버 싱크 폴더</h2>
            <ul>
              {syncFolders.map(f => (
                <li key={f.id}
                    onDoubleClick={() => openFolder(f)}
                    onContextMenu={handleContextMenu(f.id)}
                    style={{ cursor: 'pointer', margin: '4px 0' }}>
                  📁 {f.folderPath}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section>
            <h2>폴더: {selectedFolder.folderPath}</h2>
            <button onClick={() => setSelectedFolder(null)}>← 뒤로</button>
            <ul>
              {fileList.map(name => {
                const fullPath = path.join(selectedFolder.folderPath, name);
                return (
                  <li key={name} style={{ margin: '4px 0' }}>
                    📄 {name}{' '}
                    <button onClick={() => handleUpload(fullPath)}>업로드</button>{' '}
                    <button onClick={() => handleDownload(name)}>다운로드</button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* 상태 로그 */}
        {fileStatuses.length > 0 && (
          <section style={{ marginTop: 24 }}>
            <h2>파일 상태</h2>
            <ul>
              {fileStatuses.map(({ filePath, status }) => (
                <li key={filePath}>
                  <strong>{filePath}</strong>: {status}
                </li>
              ))}
            </ul>
          </section>
        )}

      </div>
    </div>
  );
}
