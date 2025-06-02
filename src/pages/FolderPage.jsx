// src/pages/FolderPage.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
// import { Menu, MenuItem, getCurrentWindow } from '@electron/remote';
// import { dialog } from '@electron/remote';
import { Menu, MenuItem, getCurrentWindow, dialog, clipboard } from '@electron/remote';
import chokidar from 'chokidar';
const { ipcRenderer } = window.require('electron');
import personIcon from '../assets/Home/person-24.svg';
import { UserContextMenu } from '../components/UserContextMenu';
import FolderContextMenu from '../components/SubFolderContextMenu';
import FileContextMenu from '../components/FileContextMenu';

import backroot from '../assets/InFolder/back-root.svg';
import subfold from '../assets/InFolder/sub.svg';
import filee from '../assets/InFolder/file.svg';
import '../css/home.css';


import {
  getFolderFileList,
  getFolderFileMeta,
  downloadFolderFile,
  deleteFolderFile,
  getPresignedDownloadUrl,
  getUserIdFromToken,
} from '../apiService';

const fs     = window.require('fs');
const path   = window.require('path');
const Buffer = window.require('buffer').Buffer;

/**
 * 서버/버킷상의 "foo/bar/latest/baz.txt" 또는
 * "foo/bar/latest/baz.txt" 형태의 raw 경로를
 * 로컬 디스크상의 "foo/bar/baz.txt" 로 바꿔 주는 헬퍼
 */
function normalizeRelPath(raw) {
  if (!raw) return raw;
  // 1) "/latest/<파일명>" 부분을 "/<파일명>" 으로 바꾼다.
  const step1 = raw.replace(/\/latest\/([^/]+)$/, '/$1');
  // 이제 "foo/bar/baz.txt/baz.txt" 식으로 중복될 수 있으므로,
  // 마지막 두 조각이 동일하면 뒤쪽 하나를 제거
  const parts = step1.split('/');
  if (parts.length >= 2 && parts[parts.length - 1] === parts[parts.length - 2]) {
    parts.splice(parts.length - 1, 1);
  }
  return parts.join('/');
}

