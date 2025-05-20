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
const fs = window.require('fs');
const path = window.require('path');
const os = window.require('os');


export default function Home() {
  const navigate = useNavigate();
  const username = localStorage.getItem('currentUser') || 'User';
  const userDir = localStorage.getItem('userDir') || '';
  // 등록된 싱크 폴더 목록
  const [syncFolders, setSyncFolders] = useState([]);

  // fs.watch 인스턴스 저장용
  const watchersRef = useRef({});

  useEffect(() => {
    if (!userDir) {
      alert('로그아웃 됩니다.');
      navigate('/');
      return;
    }


    (async () => {
      try {
        const data = await getSyncFolder();
        // 기존 동기화 폴더 목록
        const allFolders = Array.isArray(data) ? data : [];
        // 사용자 계정 폴더 내의 동기화 폴더만 필터링
        const userSyncFolders = allFolders.filter(folder => folder.folderPath.startsWith(userDir));
        setSyncFolders(userSyncFolders);

      } catch (err) {
        if (err.message.startsWith('HTTP 403')) {
          localStorage.removeItem('token');
          alert('세션이 만료되었습니다. 다시 로그인 해주세요.');
          navigate('/');
        } else {
          console.error('폴더 목록 로드 오류:', err);
          alert('폴더 목록을 불러오지 못했습니다.');
        }
      }
    })();

    // IPC로 삭제 알림 구독
    const onRemoved = (_e, { folderId }) => {
      setSyncFolders(prev => prev.filter(f => f.id !== folderId));
    };
    ipcRenderer.on('sync-folder-removed', onRemoved);

    // 추가 이벤트
    const onAdded = (_e, folder) => {
      // if (folder.folderPath.startsWith(userDir)) {
      //   setSyncFolders(prev => [...prev, folder]);
      // }
      if (!folder.folderPath.startsWith(userDir)) return;
      setSyncFolders(prev => {
        // 이미 같은 ID 가 있으면 아무 동작도 안 함
        if (prev.some(f => f.id === folder.id)) {
          return prev;
        }
        return [...prev, folder];
      });

    };
    ipcRenderer.on('dosync-folder-added', onAdded);


    return () => {
      ipcRenderer.removeListener('sync-folder-removed', onRemoved);
      ipcRenderer.removeListener('dosync-folder-added', onAdded);
    };
    
  }, [userDir, navigate]);

  
  // 2) “싱크 폴더 추가” 버튼 핸들러
  const handleSelectFolder = async () => {
    const sel = await ipcRenderer.invoke('open-folder-dialog');
    if (!sel) return;

    // 1) XOR 루트 폴더 -> 사용자 계정 폴더
    const username = localStorage.getItem('currentUser') || 'User';
    const userDir = path.join(os.homedir(), 'XOR', username);

    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    // 2) 선택된 폴더 이름만 추출 → XOR 루트 아래에 디렉토리 생성
    const folderName = path.basename(sel);
    const targetDir  = path.join(userDir, folderName);

    // 이미 등록된 폴더는 무시
    if (syncFolders.some(f => f.folderPath === targetDir)) {
      console.warn('이미 등록된 폴더:', targetDir);
      return;
    }    

    if (!fs.existsSync(targetDir)) {
      ipcRenderer.send('local-folder-added', targetDir);
      fs.mkdirSync(targetDir, { recursive: true });
      copyRecursive(sel, targetDir);
    }
    // // ① 먼저 justAdded 세트에 등록 (SyncManager 가 로컬 watcher 에서 무시하도록)
    // ipcRenderer.send('local-folder-added', targetDir); // 무조건 보냄
    // fs.mkdirSync(targetDir, { recursive: true });
    // copyRecursive(sel, targetDir);

    try {
      // 3) 서버에 등록할 때는 targetDir 사용
      const created = await sendSyncFolder(targetDir);

      // 4) 로컬 메타 수집도 targetDir 에서
      const walkClientFiles = (root) => {
        const results = [];

        const walk = (currentDir) => {
          const entries = fs.readdirSync(currentDir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            const stat = fs.statSync(fullPath);
            if (entry.isFile()) {
              const buffer = fs.readFileSync(fullPath);
              const relativePath = path.relative(root, fullPath).replace(/\\/g, '/'); // 윈도우 호환
              const mimeType = mime.lookup(fullPath) || 'application/octet-stream';
              const hash = crypto.createHash('sha256').update(buffer).digest('hex');
              results.push({
                originalName: relativePath,
                relativePath: relativePath,
                size: stat.size,
                hash: hash,
                mimeType: mimeType,
                lastModified: new Date(stat.mtimeMs).toISOString(),
              });
            } else if (entry.isDirectory()) {
              walk(fullPath); // 하위 폴더 재귀 탐색
            }
          }
        };

        walk(root);
        return results;
      };

      const clientFiles = walkClientFiles(targetDir);      

      // 5) 초기 sync & 업/다운로드
      const { filesToUpload = [], filesToDownload = [] } =
        await syncFolder(created.id, clientFiles, []);
      for (const name of filesToUpload) {
        await uploadFile(
          created.id,
          path.join(targetDir, name),
          name
        );
      }
      for (const name of filesToDownload) {
        const blob = await downloadFolderFile(created.id, name);
        const buf  = await blob.arrayBuffer();
        fs.writeFileSync(path.join(targetDir, name), Buffer.from(buf));
      }

      // 6) 목록 갱신 & SyncManager에 알리기
      
      // const folders = Array.isArray(refreshed) ? refreshed : [];
      // setSyncFolders(prev => {
      //   // 이미 같은 ID가 있으면 무시
      //   if (prev.some(f => f.id === created.id)) return prev;
      //   // 아니면 전체 새 목록으로 덮어쓰기
      //   return folders;
      // });
      const refreshed = await getSyncFolder();
      setSyncFolders(Array.isArray(refreshed) ? refreshed : []);
      // 이 경로는 SyncManager 쪽에서 무시해야 할 “방금 추가된” 경로


      ipcRenderer.send('sync-folder-added', created);

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

  const handleRedown = async () => {
    try {
      const folderId = ctxMenu.folderId;
      const folder = syncFolders.find(f => f.id === folderId);
      if (!folder) {
        alert('폴더 정보를 찾을 수 없습니다.');
        return;
      }
  
      const targetDir = folder.folderPath;
  
      if (fs.existsSync(targetDir)) {
        alert('이미 로컬에 폴더가 존재합니다.');
        setCtxMenu(m => ({ ...m, visible: false }));
        return;
      }
  
      // 1) 로컬 폴더 생성
      fs.mkdirSync(targetDir, { recursive: true });
  
      try {
        // 2) 서버에서 파일 목록 조회
        const serverFiles = await getFolderFileList(folderId);
  
        // 3) 서버에서 최상위 폴더 구조만 생성 (서브폴더는 생성하지 않음)
        serverFiles
          .filter(f => f.relativePath.endsWith('/') && !f.relativePath.includes('/'))
          .forEach(f => {
            const dirPath = path.join(targetDir, f.relativePath);
            fs.mkdirSync(dirPath, { recursive: true });
          });
  
        // 4) 파일 다운로드
        for (const file of serverFiles) {
          const rel = file.relativePath;
  
          // // 디렉터리는 이미 생성되었으므로, 파일만 처리
          // if (rel.endsWith('/')) continue;

          // 서브폴더 내 파일은 무시
          if (rel.includes('/') && !rel.endsWith('/')) continue;          
  
          const destPath = path.join(targetDir, rel);
  
          try {
            const blob = await downloadFolderFile(folderId, rel);
            const buf = await blob.arrayBuffer();
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.writeFileSync(destPath, Buffer.from(buf));
          } catch (e) {
            console.warn(`⚠️ 파일 다운로드 실패(무시): ${rel}`, e.message);
          }
        }
  
        alert('폴더 재다운로드가 완료되었습니다.');
        setCtxMenu(m => ({ ...m, visible: false }));
  
      } catch (err) {
        console.error('파일 목록 불러오기 실패:', err);
        alert('서버에서 파일 목록을 불러오는 데 실패했습니다.');
        setCtxMenu(m => ({ ...m, visible: false }));
      }
  
    } catch (err) {
      console.error('폴더 재다운로드 실패:', err);
      alert('폴더 재다운로드 중 오류가 발생했습니다.');
      setCtxMenu(m => ({ ...m, visible: false }));
    }
  };
  
  const handleDelete = async () => {
    if (!confirm('삭제하시겠습니까?')) return setCtxMenu(m=>({ ...m, visible:false }));
    await deleteSyncFolder(ctxMenu.folderId);
    const refreshed = await getSyncFolder();
    setSyncFolders(Array.isArray(refreshed)?refreshed:[]);

    // → 바로 SyncManager에게도 알려주기
    // ipcRenderer.send('sync-folder-removed', { folderId: ctxMenu.folderId });
    {
      // 삭제 직전에, 현재 띄워진 syncFolders 배열에서 해당 folderPath를 찾아서
      const toDel = syncFolders.find(f => f.id === ctxMenu.folderId);
      ipcRenderer.send('sync-folder-removed', {
        folderId:   ctxMenu.folderId,
        folderPath: toDel?.folderPath   // Home 리스트의 folderPath
      });
    }


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
        <div className="header-title">XOR</div>
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
          <div className="sync-label">백업 폴더 추가</div>
        </div>
        {
          // 화면에 출력할 때만 가나다순으로 정렬해서 보여주도록, 원본 state는 건드리지 않는다.
          [...syncFolders]
            .sort((a, b) => {
              const nameA = a.folderPath.split('/').pop().toLowerCase();
              const nameB = b.folderPath.split('/').pop().toLowerCase();
              return nameA.localeCompare(nameB);
            })
            .map(folder => (
              <div
                key={folder.id}
                className="sync-wrapper"
                onDoubleClick={() => onDoubleClick(folder)}
                onContextMenu={showCtx(folder.id)}
              >
                <img src={syncIcon} alt=""/>
                <div className="sync-label">{folder.folderPath.split('/').pop()}</div>
              </div>
            ))
        }
        {/* {syncFolders.map(folder => (
          <div
            key={folder.id}
            className="sync-wrapper"
            onDoubleClick={()=>onDoubleClick(folder)}
            onContextMenu={showCtx(folder.id)}
          >
            <img src={syncIcon} alt=""/>
            <div className="sync-label">{folder.folderPath.split('/').pop()}</div>
          </div>
        ))} */}
      </div>

      {/* FolderContextMenu */}
      <FolderContextMenu
        visible={ctxMenu.visible}
        x={ctxMenu.x} y={ctxMenu.y}
        onInfo={handleInfo}
        onRedown={handleRedown}
        onDelete={handleDelete}
        onClose={closeUserMenu}
      />
    </div>
  );
}

// 간단한 재귀 복사 헬퍼 (Node 16+ 이시면 fs.cpSync 사용하셔도 됩니다)
function copyRecursive(src, dest) {
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to   = path.join(dest, name);
    const stat = fs.statSync(from);
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyRecursive(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}