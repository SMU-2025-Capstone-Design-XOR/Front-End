// src/pages/Home.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, MenuItem, getCurrentWindow } from '@electron/remote';
import crypto from 'crypto';
import mime from 'mime-types';
import { dialog } from '@electron/remote';
import { Buffer } from 'buffer';

import createSync from '../assets/Home/create-sync.svg';
import syncIcon   from '../assets/Home/sync.svg';
import folderIcon from '../assets/Home/folder.svg';
import personIcon from '../assets/Home/person-24.svg';
import '../css/home.css';

import FolderContextMenu from '../components/FolderContextMenu';
import { UserContextMenu } from '../components/UserContextMenu';

import {
  sendSyncFolder,
  getSyncFolder,
  deleteSyncFolder,
  syncFolder,
  getFolderFileList,
  uploadFile,
  downloadFolderFile,
} from '../apiService';

const { ipcRenderer } = window.require('electron');
const fs     = window.require('fs');
const path   = window.require('path');

export default function Home() {
  const navigate = useNavigate();
  const username = localStorage.getItem('currentUser') || 'User';

  // 등록된 싱크 폴더 목록
  const [syncFolders, setSyncFolders] = useState([]);

  // fs.watch 인스턴스 저장용
  const watchersRef = useRef({});

  useEffect(() => {
    (async () => {
      try {
        const data = await getSyncFolder();
        setSyncFolders(Array.isArray(data) ? data : []);
      } catch (err) {
        if (err.message.startsWith('HTTP 403')) {
          localStorage.removeItem('token');
          alert('세션이 만료되었습니다. 다시 로그인 해주세요.');
          navigate('/');
        } else {
          console.error(err);
          alert('싱크 폴더 목록 로드 실패');
        }
      }
    })();    
  }, []);

  // 2) “싱크 폴더 추가” 버튼 핸들러
  const handleSelectFolder = async () => {
    const sel = await ipcRenderer.invoke('open-folder-dialog');
    if (!sel) return;
    try {
      // 1) 폴더 경로만 서버에 등록 → 생성된 ID 받기
      const created = await sendSyncFolder(sel);

      // 2) 로컬 파일 메타 수집
      const clientFiles = fs.readdirSync(sel)
        .filter(name => fs.statSync(path.join(sel, name)).isFile())
        .map(name => {
          const full = path.join(sel, name);
          const stat = fs.statSync(full);
          const hash = crypto.createHash('sha256')
                             .update(fs.readFileSync(full))
                             .digest('hex');
          return {
            originalName: name,
            relativePath: name,
            size: stat.size,
            hash,
            mimeType: mime.lookup(full) || 'application/octet-stream',
            lastModified: new Date(stat.mtimeMs).toISOString()
          };
        });

      // 3) syncFolder API 로 초기 동기화 요청 (업/다운 대상 리턴)
      const { filesToUpload = [], filesToDownload = [] } =
        await syncFolder(created.id, clientFiles, []);

      // 4) 업로드해야 할 파일들 전부 업로드
      for (const name of filesToUpload) {
        await uploadFile(created.id, path.join(sel, name));
      }

      // 5) 다운로드해야 할 파일들 전부 다운로드
      for (const name of filesToDownload) {
        const blob = await downloadFolderFile(created.id, name);
        const buf  = await blob.arrayBuffer();
        fs.writeFileSync(path.join(sel, name), Buffer.from(buf));
      }

      // 6) 완료 후 단순히 목록만 갱신 (홈 화면에 카드 추가)
      const refreshed = await getSyncFolder();
      setSyncFolders(Array.isArray(refreshed) ? refreshed : []);
      // SyncManager에도 업데이트 알림
      // ipcRenderer.send('sync-folders-updated');
    } catch (err) {
      console.error('폴더 등록/동기화 실패:', err);
      alert('폴더 등록 또는 동기화 중 오류가 발생했습니다.');
    }
  };

  // --- 3) 폴더 카드 이벤트 & 메뉴 (기존 로직) ---
  const [ctxMenu, setCtxMenu]     = useState({ visible:false, x:0, y:0, folderId:null });
  const showCtx = id => e => {
    e.preventDefault();
    setCtxMenu({ visible:true, x:e.clientX, y:e.clientY, folderId:id });
  };
  const onDoubleClick = folder =>
    navigate(`/folder/${folder.id}`, { state:{ folderPath: folder.folderPath }});
  const handleInfo   = () => { alert(`Folder ID: ${ctxMenu.folderId}`); setCtxMenu(m=>({ ...m, visible:false })); };
  const handleDelete = async () => {
    if (!confirm('삭제하시겠습니까?')) return setCtxMenu(m=>({ ...m, visible:false }));
    await deleteSyncFolder(ctxMenu.folderId);
    const refreshed = await getSyncFolder();
    setSyncFolders(Array.isArray(refreshed)?refreshed:[]);
    // SyncManager에도 업데이트 알림
    // ipcRenderer.send('sync-folders-updated');
    setCtxMenu(m=>({ ...m, visible:false }));
  };

  // --- 4) 유저 메뉴 (기존 로직) ---
  const [userMenu, setUserMenu] = useState({ visible:false, x:0, y:0 });
  const showUserMenu           = e => { e.preventDefault(); setUserMenu({ visible:true, x:e.clientX, y:e.clientY }); };
  const closeUserMenu          = () => setUserMenu(m=>({ ...m, visible:false }));
  const handleLogout           = () => { if (confirm('로그아웃?')) { localStorage.clear(); navigate('/'); }};

  return (
    <div className="home">
      {/* 헤더 */}
      <div className="header">
        <div className="folder-icon"/>
        <div className="header-title">HOME</div>
        <div className="username">{username}</div>
        <div className="person-icon" onContextMenu={showUserMenu}/>
        {userMenu.visible && (
          <UserContextMenu
            x={userMenu.x} y={userMenu.y}
            onLogout={handleLogout} onClose={closeUserMenu}
          />
        )}
      </div>

      {/* New Sync + Folder List */}
      <div className="home-main">
          <div className="sync-wrapper" onClick={handleSelectFolder}>
          <img src={createSync} alt=""/>
          <div className="sync-label">싱크 폴더 추가</div>
        </div>
        {syncFolders.map(folder => (
          <div
            key={folder.id}
            className="sync-wrapper"
            onDoubleClick={()=>onDoubleClick(folder)}
            onContextMenu={showCtx(folder.id)}
          >
            <img src={syncIcon} alt=""/>
            <div className="sync-label">{folder.folderPath.split('/').pop()}</div>
          </div>
        ))}
      </div>

      {/* FolderContextMenu */}
      <FolderContextMenu
        visible={ctxMenu.visible}
        x={ctxMenu.x} y={ctxMenu.y}
        onInfo={handleInfo} onDelete={handleDelete}
      />
    </div>
  );
}
