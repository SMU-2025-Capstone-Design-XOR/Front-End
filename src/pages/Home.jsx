// src/pages/Home.jsx
// 로그인 후 홈화면 진입

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, MenuItem, getCurrentWindow } from '@electron/remote';
import crypto from 'crypto';
import mime from 'mime-types';
import { dialog  } from 'electron';
import { Buffer } from 'buffer';


import createSync from '../assets/Home/create-sync.svg';
import syncIcon   from '../assets/Home/sync.svg';
import folderIcon from '../assets/Home/folder.svg';
import personIcon from '../assets/Home/person-24.svg';
import '../css/home.css';


import FolderContextMenu from '../components/FolderContextMenu';
import { UserContextMenu  } from '../components/UserContextMenu';

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


  // 폴더 컨텍스트 메뉴(state) ── 변경 없음
  const [ctxMenu, setCtxMenu] = useState({ visible: false, x:0, y:0, folderId: null });
  // 사용자 컨텍스트 메뉴(state)
  const [userMenu, setUserMenu] = useState({ visible: false, x:0, y:0 });


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

      // 6) 최종 폴더 목록 갱신
      const data = await getSyncFolder();
      setSyncFolders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('동기화 오류:', err.message);
      alert('폴더 등록 또는 동기화 중 오류');
    }
  };

  // 앱 시작(또는 폴더 선택 직후)에 전체 스캔 후 동기화
   useEffect(() => {
     if (!selectedFolder) return;
     (async () => {
       try {
         // 전체 파일 메타수집
         const root = selectedFolder.folderPath;
         const filesMeta = fs.readdirSync(root)
           .filter(name => fs.statSync(path.join(root, name)).isFile())
           .map(fileName => {
             const fullPath = path.join(root, fileName);
             const stat     = fs.statSync(fullPath);
             const buf      = fs.readFileSync(fullPath);
             const hashSum  = crypto.createHash('sha256');
             hashSum.update(buf);
             const mimeType = mime.lookup(fullPath) || 'application/octet-stream';
             return {
               originalName: fileName,
               relativePath: fileName,
               size: stat.size,
               hash: hashSum.digest('hex'),
               mimeType,
               createdAt:    stat.birthtime.toISOString(),
               lastModified: stat.mtime.toISOString(),
               lastSyncTime: new Date().toISOString()
             };
           });
         // 전체 동기화
         await syncFolder(selectedFolder.id, filesMeta, []);
       } catch (e) {
         console.error('전체 동기화 오류:', e);
       }
     })();
   }, [selectedFolder]);



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
        // 이전 watcher 해제
        if (watcherRef.current) watcherRef.current.close();
        // 변경 감지 등록
        watcherRef.current = fs.watch(
          folder.folderPath,
          (eventType, filename) => {
            if (!filename) return;
            handleIncrementalSync(folder.id, folder.folderPath, filename);
          }
        );
      } else {
        setFileList([]);
      }
    } catch {
      alert('파일 목록 조회 실패');
    }
  };

    // fs.watch 인스턴스를 보관할 ref
    // const watcherRef = React.useRef(null);
    const watcherRef = useRef(null);
  
    // 변경 감지 후 증분 동기화 처리
    const handleIncrementalSync = async (folderId, folderPath, filename) => {
      try {
        const fullPath = path.join(folderPath, filename);
        // 삭제된 경우
        if (!fs.existsSync(fullPath)) {
          // TODO: 삭제된 파일 ID를 서버에서 미리 저장/조회해서 전송
          return;
        }
        // 1) 메타데이터 수집
        const stat = fs.statSync(fullPath);
        const buffer = fs.readFileSync(fullPath);
        const hashSum = crypto.createHash('sha256');
        hashSum.update(buffer);
        const fileHash = hashSum.digest('hex');
        const fileMime = mime.lookup(fullPath) || 'application/octet-stream';
  
        const meta = [{
          originalName: filename,
          relativePath: filename,
          size: stat.size,
          hash: fileHash,
          mimeType: fileMime,
          createdAt: new Date(stat.birthtime).toISOString(),
          lastModified: new Date(stat.mtimeMs).toISOString(),
          lastSyncTime: new Date().toISOString()
        }];
  
        // 2) sync API 호출 (증분 동기화)
        const result = await syncFolder(folderId, meta, []);
  
        // 3) 업로드/다운로드 처리
        if (Array.isArray(result.filesToUpload)) {
          for (const name of result.filesToUpload) {
            await uploadFile(folderId, path.join(folderPath, name));
          }
        }
        if (Array.isArray(result.filesToDownload)) {
          for (const name of result.filesToDownload) {
            // downloadFolderFile 만으로는 파일 저장이 안 되므로 간단히 alert
            alert(`새로운 파일이 서버에 있습니다: ${name}`);
          }
        }
  
        // 4) 충돌 해결
        if (Array.isArray(result.conflictFiles) && result.conflictFiles.length) {
          for (const conflict of result.conflictFiles) {
            const choice = window.prompt(
              `충돌 감지: ${conflict}\nkeepLocal or keepServer?`,
              'keepLocal'
            );
            if (choice === 'keepLocal') {
              await uploadFile(folderId, path.join(folderPath, conflict));
            } else if (choice === 'keepServer') {
              alert(`서버 파일을 덮어씁니다: ${conflict}`);
              // (실제 download 로직 추가)
            }
          }
        }
      } catch (e) {
        console.error('증분 동기화 오류:', e);
      }
    };


    // 4) 사용자 아이콘 우클릭 → 로그아웃 UI 띄우기
    const showUserMenu = e => {
      e.preventDefault();
      setUserMenu({ visible: true, x: e.clientX, y: e.clientY });
    };
  
    const closeUserMenu = () => setUserMenu(menu => ({ ...menu, visible: false }));
  
    const handleLogout = () => {
      if (window.confirm('로그아웃하시겠습니까?')) {
        localStorage.clear();
        navigate('/');
      }
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

  // 컴포넌트 언마운트 시 watcher 해제
  useEffect(() => {
    return () => {
      if (watcherRef.current) watcherRef.current.close();
    };
  }, []);

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

        {userMenu.visible && (
          <UserContextMenu
            x={userMenu.x}
            y={userMenu.y}
            onLogout={handleLogout}
            onClose={closeUserMenu}
          />
        )}
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


    </div>
  );
}
