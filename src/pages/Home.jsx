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
import os from 'os';
import path from 'path';



/**
 * 백엔드-저장 절대경로(예: "/Users/oldUser/XOR/A/MyDocs/latest/MyDocs")
 * 를 “최종 사용자 머신”의 홈 디렉터리 구조에 맞게 다시 계산하는 함수.
 * 최상위 폴더 이름(여기서는 “MyDocs”)만 뽑아서 userDir/MyDocs 로 재구성.
 */
function computeLocalPathFromServerPath(serverPath, userDir) {
  if (!serverPath || !userDir) return null;
  // serverPath 예시:
  //    "/Users/oldUser/XOR/A/MyDocs/latest/MyDocs"
  // 우선 baseName 을 뽑으면 “MyDocs”가 나옴
  const folderName = path.basename(serverPath);
  // localPath 는 “/Users/currentMachine/XOR/A/MyDocs”
  return path.join(userDir, folderName);
}

/**
 * 서버-메타 데이터에 포함되어 있던 raw relativePath(예: "sub/foo.txt/latest/foo.txt")
 * 에서 “latest”와 중복된 파일명 부분을 제거해서 진짜 경로("sub/foo.txt")로 만드는 헬퍼
 */
function normalizeRelPath(raw) {
  if (!raw) return raw;
  const parts = raw.split('/');
  // latest가 중간에 끼어있고, 그 다음 이름이 원본 파일명과 같다면
  const latestIndex = parts.indexOf('latest');
  if (latestIndex > 0 && parts[latestIndex + 1] === parts[latestIndex - 1]) {
    // latest와 그 뒤의 중복 파일명을 제거
    parts.splice(latestIndex); // 'latest' 이후 전부 제거
  }
  return parts.join('/');
}

