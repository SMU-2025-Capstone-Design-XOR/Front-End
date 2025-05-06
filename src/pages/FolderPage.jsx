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

import {
  getFolderFileList,
  getFolderFileMeta,
  downloadFolderFile,
  deleteFolderFile
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

// ── 파일 목록 로드 + 매핑 ──
const loadFiles = async () => {
  try {
    const files = await getFolderFileList(id);
    if (!Array.isArray(files)) return setFileList([]);

    const mapped = files
      // (1) originalName 이 있고, 숨김 파일이 아니어야 함
      .filter(f =>
        typeof f === 'object' &&
        (f.id != null || f.originalName) &&
        !f.originalName.startsWith('.')
      )
      .map(f => {
        // relativePath 가 빈 문자열이거나 undefined 면 originalName 으로 대체
        const rel = f.relativePath && f.relativePath.trim()
                  ? f.relativePath
                  : f.originalName;

        return {
          fileId:   f.id,
          fileName: rel,       // 컨텍스트 메뉴나 다운로드 시 URL 파라미터로 씀
          name:     f.originalName  // 화면에 뿌려 줄 텍스트
        };
      });

    // 중복 제거 (fileName 은 이제 항상 string 이므로 안정적)
    const seen = new Map();
    mapped.forEach(item => seen.set(item.fileName, item));
    setFileList(Array.from(seen.values()));
    console.log('[getFolderFileList 응답]', files);
  } catch (err) {
    console.error(err);
    alert('파일 목록 조회 실패');
  }
};


  // // ── 파일 목록 로드 + 매핑 로직을 함수로 분리 ──
  // const loadFiles = async () => {
  //   try {
  //     const files = await getFolderFileList(id);
  //     let mapped = Array.isArray(files)
  //       ? files
  //           // .filter(f => typeof f === 'object' && (f.id != null || f.relativePath) && f.relativePath !== '.DS_Store')
  //           .filter(f =>
  //               typeof f === 'object' &&
  //               (f.id != null || f.relativePath) &&
  //               !f.relativePath.startsWith('.')             // 숨김파일 전부 제거 
  //            )
  //           .map(f => ({
  //             fileId:   f.id != null ? f.id : f.relativePath,
  //             fileName: f.relativePath || f.id,
  //             name:     f.originalName || f.relativePath || f.id
  //           }))
  //       : [];

  //     // 파일 이름 기준으로 중복 제거 (맨 마지막 항목만 남김)
  //     const seen = new Map();
  //     mapped.forEach(item => {
  //       seen.set(item.fileName, item);
  //     });
  //     mapped = Array.from(seen.values());

  //     setFileList(mapped);
  //     console.log('[getFolderFileList 응답]', files);
  //   } catch (err) {
  //     console.error(err);
  //     alert('파일 목록 조회 실패');
  //   }
  // };

  // ── 1) ID 변경 시(=다른 폴더 진입) 목록 로드 ──
  useEffect(() => {
    loadFiles();
  }, [id]);


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
  const handleInfo = async (fileName) => {
    try {
      const meta = await getFolderFileMeta(id, fileName);
      alert(JSON.stringify(meta, null, 2));
    } catch (err) {
      console.error(err);
      alert('메타정보 조회 실패');
    }
  };

  // ── “파일 다운로드” ──
  const handleDownload = async (fileName) => {
    try {
      const blob = await downloadFolderFile(id, fileName);
      const buf  = await blob.arrayBuffer();
      const { filePath } = await dialog.showSaveDialog({
        defaultPath: path.join(folderPath, fileName)
      });
      if (!filePath) return;
      fs.writeFileSync(filePath, Buffer.from(buf));
      alert('다운로드 완료!');
    } catch (err) {
      console.error(err);
      alert('다운로드 중 오류');
    }
  };

  const handleDelete = async (fileIdOrName) => {
    try {
      let targetId;
      let displayName;

      // — 숫자 ID 케이스 —
      if (typeof fileIdOrName === 'number' || !isNaN(Number(fileIdOrName))) {
        targetId = Number(fileIdOrName);
        const item = fileList.find(f => Number(f.fileId) === targetId);
        if (!item) throw new Error('삭제할 파일을 찾을 수 없습니다.');
        displayName = item.name;

      // — 파일명(문자열) 케이스 —
      } else {
        displayName = fileIdOrName;
        const meta = await getFolderFileMeta(id, fileIdOrName);
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

  // ── 우클릭 컨텍스트 메뉴 ──
  const showFileMenu = (e, { fileId, fileName, name }) => {
    e.preventDefault();
    const menu = new Menu();
    menu.append(new MenuItem({ label: '파일 공유',   click: () => alert(`’${name}‘ 공유…`) }));
    menu.append(new MenuItem({ label: '버전 관리',   click: () => alert(`’${name}‘ 버전 관리…`) }));
    menu.append(new MenuItem({ label: '정보 가져오기', click: () => handleInfo(fileName) }));
    menu.append(new MenuItem({ label: '파일 다운로드', click: () => handleDownload(fileName) }));
    menu.append(new MenuItem({ label: '파일 삭제',    click: () => handleDelete(fileId) }));
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
        <button onClick={() => navigate(-1)}
          style={{ fontSize:'24px', marginRight:'16px', background:'none', border:'none', cursor:'pointer' }}
        >←</button>
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
            // key={item.fileId}
            key={`${item.fileId}__${item.fileName}`}  /* fileId 와 fileName 을 합쳐서 유니크 key */
            onContextMenu={e => showFileMenu(e, item)}
            style={{ display:'flex', alignItems:'center', padding:'8px 0' }}
          >
            <span style={{ marginRight: 8 }}>📄</span>
            <span style={{ flexGrow: 1 }}>{item.name}</span>
          </div>
        ))}
      </main>
    </div>
  );
}
