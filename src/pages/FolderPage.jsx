// src/pages/FolderPage.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Menu, MenuItem, getCurrentWindow } from '@electron/remote';
import { dialog } from '@electron/remote';
import chokidar from 'chokidar';
const { ipcRenderer } = window.require('electron');
import folderIcon from '../assets/Home/folder.svg';
import personIcon from '../assets/Home/person-24.svg';
import { UserContextMenu } from '../components/UserContextMenu';
import FolderContextMenu from '../components/FolderContextMenu';
import SyncManager from '../SyncManager';
import { stringify } from 'flatted';


import {
  getFolderFileList,
  getFolderFileMeta,
  downloadFolderFile,
  deleteFolderFile,
  deleteSyncFolder
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
      console.log(`🔷 loadFiles - 현재 경로: '${subPath}' (ID: ${id})`);
      const files = await getFolderFileList(id);
      const filteredFiles = files.filter(f => 
        typeof f === 'object' &&
        (f.id != null || f.originalName) &&
        !f.originalName.startsWith('.')
      );

      const mapped = filteredFiles.map(f => {
        const rel = f.relativePath?.trim() || f.originalName;
        return {
          fileId: f.id ?? f.fileId,
          fileName: rel,
          name: f.originalName,
          isDirectory: rel.endsWith('/')
        };
      });

      // 현재 경로(subPath) 기준으로 서브폴더 추출
      const dirSet = new Set();
      mapped.forEach(item => {
        const rel = item.fileName;
        const prefix = subPath ? subPath + '/' : '';
        if (!rel.startsWith(prefix)) return;
        const remainder = rel.slice(prefix.length);
        const segments = remainder.split('/');
        if (segments.length > 1) {
          dirSet.add(segments[0]);
        }
      });
      const dirItems = Array.from(dirSet).map(name => ({
        fileId: `dir__${name}`,
        fileName: subPath ? `${subPath}/${name}` : name,
        name,
        isDirectory: true,
      }));

      // 파일만 필터링
      const fileItems = mapped.filter(item => {
        const rel = item.fileName;
        const prefix = subPath ? subPath + '/' : '';
        if (subPath) {
          return rel.startsWith(prefix) && !rel.slice(prefix.length).includes('/');
        }
        return !rel.includes('/');
      });
      
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
        console.log(`📂 폴더 ID ${id} 진입 - 폴더 내 파일 및 폴더 목록:`);
  
        const files = await getFolderFileList(id);
        const filteredFiles = files.filter(f => 
          typeof f === 'object' &&
          (f.id != null || f.originalName) &&
          !f.originalName.startsWith('.')
        );
  
        const mapped = filteredFiles.map(f => ({
          fileId: f.id ?? f.fileId,
          fileName: f.relativePath?.trim() || f.originalName,
          isDirectory: f.isDirectory || false,
          name: f.originalName,
        }));
  
        console.log('초기 파일/폴더 목록:', JSON.stringify(mapped, null, 2));
  
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
      // depth: 0,  // 서브 폴더까지 지원하려면 Infinity 로 변경
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
      const blob = await downloadFolderFile(id, relativePath); 
      const buf  = await blob.arrayBuffer();
      // 3) 저장 다이얼로그
      const savePath = path.join(folderPath, relativePath)
      const { filePath } = await dialog.showSaveDialog({
        defaultPath: savePath
      });
      if (!filePath) return;

      // 하위 폴더가 있다면 디렉토리 생성
      const dir = path.dirname(filePath);
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

      // — 숫자 ID 케이스 —
      if (typeof fileIdOrPath === 'number' || !isNaN(Number(fileIdOrPath))) {
        targetId = Number(fileIdOrPath);
        const item = fileList.find(f => Number(f.fileId) === targetId);
        if (!item) throw new Error('삭제할 파일을 찾을 수 없습니다.');
        displayName = item.fileName;

      // — 파일명(문자열) 케이스 —
      } else {
        displayName = fileIdOrPath;
        const meta = await getFolderFileMeta(id, fileIdOrPath);
        // 백엔드가 id 대신 fileId로 내려줄 수도 있어서 둘 다 확인
        targetId = meta.id ?? meta.fileId;
        if (!targetId) throw new Error('메타데이터에서 파일 ID를 찾을 수 없습니다.');
      }

      // 사용자 확인
      if (!window.confirm(`’${displayName}‘ 을(를) 정말 삭제하시겠습니까?`)) return;

      // 실제 삭제 호출
      await deleteFolderFile(id, targetId);
      alert('삭제되었습니다.');

      // → 로컬에서도 파일 삭제
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
  try{
    if (!window.confirm('삭제하시겠습니까?')) return setCtxMenu((m) => ({ ...m, visible: false }));

    // 문제 진단용 로그
    console.log('handlefoldDelete - relPath:', ctxMenu.relativePath);
      // IPC로 전송할 객체
    const payload = {
      folderId: Number(id),
      // relativePath: relPath ? String(relPath) : ''
      relativePath: ctxMenu.relativePath  // 순수 문자열
    };
    
    // 직렬화 가능한지 확인
    console.log('handlefoldDelete - payload:', JSON.stringify(payload));
  
    ipcRenderer.send('delete-subfolder', payload);
    setCtxMenu((m) => ({ ...m, visible: false }));
  } catch (error) {
    console.error('handlefoldDelete - 에러', error)
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
    menu.append(new MenuItem({ label: '파일 삭제',    click: () => handleDelete(fileName) }));
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
        <button onClick={handleBack} style={{ fontSize:'24px', marginRight:'16px', background:'none', border:'none', cursor:'pointer' }}>←</button>
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
            key={`${item.fileId}__${item.fileName}`}  /* fileId 와 fileName 을 합쳐서 유니크 key */
            onDoubleClick={() => handleDoubleClick(item)}
            onContextMenu={item.isDirectory ? showCtx(item.fileId, item.fileName) : (e) => showFileMenu(e, item)}
            style={{ display:'flex', alignItems:'center', padding:'8px 0', cursor: item.isDirectory ? 'pointer' : 'default' }}
          >
            <span style={{ marginRight: 8 }}>{item.isDirectory ? '📁' : '📄'}</span>
            <span style={{ flexGrow: 1 }}>{item.name}</span>
            <span style={{ fontSize: '12px', color: '#888' }}>{item.lastModified}</span>
          </div>
        ))}
      </main>

      {/* FolderContextMenu */}
      <FolderContextMenu
        visible={ctxMenu.visible}
        x={ctxMenu.x}
        y={ctxMenu.y}
        onInfo={handlefoldInfo}
        onDelete={handlefoldDelete}
      />
    </div>

    
  );
}
