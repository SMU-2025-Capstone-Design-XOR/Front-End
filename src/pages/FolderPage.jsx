// src/pages/FolderPage.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
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

import os from 'os';
import fs from 'fs';
import path from "path";
const Buffer = window.require('buffer').Buffer;

/**
 * 서버에 저장된 절대경로 예) "/Users/oldUser/XOR/A/MyDocs"
 * 를 최종 사용자 머신의 홈 디렉터리 구조에 맞춰 다시 계산하는 헬퍼
 * 예) os.homedir()="/Users/currentUser" => "/Users/currentUser/XOR/A/MyDocs"
 */
function computeLocalPathFromServerPath(serverPath) {
  if (!serverPath) return null;
  // 백엔드에 저장된 예시: "/Users/oldUser/XOR/A/MyDocs"
  // 가장 마지막 폴더 이름(=FolderName)만 꺼냅니다.
  const folderName = path.basename(serverPath);
  // 로컬 머신의 홈 디렉터리 + XOR + xorUser(로그인된 계정) + folderName
  const xorUser = localStorage.getItem('xorUser');
  if (!xorUser) return null;
  const userDir = path.join(os.homedir(), 'XOR', xorUser);
  return path.join(userDir, folderName);
}

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
  const serverPath = state?.folderPath || '';  // 백엔드에서 넘겨준 “절대경로”
  // 로컬 동기화 폴더 경로
  // const folderPath = state?.folderPath || '';  
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

  // ── “로컬 동기화 폴더” 경로 계산 (항상 이 머신의 홈 디렉터리에 맞춰 재계산) ──
  const localRoot = computeLocalPathFromServerPath(serverPath);  

  // ── 파일 리스트 상태 ──
  const [fileList, setFileList] = useState([]);
  const [currentPath, setCurrentPath] = useState('');

  /**
   * 주어진 subPath(빈 문자열 또는 "subFolderName/...")에 해당하는
   * 파일/폴더 목록을 서버에서 가져와서 화면용으로 파싱하고 setFileList 합니다.
   */
  const loadFiles = async (subPath = '') => {
    try {
      // 1) 서버에서 raw 목록 가져오기 (모든 파일 / 하위 폴더 포함)
      const raw = await getFolderFileList(id, subPath);
      // 2) 숨김파일 또는 dot(.)으로 시작하는 항목 걸러내기
      const visible = raw.filter(f => {
        const rel = (f.relativePath || f.originalName || '')
                      .replace(/^\/+|\/+$/g, '');
        // 경로 조각마다 점(.)으로 시작하는지 검사
        return !rel.split('/').some(seg => seg.startsWith('.'));
      });

      // 3) “latest” 이하 파일만 선별 → cleanedPath 생성
      const latestOnly = visible
      .filter(f => f.type === 'file' && (f.relativePath || f.originalName).includes('/latest/'))
      .map(f => ({
        ...f,
        // cleanedPath: (f.relativePath || f.originalName).replace(/^\/+|\/+$/g, '')
        cleanedPath: normalizeRelPath((f.relativePath || f.originalName).replace(/^\/+|\/+$/g, ''))
      }));
  
      // 4) 동일 경로 중 최신(lastModified)만 남기도록 중복 제거
      const fileMap = new Map();
      latestOnly.forEach(f => {
        const key = f.cleanedPath;
        const prev = fileMap.get(key);
        if (!prev || new Date(f.lastModified) > new Date(prev.lastModified)) {
          fileMap.set(key, f);
        }
      });
      const uniqueFiles = Array.from(fileMap.values());

      // 5) “폴더 vs 파일” 구분하여 UI용 객체 생성
      //    - subPath가 ""일 때는 parts[0] 기준
      //    - subPath가 "dd"일 때는 parts[1] 기준, subPath가 "dd/dd2"일 때는 parts[2] 기준      
      const dirItems = [];
      const fileItems = [];
      const seenDirs = new Set();   // 이미 화면에 넣은 디렉토리(subFolderPath)를 기록할 Set
      const seenFiles = new Set();  // 이미 화면에 넣은 파일(remainder) 를 기록할 Set

      uniqueFiles.forEach(f => {

        // 현재 보고 있는 subPath와 매치되는지 확인
        //    예: subPath="dd/dd2"일 때 "dd/dd2/hhh.txt" 만 통과
        if (subPath) {
          if (!f.cleanedPath.startsWith(subPath + '/')) {
            return; // subPath 하위가 아니면 건너뜀
          }
        }

        // 남은 문자열에서 첫 번째 세그먼트를 추출
        //    예: subPath="dd/dd2", cleanedPath="dd/dd2/hhh.txt" → 남은="hhh.txt" → key="hhh.txt"
        //         subPath=""            , cleanedPath="dd/dd2/hhh.txt" → 남은="dd/dd2/hhh.txt" → key="dd"
        const remainder = subPath
          ? f.cleanedPath.slice(subPath.length + 1) // 예: "dd/dd2/hhh.txt" slice  "hhh.txt"
          : f.cleanedPath;                          // 예: "dd/dd2/hhh.txt"
        if (!remainder) return;

        
        const key = remainder.split('/')[0];
        if (!key) return;

        // 실제 “구성 요소”가 파일인지 폴더인지 판별
        //    → f.cleanedPath의 마지막 segment(원본 파일명) vs key 비교
        // 실제 항상 “grp[0].originalName === key”로 체크하지 않고, 
        // → key가 해당 레벨에 파일명과 같으면 파일, 아니면 폴더
        //    (원본 API에서 isDirectory 같은 flag를 쓰셔도 무방)
        // 하지만 우리 API는 put.getFolderFileList에서 type==='file'만 내려주므로
        // 도메인 지식에 따라 구분해야 합니다.
        // 여기서는 "latestOnly" 리스트만 파일이므로, 그대로 사용하면 됩니다.

        // d) 이 예시에서는 “if cleanedPath 내 더 이상 /가 없다면 파일, 그렇지 않으면 폴더”로 구분
        const segmentsAfter = remainder.split('/');
        const isDir = segmentsAfter.length > 1;
        
        if (isDir) {
          // 디렉터리인 경우
          const subFolderPath = subPath ? `${subPath}/${key}` : key;

          // 이미 ‘subFolderPath’를 화면에 넣은 적이 있는지 체크
          if (seenDirs.has(subFolderPath)) {
            return;  // 이미 출력한 디렉토리면 중복 처리 안 함
          }
          seenDirs.add(subFolderPath);

          dirItems.push({
            fileId:      `dir__${subFolderPath}`, // UI key용
            fileName:    subFolderPath,           // 서버/로컬 양쪽 로직에서 “서브패스”로 사용
            name:        key,                     // UI에 표시할 폴더 이름
            isDirectory: true,
          });
        } else {
          // 파일이면, cleanedPath를 전체 상대경로로 갖되,
          // UI에는 key만 보여줌
          if (seenFiles.has(remainder)) {
            return;  // 이미 추가된 파일이면 건너뜀
          }
          seenFiles.add(remainder);

          fileItems.push({
            fileId:      f.id ?? f.fileId,
            fileName:    remainder,     // “dd2/hhh.txt” or 그냥 "hhh.txt"
            name:        key,           // UI에 보여줄 실제 파일명
            isDirectory: false,
            lastModified: f.lastModified,
          });
        }
      });

      setFileList([...dirItems, ...fileItems]);
      setCurrentPath(subPath);
    } catch (err) {
      console.error(err);
      alert('파일 목록 조회 실패');
    }
  };
  

  // ── 목록 로드 ──
  useEffect(() => {
    loadFiles('');
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
        // loadFiles();
        loadFiles(currentPath);
      }
    }
    ipcRenderer.on('sync-file-deleted', onDeleted);


    // ── 1‑3) SyncManager 에서 “파일 추가” 이벤트가 오면 목록 다시 로드 ──
    function onAdded(_e, { folderId, relativePath }) {
      if (folderId === Number(id)) {
        console.log(`IPC 수신: '${relativePath}' 추가 → UI 갱신`);
        // loadFiles();
        loadFiles(currentPath);
      }
    }
    ipcRenderer.on('sync-file-added', onAdded);

    // -- 1-4) SyncManager 에서 "파일 변경" 이벤트가 오면 목록 다시 로드
    function onUpdated(_e, { folderId, relativePath }) {
      if (folderId === Number(id)) {
        console.log(`IPC 수신: '${relativePath}' 변경 → UI 갱신`);
        // loadFiles();
        loadFiles(currentPath);
      }
    }
    ipcRenderer.on('sync-file-updated', onUpdated);

    return () => {
      ipcRenderer.removeListener('sync-file-deleted', onDeleted);
      ipcRenderer.removeListener('sync-file-added', onAdded);
      ipcRenderer.removeListener('sync-file-updated', onUpdated);
    };
  }, [id, currentPath]);  

  // ── 2) 로컬 폴더 변경 감지(Chokidar) → 자동 갱신 ──
  useEffect(() => {
    if (!localRoot) return;
    const watcher = chokidar.watch(localRoot, {
      ignored: /(^|[\/\\])\..+|~$|\.swp$/, // dotfile, 임시파일 무시
      persistent: true,
      ignoreInitial: true,
      depth: Infinity,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
    });
    const handle = () => {
      loadFiles(currentPath);
    };    
    watcher.on('add',    handle)
           .on('addDir', handle)
           .on('change', handle)
           .on('unlink', handle)
           .on('unlinkDir', handle);

    return () => watcher.close();
  }, [localRoot, currentPath]);


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
      // 1) 서버에 상대경로 전달 → Blob 수신
      const blob = await downloadFolderFile(id, relativePath);
      const buf  = await blob.arrayBuffer();

      // 2) “저장할 경로” 선택 대화상자 (기본 경로는 localRoot/relativePath)
      // * 여기서도 “localRoot”를 사용해야 올바른 머신 경로가 됩니다.
      const suggested = path.join(localRoot, relativePath);
      const { filePath } = await dialog.showSaveDialog({
        defaultPath: suggested
      });      
      if (!filePath) return;


      // 3) 저장 대상의 디렉터리 생성
      const dir = path.dirname(filePath);
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
  
      // 1) 문자열(relativePath)인 경우, 실제 ID 찾아서 삭제
      if (typeof fileIdOrPath === 'string') {
        displayName = fileIdOrPath;
        const files = await getFolderFileList(id, currentPath);
        const matchingFiles = files.filter(f =>
          f.relativePath.replace(/^\/+/, '') === displayName
        );        
  
        if (matchingFiles.length > 0) {
          // 최신 파일의 ID를 삭제
          const latestFile = matchingFiles.reduce((latest, current) => {
            return new Date(current.lastModified) > new Date(latest.lastModified)
            ? current
            : latest;
          });
  
          targetId = latestFile.id ?? latestFile.fileId;
        }
      }
  
      if (!targetId) throw new Error('삭제할 파일을 찾을 수 없습니다.');
      if (!window.confirm(`’${displayName}‘ 을(를) 정말 삭제하시겠습니까?`)) return;
  
      // 2) 서버에서 삭제 요청
      await deleteFolderFile(id, targetId);
      alert('삭제되었습니다.');
  
      // 3) 로컬 디스크에서도 삭제
      const normalized = normalizeRelPath(displayName);
      const localFull = path.join(localRoot, normalized);
      if (fs.existsSync(localFull)) {
        fs.unlinkSync(localFull);
      }
  
      // 4) 목록 다시 로드
      loadFiles(currentPath);      
      // loadFiles();
  
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
    // const localRoot = folderPath;
    // let relPath = ctxMenu.relativePath;
    const relPath = ctxMenu.relativePath.endsWith('/')
      ? ctxMenu.relativePath
      : ctxMenu.relativePath + '/';

    // if (!relPath.endsWith('/')) relPath += '/';

    console.log('▶️ handlefoldDelete - relPath:', relPath);

    // 1) 해당 서브폴더 내 모든 파일 메타 조회
    const serverFiles = await getFolderFileList(syncFolderId, currentPath);
    const targetFiles = serverFiles.filter(f =>
      typeof f.relativePath === 'string' &&
      f.relativePath.startsWith(relPath) &&
      !f.relativePath.endsWith('/')
    );

    // console.log('▶️ 삭제 대상 파일:', targetFiles.map(f => f.relativePath));

    // 2) 각 파일별로 서버 삭제 + 로컬 삭제
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

    // 3) 로컬 빈 서브폴더 삭제
    const fullDir = path.join(localRoot, relPath);
    if (fs.existsSync(fullDir)) {
      await fs.promises.rmdir(fullDir, { recursive: true });
    }

    // 4) SyncManager 쪽에 삭제 알림
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

  // 기준 루트 경로 (예: 'Users/praise_t.l/XOR/j1')
  // 이 경로는 로그인한 유저에 따라 다를 수 있으므로 props 또는 변수로 따로 관리하는 게 좋습니다.
  const rootPath = path.join(os.homedir(), 'XOR', username); // 예시, 실제 구조에 맞게 조정하세요
  // 상대 경로 계산
  const displayPath = serverPath.startsWith(rootPath)
    ? serverPath.slice(rootPath.length + 1) // +1은 슬래시(/) 제거용
    : serverPath; // 혹시 루트가 아닌 경우엔 전체 경로 그대로 표시

  return (
    <div className="home">
      {/* 헤더 */}
      <div className="header">
        <div className="folder-icon"/>
        {/* 헤더에는 “로컬 읽기”가 아니라, 서버에서 받은 원본 절대경로(serverPath)를 텍스트로 보여줌 */}
        {/* <div className="header-title">{serverPath}</div> */}
        <div className="header-title">{displayPath || username}</div>
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
          {/* “..” 클릭 시 상위 폴더로 이동하거나, 루트면 메인 화면으로 */}
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
