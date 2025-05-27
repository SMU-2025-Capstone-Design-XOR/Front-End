// src/SyncManager.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import crypto from 'crypto';
import mime from 'mime-types';
import chokidar from 'chokidar';
import os from 'os';
const { ipcRenderer } = window.require('electron');
const fs   = window.require('fs');
const path = window.require('path');

// 로그인 시 localStorage에 저장된 username
const xorUser = localStorage.getItem('xorUser');
// 실제 동기화 루트
const userDir = xorUser
  ? path.join(os.homedir(), 'XOR', xorUser)
  : null;

// const userDir = localStorage.getItem('userDir');


import {
  sendSyncFolder,
  getSyncFolder,
  syncFolder,
  getFolderFileList,
  deleteSyncFolder,
  uploadFile,
  downloadFolderFile,
  deleteFolderFile,
} from './apiService';

/** 
 * 서버에서 내려주는 상대경로(raw)에서
 * '/latest/<파일명>' 부분을 제거하여 로컬과 매핑되는
 * 순수 상대경로('test/asd.txt')만 남겨 주는 헬퍼
 */
function normalizeRelPath(raw) {
  if (!raw) return raw;
  // 예시: "test/asd.txt/latest/asd.txt" → "test/asd.txt"
  // 실제 구조가 "test/asd.txt/latest/asd.txt"로 고정되어 있다면 아래 정규식으로 가능합니다.
  //   - 맨 뒤의 '/latest/<파일명>' 부분을 '/<파일명>'으로 바꾼 뒤, 한 번 더 꺾어 불필요한 'latest' 폴더를 제거
  const step1 = raw.replace(/\/latest\/([^/]+)$/, '/$1');
  // 이제 "test/asd.txt/asd.txt"가 되는데, 맨 뒤 '파일명'을 중복으로 제거
  // (원본이 "test/asd.txt/latest/asd.txt"일 때만 해당)
  // 안전하게 처리하려면 낱개 경로 조각을 비교해야 하지만, 대부분은 위 한 줄로 해결됩니다.
  const parts = step1.split('/');
  // 마지막 두 조각이 동일하다면 뒤의 조각을 제거
  if (parts.length >= 2 && parts[parts.length - 1] === parts[parts.length - 2]) {
    parts.splice(parts.length - 1, 1);
  }
  return parts.join('/');
}


