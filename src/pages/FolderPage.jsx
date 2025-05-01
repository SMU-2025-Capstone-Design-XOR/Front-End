// // src/pages/FolderPage.jsx
// import React, { useState, useEffect } from 'react';
// import { useParams, useNavigate, useLocation } from 'react-router-dom';
// import { Menu, MenuItem, getCurrentWindow } from '@electron/remote';
// import { dialog } from '@electron/remote';

// import folderIcon from '../assets/Home/folder.svg';
// import personIcon from '../assets/Home/person-24.svg';
// import { UserContextMenu } from '../components/UserContextMenu';

// import {
//   getFolderFileList,
//   getFolderFileMeta,
//   downloadFolderFile,
//   deleteFolderFile
// } from '../apiService';

// const fs     = window.require('fs');
// const path   = window.require('path');
// const Buffer = window.require('buffer').Buffer;

// export default function FolderPage() {
//   const { id }     = useParams();              // sync-folder ID
//   const { state }  = useLocation();
//   const folderPath = state?.folderPath || '';
//   const navigate   = useNavigate();
//   const username   = localStorage.getItem('currentUser') || 'User';

//   // ── 헤더용 User 컨텍스트 메뉴 ── 
//   const [userMenu, setUserMenu] = useState({ visible: false, x:0, y:0 });
//   const showUserMenu = e => {
//     e.preventDefault();
//     setUserMenu({ visible: true, x: e.clientX, y: e.clientY });
//   };
//   const closeUserMenu = () => setUserMenu(m => ({ ...m, visible: false }));
//   const handleLogout = () => {
//     if (window.confirm('로그아웃하시겠습니까?')) {
//       localStorage.clear();
//       navigate('/');
//     }
//   };

//   // 파일 리스트: 서버가 내려주는 f.id(숫자) 그대로 보존합니다.
//   const [fileList, setFileList] = useState([]);
//   useEffect(() => {
//     (async () => {
//       try {
//         const files = await getFolderFileList(id);
//         // const mapped = Array.isArray(files)
//         //   // 문자열만 내려줄 경우엔 리스트에 표시하지 않습니다
//         //   ? files
//         //       .filter(f => typeof f === 'object' && f.id != null)
//         //       .map(f => ({
//         //         fileId:   f.id,                            // 서버 DB 고유 ID (숫자)
//         //         fileName: f.relativePath,                  // 다운로드/메타조회 등에 쓸 경로
//         //         name:     f.originalName || f.relativePath // UI에 표시할 이름
//         //       }))
//         //   : [];
//         const mapped = Array.isArray(files)
//         ? files
//             .filter(f => typeof f === 'object' && (f.id != null || f.relativePath))
//             .map(f => ({
//               fileId:   f.id != null ? f.id : f.relativePath,  // 없으면 경로로 대체
//               fileName: f.relativePath || f.id,
//               name:     f.originalName || f.relativePath || f.id
//             }))
//         : [];        
//         setFileList(mapped);
//         console.log('[getFolderFileList 응답]', files);
//       } catch (err) {
//         console.error(err);
//         alert('파일 목록 조회 실패');
//       }
//     })();
//   }, [id]);

//   // ── “정보 가져오기” ──
//   const handleInfo = async (fileName) => {
//     try {
//       const meta = await getFolderFileMeta(id, fileName);
//       alert(JSON.stringify(meta, null, 2));
//     } catch (err) {
//       console.error(err);
//       alert('메타정보 조회 실패');
//     }
//   };

//   // ── “파일 다운로드” ──
//   const handleDownload = async (fileName) => {
//     try {
//       const blob = await downloadFolderFile(id, fileName);
//       const buf  = await blob.arrayBuffer();
//       const { filePath } = await dialog.showSaveDialog({
//         defaultPath: path.join(folderPath, fileName)
//       });
//       if (!filePath) return;
//       fs.writeFileSync(filePath, Buffer.from(buf));
//       alert('다운로드 완료!');
//     } catch (err) {
//       console.error(err);
//       alert('다운로드 중 오류');
//     }
//   };

//   // 삭제: 숫자 ID를 받아서 바로 호출
//   const handleDelete = async (fileId) => {
//     // 파일 이름은 리스트에서 꺼내 쓰도록
//     const item = fileList.find(f => f.fileId === fileId);
//     if (!item) return;
//     if (!window.confirm(`’${item.name}‘ 을(를) 정말 삭제하시겠습니까?`)) return;

