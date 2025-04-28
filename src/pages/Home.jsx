// src/pages/Home.jsx
// 로그인 후 홈화면 진입

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, MenuItem, getCurrentWindow } from '@electron/remote';
import crypto from 'crypto';
import mime from 'mime-types';
import FolderContextMenu from '../components/FolderContextMenu';

import createSync from '../assets/Home/create-sync.svg';
import syncIcon   from '../assets/Home/sync.svg';
import folderIcon from '../assets/Home/folder.svg';
import personIcon from '../assets/Home/person-24.svg';
import '../css/home.css';

import {
    sendSyncFolder,
    getSyncFolder,
    deleteSyncFolder,
    syncFolder,              // <-- 변경
    getFolderFileList,
    getFolderFileMeta,       // <-- 추가
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
  // 2) New Sync: 폴더 선택 → 서버 등록 → 메타→ sync → 필요한 파일 업로드 → 폴더 목록 갱신
  const handleSelectFolder = async () => {
    const sel = await ipcRenderer.invoke('open-folder-dialog');
    if (!sel) return;

    try {
      // 1) 서버에 폴더 등록 → created.id 반환
      const created = await sendSyncFolder(sel);

      // 2) 로컬 메타 수집 (SHA-256, mime 포함)
      const filesMeta = fs.readdirSync(sel)
        .filter(name => fs.statSync(path.join(sel, name)).isFile())
        .map(fileName => {
          const fullPath = path.join(sel, fileName);
          const stat     = fs.statSync(fullPath);

          const buffer   = fs.readFileSync(fullPath);
          const hashSum  = crypto.createHash('sha256');
          hashSum.update(buffer);
          const fileHash = hashSum.digest('hex');

          const fileMime = mime.lookup(fullPath) || 'application/octet-stream';

          return {
            originalName:  fileName,
            relativePath:  fileName,
            size:          stat.size,
            hash:          fileHash,
            mimeType:      fileMime,
            createdAt:     new Date(stat.birthtime).toISOString(),
            lastModified:  new Date(stat.mtimeMs).toISOString(),
            lastSyncTime:  new Date().toISOString()
          };
        });

      // 3) 서버에 메타 동기화 → 어떤 파일을 업로드해야 할지 응답으로 받음
      const syncResult = await syncFolder(created.id, filesMeta, []);
      // 예: syncResult.filesToUpload = ['a.txt','b.docx'], syncResult.filesToDownload = [...]

      // 4) 서버에 없는 파일 실제 업로드
      if (Array.isArray(syncResult.filesToUpload)) {
        for (const fileName of syncResult.filesToUpload) {
          const localPath = path.join(sel, fileName);
          await uploadFile(created.id, localPath);
        }
      }

      // 5) (옵션) 서버에서 내려받을 파일이 있으면 다운로드 처리
      // if (Array.isArray(syncResult.filesToDownload)) {
      //   for (const fileName of syncResult.filesToDownload) {
      //     await downloadFolderFile(created.id, fileName);
      //   }
      // }

      // 6) 최종 폴더 목록 갱신
      const data = await getSyncFolder();
      setSyncFolders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('동기화 오류:', err.message);
      alert('폴더 등록 또는 동기화 중 오류');
    }
  };


  // 3) 폴더 열기 → 파일 리스트 불러오기
  const openFolder = async (folder) => {
    setSelectedFolder(folder);
    try {
      const files = await getFolderFileList(folder.id);
      if (Array.isArray(files)) {
        // API가 메타 객체를 돌려주면 originalName으로, 
        // 그냥 문자열을 돌려주면 그대로 사용
        const names = files.map(f =>
          typeof f === 'string' ? f : (f.originalName || f.relativePath)
        );
        setFileList(names);
      } else {
        setFileList([]);
      }
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
      //  예시: 첫 번째 파일 메타
      //const data = await getFolderFileMeta(ctxMenu.folderId, fileList[0] || '');

      // 실제 API로 메타데이터 조회 (여기서는 첫 번째 파일 예시)
      const data= await getFolderFileMeta(ctxMenu.folderId, fileList[0] || '');

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
