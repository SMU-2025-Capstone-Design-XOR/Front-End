// src/pages/Home.jsx
// 로그인 후 홈화면 진입

import React, { useState, useEffect } from 'react';
import { useNavigate }                   from 'react-router-dom';

import { Menu, MenuItem, getCurrentWindow } from '@electron/remote';
import FolderContextMenu from '../components/FolderContextMenu';

import createSync from '../assets/Home/create-sync.svg';
import syncIcon   from '../assets/Home/sync.svg';
import folderIcon from '../assets/Home/folder.svg';
import personIcon from '../assets/Home/person-24.svg';
// import 

import '../css/home.css';
import {
  sendSyncFolder,
  getSyncFolder,
  deleteSyncFolder,
  scanFolderFiles,
  getFolderFileList,
  uploadFile,
  downloadFolderFile,
} from '../apiService';

const { ipcRenderer } = window.require('electron');
const fs   = window.require('fs');
const path = window.require('path');

export default function Home() {
  const navigate = useNavigate();
  const username = localStorage.getItem('currentUser') || 'User';

  const [syncFolders, setSyncFolders]       = useState([]);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [fileList, setFileList]             = useState([]);

  // Context Menu state
  const [ctxMenu, setCtxMenu] = useState({
    visible: false,
    x: 0, y: 0,
    folderId: null,
  });


  const headerTitle  = 'HOME';               // 헤더 제목
  const addSyncLabel = '싱크 폴더 추가';      // New Sync 레이블

  // 1) 서버에 등록된 싱크 폴더 목록 불러오기
  useEffect(() => {
    (async () => {
      try {
        const data = await getSyncFolder();
        setSyncFolders(Array.isArray(data) ? data : []);
      } catch {
        alert('싱크 폴더 목록 로드 실패');
      }
    })();
  }, []);

  // 2) New Sync: 폴더 선택 → 서버 등록 → 초기 스캔
  const handleSelectFolder = async () => {
    const sel = await ipcRenderer.invoke('open-folder-dialog');
    if (!sel) return;
    try {
      const created = await sendSyncFolder(sel);
      const filesMeta = fs.readdirSync(sel)
        .filter(f => f.endsWith('.txt'))
        .map(f => {
          const stat = fs.statSync(path.join(sel, f));
          return { fileName: f, modifiedTime: stat.mtimeMs, size: stat.size };
        });
      await scanFolderFiles(created.id, filesMeta);
      const data = await getSyncFolder();
      setSyncFolders(Array.isArray(data) ? data : []);
    } catch {
      alert('폴더 등록 또는 스캔 중 오류');
    }
  };

  // 3) 폴더 열기 → 파일 리스트 불러오기
  const openFolder = async (folder) => {
    setSelectedFolder(folder);
    try {
      const files = await getFolderFileList(folder.id);
      setFileList(Array.isArray(files) ? files : []);
    } catch {
      alert('파일 목록 조회 실패');
    }
  };

  // 4) 사용자 아이콘 우클릭 → 로그아웃 메뉴
  const showUserMenu = (e) => {
    e.preventDefault();
    const menu = new Menu();
    menu.append(new MenuItem({
      label: '로그아웃',
      click: () => {
        if (window.confirm('로그아웃하시겠습니까?')) {
          localStorage.clear();
          navigate('/');
        }
      }
    }));
    menu.popup({ window: getCurrentWindow() });
  };

  // * 폴더 카드 우클릭 시 컨텍스트 메뉴 표시
  //  const showFolderMenu = (folderId) => (e) => {
  //    e.preventDefault();
  //    const menu = new Menu();
  //    menu.append(new MenuItem({
  //      label: '정보 가져오기',
  //      click: async () => {
  //        // 예시: 첫 번째 파일 메타 가져오기
  //        try {
  //          const data = await getFolderFileMeta(folderId, fileList[0] || '');
  //          alert(JSON.stringify(data, null, 2));
  //        } catch (err) {
  //          alert('정보 조회 실패');
  //        }
  //      }
  //    }));
  //    menu.append(new MenuItem({ type: 'separator' }));
  //    menu.append(new MenuItem({
  //      label: '폴더 삭제',
  //      click: async () => {
  //        if (!window.confirm('폴더를 삭제하시겠습니까?')) return;
  //        try {
  //          await deleteSyncFolder(folderId);
  //          const refreshed = await getSyncFolder();
  //          setSyncFolders(Array.isArray(refreshed) ? refreshed : []);
  //          if (selectedFolder?.id === folderId) {
  //            setSelectedFolder(null);
  //            setFileList([]);
  //          }
  //        } catch {
  //          alert('폴더 삭제 실패');
  //        }
  //      }
  //    }));
  //    menu.popup({ window: getCurrentWindow() });
  //  };
  
  // 5) 폴더 카드 우클릭 → React ContextMenu
   const onFolderContext = folderId => e => {
     e.preventDefault();
     setCtxMenu({
       visible: true,
       x: e.clientX,
       y: e.clientY,
       folderId,
     });
   };
  
   // 메뉴 밖 클릭 시 닫기
  //  const onClickOutside = () => {
  //    if (ctxMenu.visible) setCtxMenu({...ctxMenu, visible: false});
  //  };
  
  useEffect(() => {
    const handleClick = () => {
      if (ctxMenu.visible) {
        setCtxMenu(menu => ({ ...menu, visible: false }));
      }
    };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [ctxMenu.visible]);

   // 컨텍스트 메뉴: 정보
   const handleInfo = async () => {
     try {
       // 예시: 첫 번째 파일 메타
       const data = await getFolderFileMeta(ctxMenu.folderId, fileList[0] || '');
      //  alert(JSON.stringify(data, null, 2));
      alert(`Folder ID: ${ctxMenu.folderId}`);
     } catch {
       alert('정보 조회 실패');
     }
    //  setCtxMenu({...ctxMenu, visible: false});
    setCtxMenu(m => ({ ...m, visible: false }));
   };
  
   // 컨텍스트 메뉴: 삭제
   const handleDelete = async () => {
     if (!window.confirm('폴더를 삭제하시겠습니까?')) {
       return setCtxMenu({...ctxMenu, visible: false});
     }
     try {
       await deleteSyncFolder(ctxMenu.folderId);
       const refreshed = await getSyncFolder();
       setSyncFolders(Array.isArray(refreshed) ? refreshed : []);
       if (selectedFolder?.id === ctxMenu.folderId) {
         setSelectedFolder(null);
         setFileList([]);
       }
     } catch {
       alert('폴더 삭제 실패');
     }
     setCtxMenu({...ctxMenu, visible: false});
   };


  return (
    <div className="home">
      {/* 헤더 */}
      <div className="header">
        <div
          className="folder-icon"
          style={{ backgroundImage: `url(${folderIcon})` }}
        />
        <div className="header-title">{headerTitle}</div>
        <div className="username">{username}</div>
        <div
          className="person-icon"
          onContextMenu={showUserMenu}
          style={{ backgroundImage: `url(${personIcon})` }}
        />
      </div>

      {/* 메인 그리드 */}
      <div className="home-main">
        {/* New Sync 버튼 (첫 번째 그리드 아이템) */}
        <div
          className="sync-wrapper"
          onClick={handleSelectFolder}
        >
          <img src={createSync} alt="" />
          <div className="sync-label">{addSyncLabel}</div>
        </div>

        {/* 서버에서 받아온 실제 싱크 폴더들 */}
        {syncFolders.map((folder, i) => (
          <div
            key={folder.id}
            className="sync-wrapper"
            // onContextMenu={showFolderMenu(folder.id)}
            onContextMenu={onFolderContext(folder.id)}
            onDoubleClick={() =>
              navigate(`/folder/${folder.id}`, {
                state: { folderPath: folder.folderPath }
              })
            }            
          >
            <img src={syncIcon} alt="" />
            <div className="sync-label">
              {folder.folderPath.split('/').pop()}
            </div>
          </div>
        ))}
      </div>

      {/* React Context Menu */}
     <FolderContextMenu
       visible={ctxMenu.visible}
       x={ctxMenu.x}
       y={ctxMenu.y}
       onInfo={handleInfo}
       onDelete={handleDelete}
     />


      {/* 파일 리스트 섹션 (선택된 폴더가 있을 때만) */}
      {selectedFolder && (
        <section className="file-section">
          <button
            className="back-button"
            onClick={() => setSelectedFolder(null)}
          >
            ← Back
          </button>
          <ul className="file-list">
            {fileList.map(name => (
              <li key={name} className="file-item">
                📄 {name}
                <button
                  onClick={() =>
                    uploadFile(
                      selectedFolder.id,
                      path.join(selectedFolder.folderPath, name)
                    )
                  }
                >
                  업로드
                </button>
                <button
                  onClick={() =>
                    downloadFolderFile(selectedFolder.id, name)
                  }
                >
                  다운로드
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