export default function SyncManager() {
  const [folders, setFolders] = useState([]);
  const watchersRef           = useRef({});
  const intervalsRef          = useRef({});
  const prevClientMapRef      = useRef({}); // { [folderId]: Map<relativePath, FileMeta> }
  const initialSyncDoneRef    = useRef({}); // Tracks if initial sync is completed per folder
  const navigate              = useNavigate();
  const folderPathMap = useRef({});
  const autoRegisteredRef = useRef(false);
  const justAdded = useRef(new Set());

  
  // ── 전체 파일 메타 스캔 ──
  function buildClientFiles(root) {
    const results = [];
    function walk(currentDir) {
      fs.readdirSync(currentDir, { withFileTypes: true }).forEach(entry => {
        const fullPath = path.join(currentDir, entry.name);
        const stat = fs.statSync(fullPath);
        if (entry.isFile()) {
          const buffer = fs.readFileSync(fullPath);
          const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
          results.push({
            originalName: relativePath,
            // relativePath: relativePath,
            relativePath,
            size: stat.size,
            hash: crypto.createHash('sha256').update(buffer).digest('hex'),
            mimeType: mime.lookup(fullPath) || 'application/octet-stream',
            lastModified: new Date(stat.mtimeMs).toISOString(),
          });
        } else if (entry.isDirectory()) {
          walk(fullPath);
        }
      });
    }
    walk(root);
    return results;
  }


  // 파일 및 서브 폴더 관련 핸들러

  // ── Helper: 빈 디렉터리 삭제 ──
  function cleanupEmptyDirs(dir) {
    fs.readdirSync(dir).forEach(name => {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        cleanupEmptyDirs(full);
        if (fs.readdirSync(full).length === 0){
          fs.rmdirSync(full);
          console.warn(`📁 [SyncManager] 폴더 삭제: ${full}`);
        }
      }
    });
  }

  // 로컬 파일 동기화 관련 핸들러

  async function handleLocalAdd(fullPath, id, root) {
    try {
      const rel = path.relative(root, fullPath).replace(/\\/g, '/').trim() || path.basename(fullPath);
      if (rel.startsWith('.')) {
        console.log(`🛑 무시된 파일: ${rel}`);
        return;
      }
      // 서브폴더 내 파일이 다운로드가 되지 않는 상황이기에 주석처리함.(빈 화면 방지)
      // const localFiles = buildClientFiles(root);
      // const localPaths = new Set(localFiles.map(f => f.relativePath));
      
      // console.log(`📂 [handleLocalAdd] 파일 추가됨: ${rel}`);
  
      const stat = fs.statSync(fullPath);
      const buf = fs.readFileSync(fullPath);
      const newFileMeta = {
        originalName: path.basename(fullPath),
        relativePath: rel,
        size: stat.size,
        hash: crypto.createHash('sha256').update(buf).digest('hex'),
        mimeType: mime.lookup(fullPath) || 'application/octet-stream',
        lastModified: new Date(stat.mtimeMs).toISOString(),
      };
  

      // 1) 서버 메타 가져온 뒤, normalizeRelPath 처리
      const rawServerFiles = await getFolderFileList(id);
      const serverFiles = rawServerFiles.map(f => ({
        ...f,
        relativePath: normalizeRelPath(f.relativePath || f.originalName),
      }));
      const serverMap = new Map(serverFiles.map(f => [f.relativePath, f]));
      const serverMeta = serverMap.get(rel);

      // const serverFiles = await getFolderFileList(id);
      // const serverMap = new Map(serverFiles.map(f => [f.relativePath, f]));
      // const serverMeta = serverMap.get(rel);

  
      if (serverMeta) {
        if (newFileMeta.hash !== serverMeta.hash) {
          const clientTime = new Date(newFileMeta.lastModified);
          const serverTime = new Date(serverMeta.lastModified);
          if (clientTime > serverTime) {
            console.warn(`📁 변경이 최신 → 업로드: ${rel}`);
            await uploadFile(id, fullPath, rel);
          } else {
            console.warn(`📁 서버가 최신 → 다운로드: ${rel}`);
            const blob = await downloadFolderFile(id, rel);
            const arrayBuf = await blob.arrayBuffer();
            const dest = path.join(root, rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, Buffer.from(arrayBuf));
          }
          ipcRenderer.send('sync-file-updated', { folderId: id, relativePath: rel });
        } else {
          console.log(`📁 변경없음 (해시 동일): ${rel}`);
        }
      } else {
        console.warn(`📁 서버에 없음 → 신규 업로드: ${rel}`);
        await uploadFile(id, fullPath, rel);
        ipcRenderer.send('sync-file-added', { folderId: id, relativePath: rel });
      }
      const clientMap = prevClientMapRef.current[id] || new Map();
      clientMap.set(rel, newFileMeta);

      // for (const [serverRel, serverMetaItem] of serverMap.entries()) {
      //   if (serverRel.endsWith('/')) continue; // ← 🛠 폴더 엔트리는 무시

      //   if (!localPaths.has(serverRel)) {
      //     console.warn(`☁️ 서버에만 있음 → 로컬로 다운로드: ${serverRel}`);
      //     const blob = await downloadFolderFile(id, serverRel);
      //     const arrayBuf = await blob.arrayBuffer();
      //     const dest = path.join(root, serverRel);
      //     fs.mkdirSync(path.dirname(dest), { recursive: true });
      //     fs.writeFileSync(dest, Buffer.from(arrayBuf));
      //     ipcRenderer.send('sync-file-added', { folderId: id, relativePath: serverRel });
  
      //     const stat = fs.statSync(dest);
      //     const buf = fs.readFileSync(dest);
      //     const downloadedMeta = {
      //       originalName: path.basename(dest),
      //       relativePath: serverRel,
      //       size: stat.size,
      //       hash: crypto.createHash('sha256').update(buf).digest('hex'),
      //       mimeType: mime.lookup(dest) || 'application/octet-stream',
      //       lastModified: new Date(stat.mtimeMs).toISOString()
      //     };
      //     clientMap.set(serverRel, downloadedMeta);
      //   }
      // }

      prevClientMapRef.current[id] = clientMap;
  
    } catch (e) {
      console.warn(`handleLocalAdd[${id}]`, e);
    }
  }