export default function FolderPage() {
  const { id }     = useParams();              // sync-folder ID
  const { state }  = useLocation();
  const folderPath = state?.folderPath || '';  // 로컬 동기화 폴더 경로
  const navigate   = useNavigate();
  const username   = localStorage.getItem('currentUser') || 'User';

  // ── 로그인된 사용자 아이디 (토큰에서 추출) ──
  const currentUserId = getUserIdFromToken();

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
  const [currentPath, setCurrentPath] = useState('');
  const loadFiles = async (subPath = '') => {
    try {
      const raw = await getFolderFileList(id, subPath);
      // console.log(raw);
      const visible = raw.filter(f => {
        const rel = (f.relativePath || f.originalName || '')
                      .replace(/^\/+|\/+$/g, '');
        // 경로 조각마다 점(.)으로 시작하는지 검사
        return !rel.split('/').some(seg => seg.startsWith('.'));
      });

      // 1) hidden / 디렉토리 엔트리 무시 & latest 이하 파일만
      const latestOnly = visible
      .filter(f => f.type === 'file' && (f.relativePath || f.originalName).includes('/latest/'))
      .map(f => ({
        ...f,
        cleanedPath: (f.relativePath || f.originalName).replace(/^\/+|\/+$/g, '')
      }));
  
      // 3) 최신판(unique)만 남기기 (동일 경로 중 lastModified 최신)
      const fileMap = new Map();
      latestOnly.forEach(f => {
        const key = f.cleanedPath;
        const prev = fileMap.get(key);
        if (!prev || new Date(f.lastModified) > new Date(prev.lastModified)) {
          fileMap.set(key, f);
        }
      });
      // console.log(latestOnly);
      const uniqueFiles = Array.from(fileMap.values());
      // 4) 원하는 “레벨”로 그룹핑
      //    - subPath==='' → parts[0] (첫 번째)  
      //    - subPath!==' '→ subPath 다음(parts[1]) 로
      const groups = {};
      uniqueFiles.forEach(f => {
        const parts = f.cleanedPath.split('/');
        // subPath가 있을 땐 “test/qwer.txt/latest/qwer.txt” 에서 parts[0] === subPath여야 처리
        if (subPath && parts[0] !== subPath) return;
        const key = subPath === '' ? parts[0] : parts[1];
        if (!key) return;
        if (!groups[key]) groups[key] = [];
        groups[key].push(f);
      });
  
      // 5) UI용 항목으로 변환
      const dirItems = [];
      const fileItems = [];
      Object.keys(groups).sort((a,b)=> a.localeCompare(b, undefined, { sensitivity:'base' }))
        .forEach(key => {
          const grp = groups[key];
          // “키”가 실제 파일명인 경우 → 파일, 아니면 폴더
          // (grp[0].originalName 이 key 와 같으면 파일)
          if (grp[0].originalName === key) {
            // 파일
            fileItems.push({
              fileId:      grp[0].id ?? grp[0].fileId,
              // fileName:    subPath ? `${subPath}/${key}` : key,
              fileName:    grp[0].cleanedPath,  // ← 전체 상대경로
              name:        key,
              isDirectory: false,
              lastModified: grp[0].lastModified,
            });
          } else {
            // 폴더
            const folderPath = subPath ? `${subPath}/${key}` : key;
            dirItems.push({
              fileId:      `dir__${folderPath}`,
              fileName:    folderPath,
              name:        key,
              isDirectory: true,
            });
          }
        });
      
      // console.log(fileItems);       
      // console.log(dirItems);
  
      setFileList([...dirItems, ...fileItems]);
      setCurrentPath(subPath);
    } catch (err) {
      console.error(err);
      alert('파일 목록 조회 실패');
    }
  };
  

  // ── 1) ID 변경 시(=다른 폴더 진입) 목록 로드 ──
  useEffect(() => {
    const logInitialFiles = async () => {
      try {
        const files = await getFolderFileList(id, '');
        const filteredFiles = files.filter(f => 
          typeof f === 'object' &&
          (f.id != null || f.originalName) &&
          !f.originalName.startsWith('.')
        );

        const latestOnly = filteredFiles.filter(f =>
          f.relativePath.includes('/latest/')
        );        
  
        const mapped = latestOnly.map(f => ({
          fileId: f.id ?? f.fileId,
          fileName: f.relativePath?.trim() || f.originalName,
          isDirectory: f.isDirectory || false,
          name: f.originalName,
        }));
  
        // console.log('초기 파일/폴더 목록:', JSON.stringify(mapped, null, 2));
  
      } catch (err) {
        console.error('초기 폴더 진입 시 파일 목록 조회 실패:', err);
      }
    };

    logInitialFiles();
    loadFiles();
  }, [id]);


  const handleDoubleClick = (item) => {
    if (item.isDirectory) {
      const newPath = currentPath ? `${currentPath}/${item.name}` : item.name;
      loadFiles(newPath);
    }
  };

  const handleBack = () => {
    if (!currentPath) {
      navigate('/home');
    } else {
      const parentPath = currentPath.split('/').slice(0, -1).join('/');
      loadFiles(parentPath);
    }
  };


  // ── 1‑2) SyncManager 에서 “파일 삭제” 이벤트가 오면 목록 다시 로드 ──
  useEffect(() => {
    function onDeleted(_e, { folderId, relativePath }) {
      if (folderId === Number(id)) {
        console.log(`IPC 수신: '${relativePath}' 삭제 → UI 갱신`);
        loadFiles();
      }
    }
    ipcRenderer.on('sync-file-deleted', onDeleted);


    // ── 1‑3) SyncManager 에서 “파일 추가” 이벤트가 오면 목록 다시 로드 ──
    function onAdded(_e, { folderId, relativePath }) {
      if (folderId === Number(id)) {
        console.log(`IPC 수신: '${relativePath}' 추가 → UI 갱신`);
        loadFiles();
      }
    }
    ipcRenderer.on('sync-file-added', onAdded);

    // -- 1-4) SyncManager 에서 "파일 변경" 이벤트가 오면 목록 다시 로드
    function onUpdated(_e, { folderId, relativePath }) {
      if (folderId === Number(id)) {
        console.log(`IPC 수신: '${relativePath}' 변경 → UI 갱신`);
        loadFiles();
      }
    }
    ipcRenderer.on('sync-file-updated', onUpdated);

    return () => {
      ipcRenderer.removeListener('sync-file-deleted', onDeleted);
      ipcRenderer.removeListener('sync-file-added', onAdded);
      ipcRenderer.removeListener('sync-file-updated', onUpdated);
    };
  }, [id]);  

  // ── 2) 로컬 폴더 변경 감지하여 자동 갱신 ──
  useEffect(() => {
    if (!folderPath) return;
    const watcher = chokidar.watch(folderPath, {
      ignored: /(^|[\/\\])\..+|~$|\.swp$/,
      persistent: true,
      ignoreInitial: true,
      depth: Infinity,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
    });
    const handle = () => {
      loadFiles();
    };
    watcher.on('add',    handle)
           .on('addDir', handle)
           .on('change', handle)
           .on('unlink', handle)
           .on('unlinkDir', handle);

    return () => watcher.close();
  }, [folderPath, id]);


  // ── “정보 가져오기” ──
  const handleInfo = async (relativePath) => {
    try {
      const meta = await getFolderFileMeta(id, relativePath);
      alert(JSON.stringify(meta, null, 2));
    } catch (err) {
      console.error(err);
      alert('메타정보 조회 실패');
    }
  };

  // ── “파일 다운로드” ──
  const handleDownload = async (relativePath) => {
    try {
      // 항상 파일의 상대경로 문자열을 서버에 전달
      console.log('경로', relativePath);
      const blob = await downloadFolderFile(id, relativePath);
      const buf  = await blob.arrayBuffer();
      // 3) 저장 다이얼로그
      const savePath = path.join(folderPath, relativePath)
      const { filePath } = await dialog.showSaveDialog({
        defaultPath: savePath
      });
      if (!filePath) return;
      const dir = path.dirname(filePath);
      // const dir = path.dirname(savePath);

      // 하위 폴더가 있다면 디렉토리 생성
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      fs.writeFileSync(filePath, Buffer.from(buf));
      alert('다운로드 완료!');
    } catch (err) {
      console.error(err);
      alert('다운로드 중 오류: ' + err.message);
    }
  };

  const handleDelete = async (fileIdOrPath) => {
    try {
      let targetId;
      let displayName;
  
      // 문자열 경로인 경우
      if (typeof fileIdOrPath === 'string') {
        displayName = fileIdOrPath;
        const files = await getFolderFileList(id, currentPath);
        const matchingFiles = files.filter(f =>
          f.relativePath.replace(/^\/+/, '') === displayName
        );        
  
        if (matchingFiles.length > 0) {
          // 최신 파일의 ID를 삭제
          const latestFile = matchingFiles.reduce((latest, current) => {
            return new Date(current.lastModified) > new Date(latest.lastModified) ? current : latest;
          });
  
          targetId = latestFile.id ?? latestFile.fileId;
        }
      }
  
      if (!targetId) throw new Error('삭제할 파일을 찾을 수 없습니다.');
  
      if (!window.confirm(`’${displayName}‘ 을(를) 정말 삭제하시겠습니까?`)) return;
  
      await deleteFolderFile(id, targetId);
      alert('삭제되었습니다.');
  
      // 로컬 파일 삭제
      const normalized = normalizeRelPath(displayName);
      const localFull = path.join(folderPath, normalized);
      if (fs.existsSync(localFull)) {
        fs.unlinkSync(localFull);
      }
  
      loadFiles();
  
    } catch (err) {
      console.error(err);
      alert('삭제 실패: ' + err.message);
    }
  };
  

// ── 폴더 컨텍스트 메뉴 상태 관리 ──
const [ctxMenu, setCtxMenu] = useState({
  visible: false,
  x: 0,
  y: 0,
  folderId: null,
  relativePath: ''
});

const showCtx = (id, relPath) => (e) => {
  e.preventDefault();
  setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, folderId: id, relativePath: relPath });
};