//     try {
//       await deleteFolderFile(id, fileId);
//       alert('삭제되었습니다.');
//       // UI에도 바로 반영
//       setFileList(fl => fl.filter(f => f.fileId !== fileId));
//     } catch (err) {
//       console.error(err);
//       alert('삭제 실패: ' + err.message);
//     }
//   };
//   // ── 우클릭 컨텍스트 메뉴 ──
//   const showFileMenu = (e, { fileId, fileName, name }) => {
//     e.preventDefault();
//     const menu = new Menu();
//     menu.append(new MenuItem({
//       label: '파일 공유',
//       click: () => alert(`’${name}‘ 공유 처리…`)
//     }));
//     menu.append(new MenuItem({
//       label: '버전 관리',
//       click: () => alert(`’${name}‘ 버전 관리 열기…`)
//     }));
//     menu.append(new MenuItem({
//       label: '정보 가져오기',
//       click: () => handleInfo(fileName)
//     }));
//     menu.append(new MenuItem({
//       label: '파일 다운로드',
//       click: () => handleDownload(fileName)
//     }));
//     menu.append(new MenuItem({
//       label: '파일 삭제', 
//       click: () => handleDelete(fileId)
//       // click: () => handleDelete(fileName)
//     }));
//     menu.popup({ window: getCurrentWindow() });
//   };

//   return (
//     <div style={{ height:'100vh', display:'flex', flexDirection:'column' }}>
//       {/* ── 헤더 ── */}
//       <header style={{
//         display: 'flex', alignItems: 'center',
//         padding: '0 16px', height: '72px',
//         backgroundColor:'#f2f2f2', borderBottom:'1px solid #dee5ed'
//       }}>
//         <button
//           onClick={() => navigate(-1)}
//           style={{
//             fontSize:'24px', marginRight:'16px',
//             background:'none', border:'none', cursor:'pointer'
//           }}
//         >←</button>
//         <div style={{ flexGrow:1, fontWeight:'bold', fontSize:'18px' }}>
//           {folderPath}
//         </div>
//         <div style={{ marginRight:'16px', fontSize:'16px' }}>
//           {username}
//         </div>
//         <img
//           src={personIcon}
//           alt="User"
//           onContextMenu={showUserMenu}
//           style={{ width:24, height:24, cursor:'pointer' }}
//         />
//         {userMenu.visible && (
//           <UserContextMenu
//             x={userMenu.x}
//             y={userMenu.y}
//             onLogout={handleLogout}
//             onClose={closeUserMenu}
//           />
//         )}
//       </header>

//       {/* ── 메인: 파일 리스트 ── */}
//       <main style={{ padding:16, overflowY:'auto', flexGrow:1, background:'#fff' }}>
//         {fileList.map(item => (
//           <div
//             key={item.fileId}                 /* ← fileId 로 바꿨습니다 */
//             onContextMenu={e => showFileMenu(e, item)}
//             style={{ display:'flex', alignItems:'center', padding:'8px 0' }}
//           >
//             <span style={{ marginRight: 8 }}>📄</span>
//             <span style={{ flexGrow: 1 }}>{item.name}</span>
//           </div>
//         ))}
//       </main>
//     </div>
//   );
// }
// src/pages/FolderPage.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Menu, MenuItem, getCurrentWindow } from '@electron/remote';
import { dialog } from '@electron/remote';
import chokidar from 'chokidar';

import folderIcon from '../assets/Home/folder.svg';
import personIcon from '../assets/Home/person-24.svg';
import { UserContextMenu } from '../components/UserContextMenu';

import {
  getFolderFileList,
  getFolderFileMeta,
  downloadFolderFile,
  deleteFolderFile
} from '../apiService';

const fs     = window.require('fs');
const path   = window.require('path');
const Buffer = window.require('buffer').Buffer;