// ── 로컬 파일 변경 핸들러 ──
const handleLocalChange = async (filePath, id, root) => {
  try {
    const rel = path.relative(root, filePath).replace(/\\/g, '/').trim() || path.basename(filePath);
    const stat = fs.statSync(filePath);
    const buf  = fs.readFileSync(filePath);
    const changedMeta = {
      originalName: path.basename(filePath),
      relativePath: rel,
      size: stat.size,
      hash: crypto.createHash('sha256').update(buf).digest('hex'),
      mimeType: mime.lookup(filePath) || 'application/octet-stream',
      lastModified: new Date(stat.mtimeMs).toISOString(),
    };
    console.log('📁 [SyncManager] 변경된 파일 메타데이터:', changedMeta);

    // 1) prevClientMapRef 에 이미 저장된 “최종 서버 버전(또는 마지막 비교 시점)” 
    const clientMap = prevClientMapRef.current[id] || new Map();
    const prevMeta = clientMap.get(rel);

    // 2) 서버와 비교: “진짜 내용(해시)이 완전히 같으면” skip
    if (prevMeta && prevMeta.hash === changedMeta.hash) {
      console.log(`📁 해시 동일(미세 mtime 변경 또는 빈 수정) → 업로드 스킵: ${rel}`);
      return;
    }    
    
    // 1) 서버 메타 조회 + normalizeRelPath
    const rawServerFiles = await getFolderFileList(id);
    const serverFiles = rawServerFiles.map(f => ({
      ...f,
      relativePath: normalizeRelPath(f.relativePath || f.originalName),
    }));
    const serverMap   = new Map(serverFiles.map(f => [f.relativePath, f]));
    const serverMeta  = serverMap.get(rel);    
    // // 2. 서버 메타 조회
    // const serverFiles = await getFolderFileList(id);
    // const serverMap   = new Map(serverFiles.map(f => [f.relativePath, f]));
    // const serverMeta  = serverMap.get(rel);

    if (serverMeta) {
      // 3. 해시가 다르면 업/다운 판단
      if (changedMeta.hash !== serverMeta.hash) {
        const clientTime = new Date(changedMeta.lastModified);
        const serverTime = new Date(serverMeta.lastModified);
        if (clientTime > serverTime) {
          console.warn(`📁 변경이 최신 → 업로드: ${rel}`);
          try {
            await uploadFile(id, filePath, rel);
          } catch (e) {
            // 만약 서버에서 500을 던진다면, “이미 같은 경로에 동일 내용이 있거나” 업로드가 불필요한 상황이라고 판단하고 무시
            if (e.message.includes('HTTP 500')) {
              console.warn(`⚠️ [SyncManager] 업로드 500 무시 (이미 최신일 수 있음): ${rel}`);
            } else {
              throw e;
            }
          }
          // await uploadFile(id, filePath, rel);
        } else {
          console.warn(`📁 서버가 최신 → 다운로드: ${rel}`);
          const blob = await downloadFolderFile(id, rel);
          const arrayBuf = await blob.arrayBuffer();
          const dest = path.join(root, rel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, Buffer.from(arrayBuf));
        }
        ipcRenderer.send('sync-file-updated', { folderId: id, relativePath: rel });
      } else {
        console.log(`📁 변경없음 (해시 동일): ${rel}`);
      }
    } else {
      // 4. 서버에 없는 새 파일 → 업로드
      console.warn(`📁 서버에 없음 → 신규 업로드: ${rel}`);
      await uploadFile(id, filePath, rel);
      ipcRenderer.send('sync-file-updated', { folderId: id, relativePath: rel });
    }

    // 5. 클라이언트 맵 갱신
    // const clientMap = prevClientMapRef.current[id] || new Map();
    clientMap.set(rel, changedMeta);
    prevClientMapRef.current[id] = clientMap;

  } catch (e) {
    console.error(`❌ handleLocalChange[${id}]`, e);
  }
};

  // ── 로컬 파일 삭제 핸들러 ──
  async function handleLocalDelete(fullPath, id, root) {
    try {
      let rel        = path.relative(root, fullPath).replace(/\\/g,'/');
      // 서버 메타 가져온 뒤, normalizeRelPath
      const rawServerFiles = await getFolderFileList(id);
      const serverFiles = rawServerFiles.map(f => ({
        ...f,
        relativePath: normalizeRelPath(f.relativePath || f.originalName),
      }));
      const meta = serverFiles.find(f => f.relativePath === rel || f.originalName === rel);
      const fileId = meta?.id ?? meta?.fileId;
      if (!fileId) {
        console.warn(`삭제된 파일 : ${rel}`);
        return;
      }      

      // const serverList = await getFolderFileList(id);
      // const meta       = serverList.find(f =>
      //   f.relativePath === rel ||
      //   // 혹시 originalName 만 있는 경우를 대비해
      //   f.originalName === rel
      // );
      // const fileId     = meta?.id ?? meta?.fileId;
      // if (!fileId) return console.warn(`삭제된 파일 : ${rel}`);
      
      // 서버에 DELETE 요청
      console.warn(`📁 [SyncManager] 서버에 삭제 요청 → folderId=${id}, fileId=${fileId}`);
      await deleteFolderFile(id, fileId);
      
      // 로컬 FS에서도 즉시 삭제
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        console.warn(`📁 [SyncManager] 로컬 파일 삭제 → ${fullPath}`);
      }
      prevClientMapRef.current[id]?.delete(rel);

      console.warn(`📁 [SyncManager] IPC 보내기 → sync-file-deleted (folderId=${id}, relativePath=${rel})`);
      ipcRenderer.send('sync-file-deleted', { folderId: id, relativePath: rel });
    } catch (e) {
      console.error(`handleLocalDelete[${id}]`, e);
    }
  }

  // ── 로컬에서 서브폴더 추가 동기화 ──
  async function handleLocalSubAdd(folderPath, id, root) {
    try {
      const rel = path.relative(root, folderPath).replace(/\\/g, '/');
      if (rel === '') return; // root는 제외
      if (!prevClientMapRef.current[id]) {
        prevClientMapRef.current[id] = {};
      }
      const clientMap = prevClientMapRef.current[id];
      if (clientMap.has(rel + '/')) return;

      clientMap.set(rel + '/', {
        type: 'directory',
        sha256: '',
        updatedAt: Date.now(),
      });      
      // if (prevClientMapRef.current[id][rel + '/']) return;
      // prevClientMapRef.current[id][rel + '/'] = {
      //   type: 'directory',
      //   sha256: '',
      //   updatedAt: Date.now(),
      // };

      console.log(`📁 [SyncManager] 서브폴더 추가 → ${rel}/`);
      ipcRenderer.send('sub-folder-added', { folderId: id, relativePath: rel });
      prevClientMapRef.current[id] = clientMap;
    } catch (e) {
      console.error(`❌ handleLocalSubAdd[${id}]`, e);
    }
  }

    // ── 로컬에서 서브폴더 삭제 동기화 ──
  async function handleLocalSubDelete(fullPath, id, root) {
    try {
      const rel = path.relative(root, fullPath).replace(/\\/g, '/') + '/';
      const clientMap = prevClientMapRef.current[id] || new Map();
      if (clientMap.has(rel)) {
        console.log(`📁 [SyncManager] 서브폴더 삭제 → ${rel}`);

        // const serverFiles = await getFolderFileList(id);
        // 서버 메타 가져온 뒤, normalizeRelPath
        const rawServerFiles = await getFolderFileList(id);
        const serverFiles = rawServerFiles.map(f => ({
          ...f,
          relativePath: normalizeRelPath(f.relativePath || f.originalName),
        }));

        for (const f of serverFiles) {
          if (f.relativePath.startsWith(rel) && !f.relativePath.endsWith('/')) {
            const fileId = f.id ?? f.fileId;
            await deleteFolderFile(id, fileId);
          }
        }
        clientMap.delete(rel);
        prevClientMapRef.current[id] = clientMap;
        ipcRenderer.send('sub-folder-removed', { folderId: id, relativePath: rel });
      }
    } catch (e) {
      console.error(`❌ handleLocalSubDelete[${id}]`, e);
    }
  }

  // ── 서버에서 서브폴더 삭제 동기화 ──
  async function handleServerSubDelete(fullPath, id, root) {
    try {
      if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()) {
        fs.rmdirSync(fullPath, { recursive: true }); // 로컬 디렉토리 삭제
        console.log(`📁 [SyncManager] 서버에서 서브폴더 삭제 반영됨 → ${fullPath}`);
  
        // 클라이언트 맵에서 제거
        const rel = path.relative(root, fullPath).replace(/\\/g, '/') + '/';
        const clientMap = prevClientMapRef.current[id];
        if (clientMap && clientMap.has(rel)) {
          clientMap.delete(rel);
        }
      }
    } catch (e) {
      console.error(`❌ handleServerSubDelete[${id}]`, e);
    }
  }

  // ── 로컬에서 메인폴더 추가 동기화 ──
  async function handleLocalRootAdd(absPath) {
    // 1) 이미 등록된 폴더면 아무것도 안 함
    if (folders.some(f => f.folderPath === absPath)) return;
    console.warn('로컬에서 폴더 추가가 감지되었습니다.');
    try {
      // 1) 서버에 “메인 폴더” 등록
      const created = await sendSyncFolder(absPath).catch(e => {
        if (e.message.includes('Internal Server Error')) {
          console.warn('[SyncManager] 중복 등록으로 서버 에러 무시:', absPath);
          return null;
        }
        throw e;
      });
      if (!created) return;
      const folderId = created.id;
  
      // 2) 로컬 전체 스캔 (Home.jsx 코드 참고)
      // const clientFiles = [];
      // function walk(currentDir) {
      //   fs.readdirSync(currentDir, { withFileTypes: true }).forEach(entry => {
      //     const full = path.join(currentDir, entry.name);
      //     const rel  = path.relative(absPath, full).replace(/\\/g, '/');
      //     if (entry.isFile()) {
      //       const buf  = fs.readFileSync(full);
      //       const stat = fs.statSync(full);
      //       clientFiles.push({
      //         originalName: rel,
      //         relativePath: rel,
      //         size: stat.size,
      //         hash: crypto.createHash('sha256').update(buf).digest('hex'),
      //         mimeType: mime.lookup(full) || 'application/octet-stream',
      //         lastModified: new Date(stat.mtimeMs).toISOString(),
      //         // versionNumber: 1,         // 업로드 직후엔 1 또는 서버가 응답해준 값을 덮어쓰기
      //         // versionType: 'SNAPSHOT',  // 또는 'DIFF'
      //       });
      //     } else if (entry.isDirectory()) {
      //       walk(full);
      //     }
      //   });
      // }
      // walk(absPath);
      const clientFiles = buildClientFiles(absPath);
  
      // 3) 메타 동기화 요청
      const { filesToUpload = [] } =
        await syncFolder(folderId, clientFiles, []);
  
      // 4) 서버에 업로드
      for (const rel of filesToUpload) {
        await uploadFile(folderId, path.join(absPath, rel), rel);
        // ipcRenderer.send('sync-file-added', { folderId, relativePath: rel });
      }

      // ● “새로 추가된 폴더”는 이미 여기서 완전 동기화했으므로
      //   doSync()에서 다시 처리할 필요가 없도록 표시해 둔다
      initialSyncDoneRef.current[folderId] = true;
      // 6) 로컬 상태 업데이트
      setFolders(prev => {
        if (prev.some(f => f.id === folderId)) return prev;
        return [...prev, created];
      });
      folderPathMap.current[folderId] = absPath;

      // 7) IPC로 홈 화면(및 나머지 컴포넌트)에 “폴더 추가” 알리기
      ipcRenderer.send('dosync-folder-added', created);      
  
    } catch (e) {
      console.error('handleLocalRootAdd 에러:', e);
    }
  }

  // ── 로컬에서 메인폴더 삭제 동기화 ──
  async function handleLocalRootDelete(id) {
    // 1) 서버에 '동기화 폴더' 삭제 API 호출
    await deleteSyncFolder(id); // API 서비스에 정의된 함수
    // 2) IPC로 홈 화면에 알려주기
    ipcRenderer.send('sync-folder-removed', { folderId: id, folderPath: folderPathMap.current[id] });
    // 3) 로컬 map 정리
    delete folderPathMap.current[id];
    setFolders(prev => prev.filter(f => f.id !== id));
  }
  
  // // ── 로그아웃 시 플래그 및 상태 초기화 ──
  // useEffect(() => {
  //   const onLogout = () => {
  //     // 다음 로그인 때 다시 초기 로드 & doSync()가 돌도록 모두 리셋
  //     autoRegisteredRef.current   = false;
  //     initialSyncDoneRef.current  = {};
  //     setFolders([]);
  //   };
  //   ipcRenderer.on('user-logged-out', onLogout);
  //   return () => {
  //     ipcRenderer.removeListener('user-logged-out', onLogout);
  //   };
  // }, []);



  // ── 컴포넌트 첫 렌더링 시 “initialSyncDoneRef” 한 번만 초기화 ──
  useEffect(() => {
    initialSyncDoneRef.current = {};
  }, []);

  // ── 초기 싱크폴더 로드 & 루트폴더 자동 등록 ──
  useEffect(() => {
    if (autoRegisteredRef.current) return;
    autoRegisteredRef.current = true;

    const dir = localStorage.getItem('userDir');
    if (!dir) return;

    (async () => {

      // 1) 서버에 올라간 폴더 목록
      const serverFolders = await getSyncFolder() || [];
      setFolders(serverFolders);

      // 2) 로컬 디렉토리 scan
      const known = new Set(serverFolders.map(f => f.folderPath));
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.') && d.name !== '_Delete')
        .map(d => d.name);

      for (const name of entries) {
        const abs = path.join(dir, name);
        if (known.has(abs)) continue;

        console.log(`➕ [초기동기] 로컬 전용 폴더 → 서버등록: ${abs}`);
        const created = await sendSyncFolder(abs);
        const newId   = created.id;

        // 전체 메타 송신/업로드
        const clientFiles = buildClientFiles(abs);
        const { filesToUpload = [] } = await syncFolder(newId, clientFiles, []);
        for (const rel of filesToUpload) {
          await uploadFile(newId, path.join(abs, rel), rel);
        }

        // “초기 로드 시 동기화 완료” 표시
        initialSyncDoneRef.current[newId] = true;

        setFolders(prev => [...prev, created]);
        folderPathMap.current[newId] = abs;
        ipcRenderer.emit('dosync-folder-added', null, created);
      }
    })();
  }, []);

