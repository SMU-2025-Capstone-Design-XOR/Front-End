// src/pages/Home.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, MenuItem, getCurrentWindow } from '@electron/remote';
import { dialog } from '@electron/remote';
import { Buffer } from 'buffer';

import createSync from '../assets/Home/create-sync.svg';
import syncIcon   from '../assets/Home/sync.svg';
import '../css/home.css';

import FolderContextMenu from '../components/FolderContextMenu';
import { UserContextMenu } from '../components/UserContextMenu';

import {
  getSyncFolder,
  deleteSyncFolder,
  getFolderFileList,
  downloadFolderFile,
} from '../apiService';

const { ipcRenderer } = window.require('electron');
const fs = window.require('fs');
import os from 'os';
import path from 'path';

/**
 * 서버의 폴더 목록에 "이 기기에서의 위치(localPath)"를 붙여 화면용 목록을 만든다.
 * 위치는 main 프로세스의 동기화 엔진이 기억한다: 폴더를 등록한 기기는 고른 경로,
 * 다른 기기는 ~/XOR/{사용자명}/{폴더 이름}. 엔진이 아직 연결하기 전이면 기본 위치로 계산한다.
 * 폴더 이름은 path.basename(folderPath)가 아니라 서버가 내려주는 name을 쓴다.
 */
function toViewFolders(serverFolders, engineFolders, userDir) {
  return serverFolders.map(folder => {
    const folderName = folder.name || path.basename(folder.folderPath || '');
    const linked = engineFolders.find(f => Number(f.id) === Number(folder.id));
    return {
      id: folder.id,
      serverPath: folder.folderPath, // 처음 등록한 기기의 경로 (참고용)
      localPath: linked ? linked.localRoot : path.join(userDir, folderName),
      folderName,
    };
  });
}