export default function Home() {
  const navigate = useNavigate();

  const username = localStorage.getItem('currentUser') || 'User';
  const xorUser = localStorage.getItem('xorUser');
  // **절대경로 대신 항상 os.homedir() 기반으로 재계산**
  const userDir = xorUser
  ? path.join(os.homedir(), 'XOR', xorUser)
  : null;

  // --- ① 서버에서 받아온 “원본” folder 객체 리스트 (각 객체에 id, folderPath 등이 포함되어 옴)  
  const [rawFolders, setRawFolders] = useState([]);

  // --- ② 화면에 렌더링할 때는 “실제 로컬 경로(localPath)”를 포함시킨 리스트로 변환 
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
        // 1) 백엔드로부터 등록된 모든 sync 폴더 리스트 받아옴
        const data = await getSyncFolder();
        const allFolders = Array.isArray(data) ? data : [];

        // 2) 이 계정(xorUser)과 연결된 항목만 선별
        //    (백엔드에 저장된 folderPath 는 모든 계정(다른 머신 포함)의 절대경로가 있을 수 있음)
        //    → 폴더 이름만 뽑아서, userDir/MyFolderName 구조로 다시 localPath 재계산
        const userSyncFolders = allFolders
          .filter(folder => {
            // 예: backend folder.folderPath: "/Users/oldUser/XOR/A/MyDocs"
            //    thisUserDir: "/Users/currentMachine/XOR/A"
            //    여기서는 “서버상 어딘가에 A 계정 폴더 구조” 로만 분리하기 위해
            //    path.sep + xorUser + path.sep 이 포함되어 있는지로 필터
            return folder.folderPath.includes(path.join('XOR', xorUser, path.sep));
          })
          .map(folder => {
            const localPath = computeLocalPathFromServerPath(folder.folderPath, userDir);
            // 화면에서 쓸 수 있도록 필요한 데이터를 정리해서 반환
            return {
              id: folder.id,
              serverPath: folder.folderPath, // 디버깅/참조용
              localPath,                     // 실제 로컬 입출력에 사용할 절대경로
              folderName: path.basename(folder.folderPath),
            };
          });

        setRawFolders(allFolders);
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
    // (async () => {
    //   try {
    //     const data = await getSyncFolder();
    //     // 기존 동기화 폴더 목록
    //     const allFolders = Array.isArray(data) ? data : [];
    //     // 사용자 계정 폴더 내의 동기화 폴더만 필터링
    //     const userSyncFolders = allFolders.filter(folder => folder.folderPath.startsWith(userDir));
    //     setSyncFolders(userSyncFolders);

    //   } catch (err) {
    //     if (err.message.startsWith('HTTP 403')) {
    //       localStorage.removeItem('token');
    //       alert('세션이 만료되었습니다. 다시 로그인 해주세요.');
    //       navigate('/');
    //     } else {
    //       console.error('폴더 목록 로드 오류:', err);
    //       alert('폴더 목록을 불러오지 못했습니다.');
    //     }
    //   }
    // })();

    // IPC로 삭제 알림 구독
    const onRemoved = (_e, { folderId }) => {
      setSyncFolders(prev => prev.filter(f => f.id !== folderId));
    };
    ipcRenderer.on('sync-folder-removed', onRemoved);

    // 추가 이벤트
    const onAdded = (_e, folder) => {
      // 백엔드가 보낸 folder.folderPath 는 절대경로(이전 머신 경로)일 수 있음
      // → 고유 ID는 같으므로, rawFolders 에서 동일 ID 있으면 건너뜀
      if (rawFolders.some(f => f.id === folder.id)) return;

      // 새로 rawFolders에 추가
      setRawFolders(prev => [...prev, folder]);

      // 해당 폴더가 이 계정(xorUser) 소속인지 확인
      if (!folder.folderPath.includes(path.join('XOR', xorUser, path.sep))) return;

      // 새로 localPath 계산
      const newLocalPath = computeLocalPathFromServerPath(folder.folderPath, userDir);
      setSyncFolders(prev => [
        ...prev,
        { id: folder.id, serverPath: folder.folderPath, localPath: newLocalPath, folderName: path.basename(folder.folderPath) }
      ]);
    };
    ipcRenderer.on('dosync-folder-added', onAdded);    
    // const onAdded = (_e, folder) => {

    //   if (!folder.folderPath.startsWith(userDir)) return;
    //   setSyncFolders(prev => {
    //     // 이미 같은 ID 가 있으면 아무 동작도 안 함
    //     if (prev.some(f => f.id === folder.id)) {
    //       return prev;
    //     }
    //     return [...prev, folder];
    //   });

    // };
    // ipcRenderer.on('dosync-folder-added', onAdded);


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

    // ② 현재 머신 userDir(~/XOR/{xorUser})이 없다면 생성
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    // ③ 선택된 폴더 이름만 따와서 userDir 아래에 동일한 이름으로 복사할 대상 경로 생성
    const folderName = path.basename(sel);
    const targetDir  = path.join(userDir, folderName);

    // ④ 이미 같은 이름으로 등록된 적 있으면 무시
    if (syncFolders.some(f => f.folderPath === targetDir)) {
      console.warn('이미 등록된 폴더:', targetDir);
      return;
    }    


    // ⑤ “방금 추가된” 표시를 위해 IPC로 알림 (SyncManager 쪽에서 로컬 watcher를 무시하게 함)
    ipcRenderer.send('local-folder-added', targetDir); // 무조건 보냄

    // ⑥ userDir 아래로 실제 파일 복사
    fs.mkdirSync(targetDir, { recursive: true });
    copyRecursive(sel, targetDir);

    try {
      // ⑦ 백엔드에 등록할 때는 targetDir(이 클라이언트 절대경로)을 사용
      const created = await sendSyncFolder(targetDir);

      // ⑧ 로컬 메타 데이터 생성 (초기 sync용)
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

      // ⑨ 백엔드와 비교하여 업로드/다운로드 리스트 받아오기
      const { filesToUpload = [], filesToDownload = [] } =
        await syncFolder(created.id, clientFiles, []);

      // ⑩ 업로드해야 할 파일들 백엔드로 전송
      for (const name of filesToUpload) {
        await uploadFile(
          created.id,
          path.join(targetDir, name),
          name
        );
      }
      // ⑪ 다운로드해야 할 파일들 로컬에 저장
      for (const name of filesToDownload) {
        const blob = await downloadFolderFile(created.id, name);
        const buf  = await blob.arrayBuffer();
        fs.writeFileSync(path.join(targetDir, name), Buffer.from(buf));
      }

      // ⑫ 폴더 목록 갱신
      const refreshed = await getSyncFolder();
      // rawFolders와 syncFolders 모두 다시 재계산
      setRawFolders(Array.isArray(refreshed) ? refreshed : []);
      const userSyncFolders = (Array.isArray(refreshed) ? refreshed : [])
        .filter(f => f.folderPath.includes(path.join('XOR', xorUser, path.sep)))
        .map(f => {
          return {
            id: f.id,
            serverPath: f.folderPath,
            localPath: computeLocalPathFromServerPath(f.folderPath, userDir),
            folderName: path.basename(f.folderPath),
          };
        });
      setSyncFolders(userSyncFolders);      
      // setSyncFolders(Array.isArray(refreshed) ? refreshed : []);
      // 이 경로는 SyncManager 쪽에서 무시해야 할 “방금 추가된” 경로

      // ⑬ SyncManager 쪽에 방금 추가된 사실 전달
      ipcRenderer.send('flag-folder-added', created);
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
  // const onDoubleClick = folder =>
  //   navigate(`/folder/${folder.id}`, { state:{ folderPath: folder.folderPath }});
  const onDoubleClick = (folder) => {
    // folder.localPath 를 props로 넘김
    navigate(`/folder/${folder.id}`, { state:{ folderPath: folder.serverPath }});
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
  // const targetDir = folder.folderPath;
  const targetDir = folder.localPath;
  if (fs.existsSync(targetDir)) {
    alert('이미 로컬에 폴더가 존재합니다.');
    return setCtxMenu(m => ({ ...m, visible: false }));
  }

  try {
    // ② 빈 디렉터리 생성
    fs.mkdirSync(targetDir, { recursive: true });

     // ③ 서버에서 “latest” 파일 목록 받아오기
    const rawServerList = await getFolderFileList(folderId);
    const fileEntries = rawServerList.filter(f =>
      f.type === 'file' &&
      (f.relativePath || f.originalName).includes('/latest/')
    );

    // ④ 서버 메타 → 실제 하위 경로(relPath) 계산
    const serverFiles = fileEntries.map(f => {
      const rawPath = f.relativePath || f.originalName;           // ex: "sub/foo.txt/latest/foo.txt"
      const relPath = normalizeRelPath(rawPath);                  // ex: "sub/foo.txt"
      return {
        rawPath,
        relPath,
        lastModified: f.lastModified,
      };
    });

    // ⑤ “진짜 서브폴더” 목록 뽑아서 먼저 생성
    const folderNames = new Set();
    for (const { relPath } of serverFiles) {
      const parts = relPath.split('/');
      if (parts.length > 1) folderNames.add(parts[0]);
    }
    for (const sub of folderNames) {
      const absDir = path.join(targetDir, sub);
      fs.mkdirSync(absDir, { recursive: true });
    }

    // ⑥ 파일 다운로드 및 mtime 동기화
    for (const { rawPath, relPath, lastModified } of serverFiles) {
      const name = path.basename(relPath);
      if (name.startsWith('.')) continue;  // 숨김파일 스킵

      try {
        console.warn(`🌐 폴더 내 파일 다운로드: ${rawPath}`);
        const blob = await downloadFolderFile(folderId, rawPath);
        const buf  = await blob.arrayBuffer();
        const dest = path.join(targetDir, relPath);

        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(buf));

        // mtime 동기화
        const mtime = new Date(lastModified).getTime() / 1000;
        fs.utimesSync(dest, mtime, mtime);
      } catch (e) {
        console.warn(`⚠️ 다운로드 실패(무시): ${rawPath}`, e.message);
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
    // 백엔드에서 삭제 요청
    await deleteSyncFolder(ctxMenu.folderId);
    const refreshed = await getSyncFolder();
    setSyncFolders(Array.isArray(refreshed)?refreshed:[]);

    // 삭제 후 다시 syncFolders 계산
    const userSyncFolders = (Array.isArray(refreshed) ? refreshed : [])
      .filter(f => f.folderPath.includes(path.join('XOR', xorUser, path.sep)))
      .map(f => ({
        id: f.id,
        serverPath: f.folderPath,
        localPath: computeLocalPathFromServerPath(f.folderPath, userDir),
        folderName: path.basename(f.folderPath),
      }));
    setSyncFolders(userSyncFolders);

    // SyncManager 쪽에 삭제 알림
    const toDel = syncFolders.find(f => f.id === ctxMenu.folderId);
    if (toDel) {
      ipcRenderer.send('sync-folder-removed', {
        folderId:   ctxMenu.folderId,
        folderPath: toDel.serverPath
      });
    }

    // // → 바로 SyncManager에게도 알려주기
    // {
    //   // 삭제 직전에, 현재 띄워진 syncFolders 배열에서 해당 folderPath를 찾아서
    //   const toDel = syncFolders.find(f => f.id === ctxMenu.folderId);
    //   ipcRenderer.send('sync-folder-removed', {
    //     folderId:   ctxMenu.folderId,
    //     folderPath: toDel?.folderPath   // Home 리스트의 folderPath
    //   });
    // }


    setCtxMenu(m=>({ ...m, visible:false }));
  };

  // --- 4) 유저 메뉴 (기존 로직) ---
  const [userMenu, setUserMenu] = useState({ visible:false, x:0, y:0 });
  const showUserMenu           = e => { e.preventDefault(); setUserMenu({ visible:true, x:e.clientX, y:e.clientY }); };
  const closeUserMenu          = () => setUserMenu(m=>({ ...m, visible:false }));
  const handleLogout = () => {
    if (confirm('로그아웃?')) {
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