// ── “Home.jsx에서 이미 초기 동기화까지 끝난 폴더 추가” 이벤트 받기 ──
useEffect(() => {
  const onDosyncFolderAdd = async (_e, folder) => {
    console.warn(`📁 [SyncManager] (초기 동기화 이미 끝난) 폴더 추가 수신 → id=${folder.id}, path=${folder.folderPath}`);
    setFolders(prev => {
      if (prev.some(f => f.id === folder.id)) return prev;
      return [...prev, folder];
    });
    // 이미 Home.jsx에서 초기 업로드/다운로드를 마쳤으므로 doSync()에서 SKIP되도록 true로 표시
    initialSyncDoneRef.current[folder.id] = true;
    folderPathMap.current[folder.id] = folder.folderPath;

        // ② 서버 파일 메타를 미리 가져와서 prevClientMapRef 에 채워 둔다
  try {
    const rawServerFiles = await getFolderFileList(folder.id);
    const serverFiles = rawServerFiles.map(f => ({
      ...f,
      relativePath: normalizeRelPath(f.relativePath || f.originalName),
    }));
    
    const clientMap = new Map();
    serverFiles.forEach(f => {
      // 폴더 항목(ending with "/") 은 건너뛴다
      if (f.relativePath.endsWith('/')) return;
      clientMap.set(f.relativePath, {
        originalName: path.basename(f.relativePath),
        relativePath: f.relativePath,
        size: f.size ?? 0,               // 서버에서 size 정보가 있으면 쓰고, 없으면 0
        hash: f.hash || '',              // 서버에서 hash 정보가 있으면 쓰고, 없으면 빈 문자열
        lastModified: f.lastModified,    // 서버 메타에 lastModified가 있다면
      });
    });
    prevClientMapRef.current[folder.id] = clientMap;
  } catch (e) {
    console.warn(`⚠️ [SyncManager] 초기 prevClientMap 셋업 중 에러`, e);
    // 어쨌든 빈 Map이라도 두면 다음 비교에서 "서버에 없음"이 아니라 "서버 해시 ""(빈)이므로 실제 변경과 달리
    // mtime만 바뀐 순간엔 해시 비교 시 같은 내용(빈→빈)이어서 upload가 스킵됨
    prevClientMapRef.current[folder.id] = new Map();
  }
    
  };

  ipcRenderer.on('flag-folder-added', onDosyncFolderAdd);
  return () => {
    ipcRenderer.removeListener('flag-folder-added', onDosyncFolderAdd);
  };
}, []);


  // 1) IPC로 “local-folder-added” 받기