// ── 서브폴더 정보 가여오기 ──
const handlefoldInfo = () => {
  alert(`Folder ID: ${ctxMenu.folderId}`);
  setCtxMenu((m) => ({ ...m, visible: false }));
};

// ── 서브폴더 삭제하기(IPC 통신까지) --
const handlefoldDelete = async () => {
  try {
    if (!window.confirm('서브폴더를 정말 삭제하시겠습니까?')) {
      return setCtxMenu((m) => ({ ...m, visible: false }));
    }

    const syncFolderId = Number(id);
    const localRoot = folderPath;
    let relPath = ctxMenu.relativePath;
    if (!relPath.endsWith('/')) relPath += '/';

    console.log('▶️ handlefoldDelete - relPath:', relPath);

    // 2. 서버에서 해당 폴더 내부 파일 목록 조회 (ID 포함)
    const serverFiles = await getFolderFileList(syncFolderId, currentPath);
    const targetFiles = serverFiles.filter(f =>
      typeof f.relativePath === 'string' &&
      f.relativePath.startsWith(relPath) &&
      !f.relativePath.endsWith('/')
    );

    console.log('▶️ 삭제 대상 파일:', targetFiles.map(f => f.relativePath));

    // 3. 각 파일 삭제 (서버 + 로컬)
    for (const file of targetFiles) {
      const fileId = file.id ?? file.fileId;
      if (!fileId) {
        console.warn(`❗️ 파일 ID 없음: ${file.relativePath}`);
        continue;
      }
      // 서버 삭제
      await deleteFolderFile(syncFolderId, fileId);
      // 로컬 삭제
      const norm = normalizeRelPath(file.relativePath.replace(/^\/+|\/+$/g, ''));
      const localFile = path.join(localRoot, norm);
      if (fs.existsSync(localFile)) {
        fs.unlinkSync(localFile);
      }
    }

    // 4. 로컬 빈 서브폴더 삭제
    const fullDir = path.join(localRoot, relPath);
    if (fs.existsSync(fullDir)) {
      await fs.promises.rmdir(fullDir, { recursive: true });
    }

    // 5. IPC로 서버→로컬 폴더 삭제 트리거
    ipcRenderer.send('sub-folder-removed-server', {
      folderId: syncFolderId,
      relativePath: relPath
    });

    setCtxMenu((m) => ({ ...m, visible: false }));
  } catch (error) {
    console.error('handlefoldDelete - 에러', error);
    alert('서브폴더 삭제에 실패했습니다: ' + error.message);
  }
};



  // 파일 컨텍스트 메뉴 상태
  const [fileMenu, setFileMenu] = useState({ visible: false, x: 0, y: 0, item: null });
  const showFileMenu = (e, item) => {
    e.preventDefault();
    setFileMenu({ visible: true, x: e.clientX, y: e.clientY, item });
  };
  const closeFileMenu = () => setFileMenu(m => ({ ...m, visible: false }));

  // 파일 메뉴 핸들러

  // 파일 공유 링크 함수
  const handleFileShare = async () => {
    try {
      closeFileMenu();
      if (!fileMenu.item) return;

      const rawRelativePath = fileMenu.item.fileName;
      if (!rawRelativePath) {
        throw new Error('유효하지 않은 파일 경로입니다.');
      }
      const s3Key = `users/${currentUserId}/sync-folders/${id}/${rawRelativePath}`;
      const presignedUrl = await getPresignedDownloadUrl(s3Key, 30);
      clipboard.writeText(presignedUrl);

      
      alert(`다운로드 링크가 클립보드에 복사되었습니다:\n${presignedUrl}`);
    } catch (err) {
      console.error('파일 공유 실패:', err);
      alert('파일 공유 링크 생성에 실패했습니다.\n' + err.message);
    }
  };
  // 버전 관리 목록 함수
  const handleFileVersion  = () => {
    const { fileId, fileName } = fileMenu.item;
    ipcRenderer.send('open-version-window', {
      folderId: Number(id),
      fileId,
      relativePath: fileName
    });
    closeFileMenu();
  };
  const handleFileInfo     = () => handleInfo(fileMenu.item.fileName);
  const handleFileDownload = () => handleDownload(fileMenu.item.fileName);
  const handleFileDelete   = () => handleDelete(fileMenu.item.fileName);

  return (
    <div className="home">
      {/* 헤더 */}
      <div className="header">
        <div className="folder-icon"/>
        <div className="header-title">{folderPath}</div>
        <div className="username">{username}</div>
        <div className="person-icon" onContextMenu={showUserMenu}/>
        {userMenu.visible && (
          <UserContextMenu
            x={userMenu.x} y={userMenu.y}
            onLogout={handleLogout} onClose={closeUserMenu}
          />
        )}
      </div>

      {/* Back root + Sub Folder + document */}
      <div className="home-main">
          <div className="fold-wrapper" onDoubleClick={handleBack}>
          <img src={backroot} alt=""/>
          <div className="fold-label">..</div>
        </div>

        {fileList.map(item => (
          <div
            key={`${item.fileId}__${item.fileName}`}  /* fileId 와 fileName 을 합쳐서 유니크 key */
            className="fold-wrapper"
            onDoubleClick={() => handleDoubleClick(item)}
            onContextMenu={item.isDirectory ? showCtx(item.fileId, item.fileName) : (e) => showFileMenu(e, item)}
          >
            <img src={item.isDirectory ? subfold : filee} alt=""/>
            <div className="fold-label">{item.name}</div>
          </div>
        ))}
      </div>

      {/* FolderContextMenu */}
      <FolderContextMenu
        visible={ctxMenu.visible}
        x={ctxMenu.x}
        y={ctxMenu.y}
        onInfo={handlefoldInfo}
        onDelete={handlefoldDelete}
        onClose={closeUserMenu}
      />

      {/* FileContextMenu */}
      <FileContextMenu
        visible={fileMenu.visible}
        x={fileMenu.x} y={fileMenu.y}
        onClose={closeFileMenu}
        onShare={handleFileShare}
        onVersion={handleFileVersion}
        onInfo={handleFileInfo}
        onDownload={handleFileDownload}
        onDelete={handleFileDelete}
      />

    </div>

  );
}