export default function Home() {
  const navigate = useNavigate();

  const username = localStorage.getItem('currentUser') || 'User';
  const xorUser = localStorage.getItem('xorUser');
  // **절대경로 대신 항상 os.homedir() 기반으로 재계산**
  const userDir = xorUser
  ? path.join(os.homedir(), 'XOR', xorUser)
  : null;

  // 화면에 렌더링할 폴더 목록 ({ id, serverPath, localPath, folderName })
  const [syncFolders, setSyncFolders] = useState([]);

  // 서버의 폴더 목록 + 엔진이 기억하는 로컬 위치를 다시 읽는다
  const reloadFolders = async () => {
    const data = await getSyncFolder();
    const allFolders = Array.isArray(data) ? data : [];
    const engineFolders = await ipcRenderer.invoke('sync:folders');
    const view = toViewFolders(allFolders, engineFolders, userDir);
    setSyncFolders(view);
    return view;
  };

  useEffect(() => {
    if (!userDir) {
      alert('로그아웃 됩니다.');
      navigate('/');
      return;
    }

    (async () => {
      try {
        // 등록된 모든 sync 폴더는 이 계정의 것이다 (다른 기기에서 등록한 폴더 포함)
        await reloadFolders();
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

    // 엔진이 알려 주는 폴더 변화: 서버에서 삭제됨 / 다른 기기가 등록한 폴더가 연결됨
    const onRemoved = (_e, { folderId }) => {
      setSyncFolders(prev => prev.filter(f => f.id !== folderId));
    };
    ipcRenderer.on('sync-folder-removed', onRemoved);

    const onAdded = () => {
      reloadFolders().catch(err => console.error('폴더 목록 갱신 오류:', err));
    };
    ipcRenderer.on('dosync-folder-added', onAdded);

    return () => {
      ipcRenderer.removeListener('sync-folder-removed', onRemoved);
      ipcRenderer.removeListener('dosync-folder-added', onAdded);
    };

  }, [userDir, navigate]);


  // 2) “싱크 폴더 추가” 버튼 핸들러
  const handleSelectFolder = async () => {
    // ① Electron 다이얼로그로 폴더 선택
    const sel = await ipcRenderer.invoke('open-folder-dialog');
    if (!sel) return;

    try {
      // ② 고른 폴더를 그대로 등록한다(복사하지 않는다). 등록·초기 점검·업로드는 main 프로세스의 엔진이 한다.
      const result = await ipcRenderer.invoke('sync:register-folder', sel);
      if (!result.ok) {
        if (result.status === 409) {
          // 같은 이름의 폴더가 이미 있다. 다른 기기에서 등록한 폴더는 목록에 이미 연결돼 있다.
          const name = result.current?.name || path.basename(sel);
          alert(`같은 이름의 폴더가 이미 등록되어 있습니다: ${name}`);
        } else {
          console.error('폴더 등록 실패:', result);
          alert('폴더 등록 중 오류가 발생했습니다.\n' + (result.message || ''));
        }
        return;
      }

      // ③ 폴더 목록 갱신
      await reloadFolders();
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
  const onDoubleClick = (folder) => {
    // 이 기기에서의 위치(localPath)와 폴더 이름을 함께 넘긴다
    navigate(`/folder/${folder.id}`, {
      state: { folderPath: folder.serverPath, localPath: folder.localPath, folderName: folder.folderName }
    });
  };
  const handleInfo   = () => { alert(`Folder ID: ${ctxMenu.folderId}`); setCtxMenu(m=>({ ...m, visible:false })); };

  const handleRedown = async () => {
  const folderId = ctxMenu.folderId;
  const folder   = syncFolders.find(f => f.id === folderId);
  if (!folder) {
    alert('폴더 정보를 찾을 수 없습니다.');
    return setCtxMenu(m => ({ ...m, visible: false }));
  }
  // ① localPath 에 이미 존재하면 무시
  const targetDir = folder.localPath;
  if (fs.existsSync(targetDir)) {
    alert('이미 로컬에 폴더가 존재합니다.');
    return setCtxMenu(m => ({ ...m, visible: false }));
  }

  try {
    // ② 빈 디렉터리 생성
    fs.mkdirSync(targetDir, { recursive: true });

    // ③ 서버의 파일 목록 (relativePath는 실제 상대 경로)
    const rawServerList = await getFolderFileList(folderId);
    const serverFiles = rawServerList.filter(f => f.type === 'file');

    // ④ 파일 다운로드 (하위 디렉터리는 깊이에 상관없이 만든다)
    for (const { relativePath } of serverFiles) {
      const name = path.basename(relativePath);
      if (name.startsWith('.')) continue;  // 숨김파일 스킵

      try {
        const blob = await downloadFolderFile(folderId, relativePath);
        const buf  = await blob.arrayBuffer();
        const dest = path.join(targetDir, relativePath);

        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(buf));
      } catch (e) {
        console.warn(`⚠️ 다운로드 실패(무시): ${relativePath}`, e.message);
      }
    }

    alert('폴더 재다운로드가 완료되었습니다.');
  } catch (err) {
    console.error('폴더 재다운로드 실패:', err);
    alert('폴더 재다운로드 중 오류가 발생했습니다.');
  } finally {
    setCtxMenu(m => ({ ...m, visible: false }));
  }
};


  const handleDelete = async () => {
    if (!confirm('삭제하시겠습니까?')) return setCtxMenu(m=>({ ...m, visible:false }));
    try {
      // 백엔드에서 삭제 요청 (서버의 파일·버전 기록이 지워진다. 로컬 폴더는 그대로 둔다)
      await deleteSyncFolder(ctxMenu.folderId);
      // 엔진의 감시를 멈추고 상태 파일을 지운다
      await ipcRenderer.invoke('sync:remove-folder', ctxMenu.folderId);
      await reloadFolders();
    } catch (err) {
      console.error('폴더 삭제 실패:', err);
      alert('폴더 삭제 중 오류가 발생했습니다.');
    }

    setCtxMenu(m=>({ ...m, visible:false }));
  };

  // --- 4) 유저 메뉴 (기존 로직) ---
  const [userMenu, setUserMenu] = useState({ visible:false, x:0, y:0 });
  const showUserMenu           = e => { e.preventDefault(); setUserMenu({ visible:true, x:e.clientX, y:e.clientY }); };
  const closeUserMenu          = () => setUserMenu(m=>({ ...m, visible:false }));
  const handleLogout = () => {
    if (confirm('로그아웃?')) {
      // 동기화 엔진을 멈춘다
      ipcRenderer.invoke('sync:stop');
      // xorUser 만 지워도 충분합니다
      localStorage.removeItem('xorUser');
      localStorage.removeItem('token');
      localStorage.removeItem('currentUser');
      localStorage.removeItem('rememberedUsername');

      navigate('/');
    }
  };

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
        {/* “백업 폴더 추가” 버튼 */}
          <div className="sync-wrapper" onClick={handleSelectFolder}>
          <img src={createSync} alt=""/>
          <div className="sync-label">백업 폴더 추가</div>
        </div>
        {
          // 화면에 출력할 때만 가나다순으로 정렬해서 보여주도록, 원본 state는 건드리지 않는다.
          [...syncFolders]
            // .sort((a, b) => {
            //   const nameA = a.folderPath.split('/').pop().toLowerCase();
            //   const nameB = b.folderPath.split('/').pop().toLowerCase();
            //   return nameA.localeCompare(nameB);
            // })
            .sort((a, b) => a.folderName.toLowerCase().localeCompare(b.folderName.toLowerCase()))
            .map(folder => (
              <div
                key={folder.id}
                className="sync-wrapper"
                onDoubleClick={() => onDoubleClick(folder)}
                onContextMenu={showCtx(folder.id)}
              >
                <img src={syncIcon} alt=""/>
                {/* <div className="sync-label">{folder.folderPath.split('/').pop()}</div> */}
                <div className="sync-label">{folder.folderName}</div>
              </div>
            ))
        }
      </div>

      {/* FolderContextMenu */}
      <FolderContextMenu
        visible={ctxMenu.visible}
        x={ctxMenu.x} y={ctxMenu.y}
        onInfo={handleInfo}
        // onRedown={handleRedown}
        onDelete={handleDelete}
        onClose={closeUserMenu}
      />
    </div>
  );
}