useEffect(() => {
  const onLocalAdded = (_e, absPath) => {
    justAdded.current.add(absPath);
  };
  ipcRenderer.on('local-folder-added', onLocalAdded);
  return () => {
    ipcRenderer.removeListener('local-folder-added', onLocalAdded);
  };
}, []);

// 2) chokidar watcher: addDir 이벤트 무시 로직
useEffect(() => {
  if (!userDir) return;
  const watcher = chokidar.watch(userDir, {
    ignoreInitial: true,
    depth: 1,
    persistent: true,
  });

  const onAddDir = async (absPath) => {
    // ① Home.jsx에서 보낸 경로면 justAdded 세트에 담겨 있음 → 무시
    if (justAdded.current.has(absPath)) {
      justAdded.current.delete(absPath);
      return;
    }

    // ② userDir 바로 아래 레벨만 처리
    const rel = path.relative(userDir, absPath).replace(/\\/g, '/');
    if (rel && !rel.includes('/')) {
      // “진짜 외부에서 생성된” 메인 폴더라면 서버에 등록
      await handleLocalRootAdd(absPath);
    }
  };

  watcher.on('addDir', onAddDir);
  return () => watcher.close();
}, [userDir, folders]);

  // 루트경로에서 메인폴더 추가/삭제 동시 처리
  useEffect(() => {
    const onSyncFolderAdd = (_e, folder) => {
      console.warn(`📁 [SyncManager] 폴더 추가 수신 → id=${folder.id}, path=${folder.folderPath}`);
      setFolders(prev => {
        if (prev.some(f => f.id === folder.id)) return prev;
        return [...prev, folder];
      });
      folderPathMap.current[folder.id] = folder.folderPath;
    };
    const onSyncFolderRemove = (_e, { folderId, folderPath }) => {
      console.warn(`📁 [SyncManager] 폴더 삭제 수신 → id=${folderId}`);
      if (folderPath && fs.existsSync(folderPath)) {
        fs.rmdirSync(folderPath, { recursive: true });
        console.warn(`📁 [SyncManager] 로컬 폴더 삭제 → ${folderPath}`);
      }
      delete folderPathMap.current[folderId];
      setFolders(prev => prev.filter(f => f.id !== folderId));
    };
    ipcRenderer.on('sync-folder-added',   onSyncFolderAdd);
    ipcRenderer.on('sync-folder-removed', onSyncFolderRemove);
    return () => {
      ipcRenderer.removeListener('sync-folder-added',   onSyncFolderAdd);
      ipcRenderer.removeListener('sync-folder-removed', onSyncFolderRemove);
    };
  }, []);

  // ── 2) 로컬에서 서브폴더 추가/삭제 이벤트만 처리 ──
  useEffect(() => {
    const onSubFolderAdd = (_e, { folderId, relativePath }) => {
      console.log(`📂 [SyncManager] 서브폴더 추가 수신 → folderId=${folderId}, rel=${relativePath}`);
      // 이미 prevClientMapRef에 등록된 폴더는 무시되므로,
      // 추가로 뭔가 할 게 없다면 이 자리에 로깅만 남기셔도 됩니다.
      // (필요시 UI에 빈폴더 보존 로직 등 추가)
    };
    const onSubFolderRemove = (_e, { folderId, relativePath }) => {
      console.log(`📂 [SyncManager] 서브폴더 삭제 수신 → folderId=${folderId}, rel=${relativePath}`);
      // prevClientMapRef에서도 지워졌다면 별도 처리 불필요
    };

    ipcRenderer.on('sub-folder-added',   onSubFolderAdd);
    ipcRenderer.on('sub-folder-removed', onSubFolderRemove);
    return () => {
      ipcRenderer.removeListener('sub-folder-added',   onSubFolderAdd);
      ipcRenderer.removeListener('sub-folder-removed', onSubFolderRemove);
    };
  }, []);


  // 서버에서 서브폴더 삭제시 이벤트 처리
  useEffect(() => {
    ipcRenderer.on('sub-folder-removed-server', async (_, { folderId, relativePath }) => {
      const root = folderPathMap.current[folderId];
      if (!root) return;
  
      const fullPath = path.join(root, relativePath);
      await handleServerSubDelete(fullPath, folderId, root);
    });
  
    return () => {
      ipcRenderer.removeAllListeners('sub-folder-removed-server');
    };
  }, []);


  // Watch folders and poll server
  useEffect(() => {
    // Cleanup
    Object.values(watchersRef.current).forEach(w => w.close());
    Object.values(intervalsRef.current).forEach(i => clearInterval(i));
    watchersRef.current = {};
    intervalsRef.current = {};
    prevClientMapRef.current = {};

    folders.forEach(folder => {
      const { id, folderPath: root } = folder;
      if (!id || !root) {
        console.warn('[SyncManager] 잘못된 폴더 데이터 무시:', folder);
        return;
      }      
      prevClientMapRef.current[id] = new Map();

      if (!initialSyncDoneRef.current[id]) {
        const doSync = async () => {
          if (initialSyncDoneRef.current[id]) {
            // 이미 한 번 doSync를 돌렸으면 스킵
            return;
          }
          try {
            // 서버에서 폴더가 삭제되었는지 체크
            try {
              await getSyncFolder();
            } catch (e) {
              if (e.message.startsWith('HTTP 404')) {
                console.warn(`✂️ [SyncManager] 서버에서 폴더(${id}) 삭제됨 → 로컬에서도 제거`);
                watchersRef.current[id]?.close();
                clearInterval(intervalsRef.current[id]);
                fs.rmSync(root, { recursive: true, force: true });
                setFolders(prev => prev.filter(f => f.id !== id));
                return;
              }
              throw e;
            }       
        
            // 로컬 폴더가 존재하지 않는 경우 전체 재다운로드
            if (!fs.existsSync(root)) {
              console.warn(`📁 [SyncManager] 로컬 폴더가 사라졌습니다. 재생성 후 전체 다운로드 → ${root}`);
              fs.mkdirSync(root, { recursive: true });

              const rawServerList = await getFolderFileList(id);
              const serverList = rawServerList.map(f => ({
                ...f,
                relativePath: normalizeRelPath(f.relativePath || f.originalName),
              }));

              for (const f of serverList) {
                const rel = f.relativePath;
                // || f.originalName;
                const dest = path.join(root, rel);
                // 1) 디렉터리면 폴더 생성만
                if (rel.endsWith('/')) {
                  if (!fs.existsSync(dest)) {
                    fs.mkdirSync(dest, { recursive: true });
                    ipcRenderer.send('sub-folder-added', { folderId: id, relativePath: rel });
                  }
                  continue;
                }
                // 2) 루트에 있는 파일만 다운로드 (서브폴더 내 파일 제외)
                // 만약 서브폴더 내 파일 다운로드가 구현된다면, if문만 제거하면 된다.
                try {
                  const blob = await downloadFolderFile(id, rel);
                  const buf = await blob.arrayBuffer();
                  fs.mkdirSync(path.dirname(dest), { recursive: true });
                  fs.writeFileSync(dest, Buffer.from(buf));
                  ipcRenderer.send('sync-file-added', { folderId: id, relativePath: rel });
                } catch (e) {
                  if (e.message.startsWith('HTTP 404')) {
                    console.warn(`📁 [SyncManager] 다운로드 실패 (404): ${rel}`);
                  } else {
                    console.error(`📁 [SyncManager] 다운로드 실패: ${rel}`, e);
                  }
                }            
  
              }
              initialSyncDoneRef.current[id] = true;
              return;
            }
  
            // 3) 이제 “증분 동기화” 단계: 로컬 ↔ 서버 메타 비교
  
            // 3-1) 로컬 전체 메타 수집
            const localList = buildClientFiles(root);
            const localMap  = new Map(localList.map(f => [f.relativePath, f]));
  
            // 3-2) 서버 전체 메타 수집
            // const serverList = await getFolderFileList(id);
            const rawServerList = await getFolderFileList(id);
            const serverList = rawServerList.map(f => ({
              ...f,
              relativePath: normalizeRelPath(f.relativePath || f.originalName),
            }));            
            const serverMap  = new Map(serverList.map(f => [f.relativePath, f]));
  
            // 3-3) ▷ 로컬에만 있는 파일 → 서버로 업로드
            for (const [rel, _localMeta] of localMap.entries()) {
              // skip 숨김파일/폴더, 그리고 디렉터리
              if (rel.startsWith('.') || rel.endsWith('/')) continue;
              if (!serverMap.has(rel)) {
                console.warn(`☁️ 로컬 전용 파일 → 업로드: ${rel}`);
                await uploadFile(id, path.join(root, rel), rel);
                ipcRenderer.send('sync-file-added', { folderId: id, relativePath: rel });
              }
            }
  
            // 3-4) ▷ 서버에만 있는 파일 → 로컬로 다운로드 (서브폴더 내 파일 제외)
            for (const [rel, _serverMeta] of serverMap.entries()) {
              // skip 폴더 엔트리, 숨김파일
              if (rel.endsWith('/') || rel.startsWith('.')) continue;
              // only download root-level files
              // (!localMap.has(rel) && !rel.includes('/'))
              if (!localMap.has(rel)) {
                console.warn(`☁️ 서버 전용 파일 → 다운로드: ${rel}`);
                const blob = await downloadFolderFile(id, rel);
                const buf  = await blob.arrayBuffer();
                const dest = path.join(root, rel);
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.writeFileSync(dest, Buffer.from(buf));
                ipcRenderer.send('sync-file-added', { folderId: id, relativePath: rel });
              }
            }
  
            // 3-5) ▷ 변경된 파일 동기화 (해시 비교)
            for (const [rel, localMeta] of localMap.entries()) {
              if (rel.startsWith('.') || rel.endsWith('/')) continue;
              const serverMeta = serverMap.get(rel);
              if (serverMeta) {
                if (localMeta.hash !== serverMeta.hash) {
                  const clientTime = new Date(localMeta.lastModified);
                  const serverTime = new Date(serverMeta.lastModified);
                  if (clientTime > serverTime) {
                    console.warn(`🔼 로컬이 최신 → 업로드: ${rel}`);
                    await uploadFile(id, path.join(root, rel), rel);
                    ipcRenderer.send('sync-file-updated', { folderId: id, relativePath: rel });
                  } else {                 
                    console.warn(`🔽 서버가 최신 → 다운로드: ${rel}`);
                    const blob = await downloadFolderFile(id, rel);
                    const buf  = await blob.arrayBuffer();
                    const dest = path.join(root, rel);
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    fs.writeFileSync(dest, Buffer.from(buf));
                    ipcRenderer.send('sync-file-updated', { folderId: id, relativePath: rel });
                  }
                }
              }
            }
        
            initialSyncDoneRef.current[id] = true;
        
          } catch (e) {
            console.error('📁 [SyncManager] 동기화 중 에러 발생:', e);
          }
        };
        
        doSync();
      }

      // File system watcher
      const watcher = chokidar.watch(root, {
        ignored: /(^|[\/\\])\..+|~$|\.swp$/,
        ignoreInitial: true,
        persistent: true,
        depth: Infinity,
        awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 }
      });   

      watcher 
      .on('add', p => handleLocalAdd(p, id, root))
      .on('change', p => handleLocalChange(p, id, root))
      .on('unlink', p => handleLocalDelete(p, id, root))
      .on('addDir', p => handleLocalSubAdd(p, id, root))
      .on('unlinkDir', p => {
        const rel = path.relative(root, p).replace(/\\/g, '/');
        if (rel === '') {
          // 로컬에서 메인폴더 삭제 시 일단 파일변경 감지를 꺼야한다.
          watcher.close();
          // handleLocalRootDelete(id);
        } else {
          handleLocalSubDelete(p, id, root);
        }
      });

      watchersRef.current[id] = watcher;
    });

    return () => {
      Object.values(watchersRef.current).forEach(w => w.close());
      Object.values(intervalsRef.current).forEach(i => clearInterval(i));
    };
  }, [folders]);


  return null; // UI 없음
}