export default function FolderPage() {
  const { id }     = useParams();              // sync-folder ID
  const { state }  = useLocation();
  const folderPath = state?.folderPath || '';  // 로컬 동기화 폴더 경로
  const navigate   = useNavigate();
  const username   = localStorage.getItem('currentUser') || 'User';

  // ── 헤더용 User 컨텍스트 메뉴 ── 
  const [userMenu, setUserMenu] = useState({ visible: false, x:0, y:0 });
  const showUserMenu = e => {
    e.preventDefault();
    setUserMenu({ visible: true, x: e.clientX, y: e.clientY });
  };
  const closeUserMenu = () => setUserMenu(m => ({ ...m, visible: false }));
  const handleLogout = () => {
    if (window.confirm('로그아웃하시겠습니까?')) {
      localStorage.clear();
      navigate('/');
    }
  };

  // ── 파일 리스트 상태 ──
  const [fileList, setFileList] = useState([]);

  // ── 파일 목록 로드 + 매핑 로직을 함수로 분리 ──
  const loadFiles = async () => {
    try {
      const files = await getFolderFileList(id);
      const mapped = Array.isArray(files)
        ? files
            .filter(f => typeof f === 'object' && (f.id != null || f.relativePath))
            .map(f => ({
              fileId:   f.id != null ? f.id : f.relativePath,
              fileName: f.relativePath || f.id,
              name:     f.originalName || f.relativePath || f.id
            }))
        : [];
      setFileList(mapped);
      console.log('[getFolderFileList 응답]', files);
    } catch (err) {
      console.error(err);
      alert('파일 목록 조회 실패');
    }
  };

  // ── 1) ID 변경 시(=다른 폴더 진입) 목록 로드 ──
  useEffect(() => {
    loadFiles();
  }, [id]);

  // ── 2) 로컬 폴더 변경 감지하여 자동 갱신 ──
  useEffect(() => {
    if (!folderPath) return;
    const watcher = chokidar.watch(folderPath, {
      ignored: /(^|[\/\\])\..+|~$|\.swp$/,
      persistent: true,
      ignoreInitial: true,
      depth: 0,  // 서브 폴더까지 지원하려면 Infinity 로 변경
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
    });
    const handle = () => {
      loadFiles();
    };
    watcher.on('add',    handle)
           .on('change', handle)
           .on('unlink', handle);

    return () => watcher.close();
  }, [folderPath, id]);


  // ── “정보 가져오기” ──
  const handleInfo = async (fileName) => {
    try {
      const meta = await getFolderFileMeta(id, fileName);
      alert(JSON.stringify(meta, null, 2));
    } catch (err) {
      console.error(err);
      alert('메타정보 조회 실패');
    }
  };

  // ── “파일 다운로드” ──
  const handleDownload = async (fileName) => {
    try {
      const blob = await downloadFolderFile(id, fileName);
      const buf  = await blob.arrayBuffer();
      const { filePath } = await dialog.showSaveDialog({
        defaultPath: path.join(folderPath, fileName)
      });
      if (!filePath) return;
      fs.writeFileSync(filePath, Buffer.from(buf));
      alert('다운로드 완료!');
    } catch (err) {
      console.error(err);
      alert('다운로드 중 오류');
    }
  };

  // ── “파일 삭제” ──
  const handleDelete = async (fileId) => {
    const item = fileList.find(f => f.fileId === fileId);
    if (!item) return;
    if (!window.confirm(`’${item.name}‘ 을(를) 정말 삭제하시겠습니까?`)) return;

    try {
      await deleteFolderFile(id, fileId);
      alert('삭제되었습니다.');
      // 삭제 후에도 다시 불러와 UI 갱신
      loadFiles();
    } catch (err) {
      console.error(err);
      alert('삭제 실패: ' + err.message);
    }
  };

  // ── 우클릭 컨텍스트 메뉴 ──
  const showFileMenu = (e, { fileId, fileName, name }) => {
    e.preventDefault();
    const menu = new Menu();
    menu.append(new MenuItem({ label: '파일 공유',   click: () => alert(`’${name}‘ 공유…`) }));
    menu.append(new MenuItem({ label: '버전 관리',   click: () => alert(`’${name}‘ 버전 관리…`) }));
    menu.append(new MenuItem({ label: '정보 가져오기', click: () => handleInfo(fileName) }));
    menu.append(new MenuItem({ label: '파일 다운로드', click: () => handleDownload(fileName) }));
    menu.append(new MenuItem({ label: '파일 삭제',    click: () => handleDelete(fileId) }));
    menu.popup({ window: getCurrentWindow() });
  };

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column' }}>
      {/* ── 헤더 ── */}
      <header style={{
        display: 'flex', alignItems: 'center',
        padding: '0 16px', height: '72px',
        backgroundColor:'#f2f2f2', borderBottom:'1px solid #dee5ed'
      }}>
        <button onClick={() => navigate(-1)}
          style={{ fontSize:'24px', marginRight:'16px', background:'none', border:'none', cursor:'pointer' }}
        >←</button>
        <div style={{ flexGrow:1, fontWeight:'bold', fontSize:'18px' }}>
          {folderPath}
        </div>
        <div style={{ marginRight:'16px', fontSize:'16px' }}>{username}</div>
        <img
          src={personIcon}
          alt="User"
          onContextMenu={showUserMenu}
          style={{ width:24, height:24, cursor:'pointer' }}
        />
        {userMenu.visible && (
          <UserContextMenu
            x={userMenu.x}
            y={userMenu.y}
            onLogout={handleLogout}
            onClose={closeUserMenu}
          />
        )}
      </header>

      {/* ── 메인: 파일 리스트 ── */}
      <main style={{ padding:16, overflowY:'auto', flexGrow:1, background:'#fff' }}>
        {fileList.map(item => (
          <div
            // key={item.fileId}
            key={`${item.fileId}__${item.fileName}`}  /* fileId 와 fileName 을 합쳐서 유니크 key */
            onContextMenu={e => showFileMenu(e, item)}
            style={{ display:'flex', alignItems:'center', padding:'8px 0' }}
          >
            <span style={{ marginRight: 8 }}>📄</span>
            <span style={{ flexGrow: 1 }}>{item.name}</span>
          </div>
        ))}
      </main>
    </div>
  );
}
