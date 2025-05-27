// src/pages/FolderPage.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Menu, MenuItem, getCurrentWindow } from '@electron/remote';
import { dialog } from '@electron/remote';
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
  const [currentPath, setCurrentPath] = useState('');

  const loadFiles = async (subPath = '') => {
    try {
      const files = await getFolderFileList(id, subPath);
      // console.log(files);
      const filteredFiles = files.filter(f => 
        typeof f === 'object' &&
        (f.id != null || f.originalName) &&
        !f.originalName.startsWith('.')
      );
      
      // 2) prefix 슬래시 정리 → 전부 “foo/bar/latest/baz.txt” 형태로
      const cleaned = filteredFiles.map(f => {
           // 1) 앞뒤 슬래시 제거
           let rp = (f.relativePath || f.originalName || '').replace(/^\/+|\/+$/g, '');
           // 2) 'folder' 엔트리라면 끝에 반드시 '/'를 붙여 줍니다
           if (f.type === 'folder' && !rp.endsWith('/')) {
             rp = rp + '/';
           }
           return { ...f, cleanedPath: rp };
         });

      // ── “latest/ 이하의 파일만” 남기기 ──
      // const latestOnly = cleaned.filter(f =>
      //   // relativePath 어딘가에 “latest/” 경로 조각이 포함되어야 합니다
      //   f.relativePath.includes('/latest/')
      // );    
      // const latestOnly = cleaned.filter(f => f.cleanedPath.includes('/latest/'));
      const latestOnly = cleaned.filter(f =>
        f.cleanedPath.includes('/latest/') && f.type !== 'folder'
      );

      console.log(latestOnly);
      // 같은 relativePath를 가진 파일이 있을 경우, 최신 파일만 남기기
      const fileMap = new Map();
      // latestOnly.forEach(f => {
      //   const relPath = f.relativePath?.trim() || f.originalName;
      //   const existing = fileMap.get(relPath);
      //   if (!existing || new Date(f.lastModified) > new Date(existing.lastModified)) {
      //     fileMap.set(relPath, f);
      //   }
      // });
      latestOnly.forEach(f => {
        const p = f.cleanedPath;
        const prev = fileMap.get(p);
        if (!prev || new Date(f.lastModified) > new Date(prev.lastModified)) {
          fileMap.set(p, f);
        }
      });
      // Map을 다시 배열로 변환
      const uniqueFiles = Array.from(fileMap.values());

      // const baseMapped = uniqueFiles.map(f => {
      //   const rel = f.relativePath?.trim() || f.originalName;
      //   return {
      //     fileId: f.id ?? f.fileId,
      //     fileName: rel,
      //     fileName:   f.cleanedPath,
      //     name: f.originalName,
      //     isDirectory: f.type === 'folder' || rel.endsWith('/'),
      //     isDirectory: f.type === 'folder' || f.cleanedPath.endsWith('/'),
      //     lastModified: f.lastModified,
      //   };
      // });      
      // const mapped = baseMapped.filter(item =>
      //   !(item.isDirectory && item.fileName === `${subPath}/`)
      // );      

      // --- **루트(최초 진입)**라면: 바로 파일만 평면으로 보여주기
      if (subPath === '') {
        const items = uniqueFiles.map(f => ({
          fileId:      f.id ?? f.fileId,
          fileName:    f.cleanedPath,      // e.g. "qwer.txt/latest/qwer.txt"
          name:        f.originalName,     // e.g. "qwer.txt"
          isDirectory: false,
          lastModified: f.lastModified,
        }))
        // 가나다순
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        );

        setFileList(items);
        setCurrentPath(subPath);
        return;    // **이후 디렉토리 로직은 건너뜁니다**
      }

      const mapped = uniqueFiles.map(f => ({
        fileId:     f.id ?? f.fileId,
        fileName:   f.cleanedPath,        // “foo/bar/latest/baz.txt”
        name:       f.originalName,
        isDirectory: f.type === 'folder' || f.cleanedPath.endsWith('/'),
        lastModified: f.lastModified,
      }));

      const prefix = subPath ? subPath + '/' : '';
      
      // 현재 경로(subPath) 기준으로 서브폴더 추출
      const dirSet = new Set();
      mapped.forEach(item => {
        if (!item.isDirectory) return;
        const rel = item.fileName;            // ex) "qwer.txt/latest/"
        if (!rel.startsWith(prefix)) return;
        // prefix 뒤에 남은 “경로 조각” 중 첫 번째만 서브폴더
        const rest = rel.slice(prefix.length).replace(/\/+$/, '');  
        const seg0 = rest.split('/')[0];
        dirSet.add(seg0);
      });
      const dirItems = Array.from(dirSet)
        .map(name => ({
          fileId:     `dir__${subPath ? `${subPath}/${name}` : name}`,
          fileName:   subPath ? `${subPath}/${name}` : name,
          name,
          isDirectory:true,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));  

      // const dirSet = new Set();
      // mapped.forEach(item => {
      //   if (!item.isDirectory) return;
      //   const rel = item.fileName;
      //   // const normalizedRel = rel.replace(/^\/+/, '').replace(/\/+$/, ''); // 슬래시 정리
      //   const normalizedRel = rel.replace(/^\/+|\/+$/g, ''); // 슬래시 정리
      //   // const prefix = subPath ? subPath + '/' : '';
      //   if (!normalizedRel.startsWith(prefix)) return;
      //   const remainder = normalizedRel.slice(prefix.length);
      //   if (!remainder.endsWith('/')) return;
      //   // if (remainder === '') return; // 자기 자신은 무시
      //   // const segments = remainder.split('/');
      //   const segments = remainder.split('/').filter(Boolean);
      //   if (segments.length >= 1) {
      //     dirSet.add(segments[0]);
      //   }
      //   console.log('[DEBUG] fileName:', rel, '→ remainder:', remainder, '→ segments:', segments);
      // });
      // const dirItems = Array.from(dirSet).map(name => ({
      //   fileId: `dir__${subPath ? `${subPath}/${name}` : name}`,
      //   fileName: subPath ? `${subPath}/${name}` : name,
      //   name,
      //   isDirectory: true,
      // }));
      // ── 디렉터리(서브폴더)들을 이름(name) 기준으로 가나다순 정렬 ──
      // dirItems.sort((a, b) => {
      //   return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      // });

      // 파일만 필터링
      const fileItems = mapped
      .filter(item => !item.isDirectory)
      .filter(item => {
        const rel = item.fileName;         // ex) "qwer.txt/latest/baz.txt"
        // 1) prefix 체크
        if (!rel.startsWith(prefix)) return false;
        // 2) prefix 뒤에 슬래시가 더 없는 단일 레벨만
        const rest = rel.slice(prefix.length);
        return rest.split('/').length === 1;
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      // const fileItems = mapped
      // .filter(item => !item.isDirectory)       // ← 폴더 제외
      // .filter(item => {
      //   const rel = item.fileName;
      //   const prefix = subPath ? subPath + '/' : '';
      //   // “바로 직속 레벨” 만 남기기
      //   return rel.startsWith(prefix) && !rel.slice(prefix.length).includes('/');
      // });      
      // // ── 파일들을 이름(name) 기준으로 가나다순 정렬 ──
      // fileItems.sort((a, b) => {
      //   return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      // });
      
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

        // latest/ 이하만
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
      // fs.writeFileSync(savePath, Buffer.from(buf));
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
        const matchingFiles = files.filter(f => f.relativePath === displayName);
  
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
      const localFull = path.join(folderPath, displayName);
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

    // 1. 상위 동기화 폴더 ID & 로컬 경로
    const syncFolderId = Number(id);
    // folderPath 는 useLocation().state.folderPath 로 받아온 동기화 루트
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
      const localFile = path.join(localRoot, file.relativePath);
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
  // const handleFileShare    = () => alert(`’${fileMenu.item.name}‘ 공유…`);
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
        // onShare={handleFileShare}
        onVersion={handleFileVersion}
        onInfo={handleFileInfo}
        onDownload={handleFileDownload}
        onDelete={handleFileDelete}
      />

    </div>

  );
}
