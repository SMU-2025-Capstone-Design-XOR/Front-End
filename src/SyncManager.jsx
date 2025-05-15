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

// 로그인 시 localStorage에 저장된 계정 폴더 경로
const userDir = localStorage.getItem('userDir');


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

export default function SyncManager() {
  const [folders, setFolders] = useState([]);
  const watchersRef           = useRef({});
  const intervalsRef          = useRef({});
  const prevClientMapRef      = useRef({}); // { [folderId]: Map<relativePath, FileMeta> }
  const initialSyncDoneRef    = useRef({}); // Tracks if initial sync is completed per folder
  const navigate              = useNavigate();
  const folderPathMap = useRef({});

  const justAdded = useRef(new Set());

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

    watcher.on('addDir', absPath => {
      // Home.jsx에서 보낸 경로라면 무시
      if (justAdded.current.has(absPath)) {
        justAdded.current.delete(absPath);
        return;
      }
      // 진짜 외부에서 추가된 폴더만 처리
      const rel = path.relative(userDir, absPath).replace(/\\/g, '/');
      if (rel && !rel.includes('/')) {
        handleLocalRootAdd(absPath);
      }
    });

    return () => watcher.close();
  }, [userDir]);


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
      console.log(`📂 [handleLocalAdd] 파일 추가됨: ${rel}`);
  
      const stat = fs.statSync(fullPath);
      const buf = fs.readFileSync(fullPath);
      const newFileMeta = {
        originalName: path.basename(fullPath),
        relativePath: rel,
        size: stat.size,
        hash: crypto.createHash('sha256').update(buf).digest('hex'),
        mimeType: mime.lookup(fullPath) || 'application/octet-stream',
        lastModified: new Date(stat.mtimeMs).toISOString()
      };
  
      const serverFiles = await getFolderFileList(id);
      const serverMap = new Map(serverFiles.map(f => [f.relativePath, f]));
      const serverMeta = serverMap.get(rel);

  
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
    console.log(`📁 [handleLocalChange] 시작 → ${rel}`);

    // 1. 변경된 메타 계산
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
    // 2. 서버 메타 조회
    const serverFiles = await getFolderFileList(id);
    const serverMap   = new Map(serverFiles.map(f => [f.relativePath, f]));
    const serverMeta  = serverMap.get(rel);

    if (serverMeta) {
      // 3. 해시가 다르면 업/다운 판단
      if (changedMeta.hash !== serverMeta.hash) {
        const clientTime = new Date(changedMeta.lastModified);
        const serverTime = new Date(serverMeta.lastModified);
        if (clientTime > serverTime) {
          console.warn(`📁 변경이 최신 → 업로드: ${rel}`);
          await uploadFile(id, filePath, rel);
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
    const clientMap = prevClientMapRef.current[id] || new Map();
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
      const serverList = await getFolderFileList(id);
      const meta       = serverList.find(f =>
        f.relativePath === rel ||
        // 혹시 originalName 만 있는 경우를 대비해
        f.originalName === rel
      );
      const fileId     = meta?.id ?? meta?.fileId;
      if (!fileId) return console.warn(`삭제된 파일 : ${rel}`);
      
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
      // 이미 존재하는 경우 무시
      if (prevClientMapRef.current[id][rel + '/']) return;
      // 등록
      prevClientMapRef.current[id][rel + '/'] = {
        type: 'directory',
        sha256: '',
        updatedAt: Date.now(),
      };
      console.log(`📁 [SyncManager] 서브폴더 추가 → ${rel}/`);
      ipcRenderer.send('sub-folder-added', { folderId: id, relativePath: rel });
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
        const serverFiles = await getFolderFileList(id);
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
    
    try {
      // 1) 서버에 “메인 폴더” 등록
      // const created = await sendSyncFolder(absPath);
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
      const clientFiles = [];
      function walk(currentDir) {
        fs.readdirSync(currentDir, { withFileTypes: true }).forEach(entry => {
          const full = path.join(currentDir, entry.name);
          const rel  = path.relative(absPath, full).replace(/\\/g, '/');
          if (entry.isFile()) {
            const buf  = fs.readFileSync(full);
            const stat = fs.statSync(full);
            clientFiles.push({
              originalName: rel,
              relativePath: rel,
              size: stat.size,
              hash: crypto.createHash('sha256').update(buf).digest('hex'),
              mimeType: mime.lookup(full) || 'application/octet-stream',
              lastModified: new Date(stat.mtimeMs).toISOString(),
            });
          } else if (entry.isDirectory()) {
            walk(full);
          }
        });
      }
      walk(absPath);
  
      // 3) 메타 동기화 요청
      const { filesToUpload = [], filesToDownload = [] } =
        await syncFolder(folderId, clientFiles, []);
  
      // 4) 서버에 업로드
      for (const rel of filesToUpload) {
        await uploadFile(folderId, path.join(absPath, rel), rel);
        ipcRenderer.send('sync-file-added', { folderId, relativePath: rel });
      }
  
      // 5) 서버에서 다운로드 (서브폴더 내 파일 제외)
      for (const rel of filesToDownload) {
        if (!rel.includes('/')) {
          const blob = await downloadFolderFile(folderId, rel);
          const buf  = await blob.arrayBuffer();
          const dest = path.join(absPath, rel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, Buffer.from(buf));
          ipcRenderer.send('sync-file-added', { folderId, relativePath: rel });
        }
      }
  
      // 6) 로컬 상태 업데이트
      setFolders(prev => [...prev, created]);
      folderPathMap.current[folderId] = absPath;

      // 7) IPC로 홈 화면(및 나머지 컴포넌트)에 “폴더 추가” 알리기
      ipcRenderer.send('sync-folder-added', created);      
  
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
  

  // 루트경로에서 메인폴더 추가/삭제 동시 처리
  useEffect(() => {
    const onSyncFolderAdd = (_e, folder) => {
      console.warn(`📁 [SyncManager] 폴더 추가 수신 → id=${folder.id}, path=${folder.folderPath}`);
      // setFolders(prev => [...prev, folder]);
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


  // ── 초기 싱크폴더 로드 ──
  useEffect(() => {
    (async () => {
      try { 
        setFolders(await getSyncFolder() || []); 
      } 
      catch (e) { 
        console.error(e);
        if (e.message.startsWith('HTTP 403')) { 
          localStorage.removeItem('token'); 
          alert('세션 만료, 재로그인 필요');
          navigate('/'); 
        } 
      }
    })();
  }, []);


  // // 계정 폴더 전체에 대한 watcher
  // useEffect(() => {
  //   if (!userDir) return;
  //   const userWatcher = chokidar.watch(userDir, {
  //     ignoreInitial: true,
  //     depth: 1,           // 최상위 폴더만
  //     persistent: true,
  //     awaitWriteFinish: {
  //       stabilityThreshold: 500,
  //       pollInterval: 100
  //     }
  //   });

  //   userWatcher.on('addDir', absPath => {
  //     // userDir 바로 아래에 추가된 새 폴더만 처리
  //     const rel = path.relative(userDir, absPath).replace(/\\/g,'/');
  //     if (rel && !rel.includes('/')) {
  //       console.log('[계정폴더] 새 동기 대상 폴더 감지 →', rel);
  //       handleLocalRootAdd(absPath);
  //     }
  //   });

  //   return () => userWatcher.close();
  // }, [userDir]);

  // Watch folders and poll server
  useEffect(() => {
    // Cleanup
    Object.values(watchersRef.current).forEach(w => w.close());
    Object.values(intervalsRef.current).forEach(i => clearInterval(i));

    watchersRef.current = {};
    intervalsRef.current = {};
    prevClientMapRef.current = {};
    initialSyncDoneRef.current = {};

    folders.forEach(folder => {
      const { id, folderPath: root } = folder;
      prevClientMapRef.current[id] = new Map();
      initialSyncDoneRef.current[id] = false;
      if (!id || !root) {
        console.warn('[SyncManager] 잘못된 폴더 데이터 무시:', folder);
        return;
      }      

      const doSync = async () => {
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
            const serverList = await getFolderFileList(id);
            for (const f of serverList) {
              const rel = f.relativePath || f.originalName;
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
              if (!rel.includes('/')) {
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
              } else {
                console.log(`🚫 [SyncManager] 서브폴더 내 파일 제외됨: ${rel}`);
              }              
              
              // // 2) 파일이면 다운로드(현재 서브폴더 내 파일이 다운로드가 되지 않는 상황이여서 주석함.)
              // try {
              //   const blob = await downloadFolderFile(id, rel);
              //   const buf = await blob.arrayBuffer();
              //   fs.mkdirSync(path.dirname(dest), { recursive: true });
              //   fs.writeFileSync(dest, Buffer.from(buf));
              //   ipcRenderer.send('sync-file-added', { folderId: id, relativePath: rel });
              // } catch (e) {
              //   if (e.message.startsWith('HTTP 404')) {
              //     console.warn(`📁 [SyncManager] 다운로드 실패 (404): ${rel}`);
              //   } else {
              //     console.error(`📁 [SyncManager] 다운로드 실패: ${rel}`, e);
              //   }
              // }


            }
            initialSyncDoneRef.current[id] = true;
            return;
          }

          // 3) 이제 “증분 동기화” 단계: 로컬 ↔ 서버 메타 비교

          // 3-1) 로컬 전체 메타 수집
          const localList = buildClientFiles(root);
          const localMap  = new Map(localList.map(f => [f.relativePath, f]));

          // 3-2) 서버 전체 메타 수집
          const serverList = await getFolderFileList(id);
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
            if (!localMap.has(rel) && !rel.includes('/')) {
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
                  // 서브폴더 내 파일은 변경 반영할 수 없다... 특히 다운로드.
                  if (!rel.includes('/')) {
                    console.warn(`🔽 서버가 최신 → 다운로드: ${rel}`);
                    const blob = await downloadFolderFile(id, rel);
                    const buf  = await blob.arrayBuffer();
                    const dest = path.join(root, rel);
                    fs.writeFileSync(dest, Buffer.from(buf));
                    ipcRenderer.send('sync-file-updated', { folderId: id, relativePath: rel });
                  } else {
                    console.log(`🚫 변경 반영 제외 (서브폴더 파일): ${rel}`);
                  }                  
                  // console.warn(`🔽 서버가 최신 → 다운로드: ${rel}`);
                  // const blob = await downloadFolderFile(id, rel);
                  // const buf  = await blob.arrayBuffer();
                  // const dest = path.join(root, rel);
                  // fs.writeFileSync(dest, Buffer.from(buf));
                  // ipcRenderer.send('sync-file-updated', { folderId: id, relativePath: rel });
                }
              }
            }
          }
      
          // cleanupEmptyDirs(root);
          initialSyncDoneRef.current[id] = true;
          // prevClientMapRef.current[id] = localMap;
      
        } catch (e) {
          console.error('📁 [SyncManager] 동기화 중 에러 발생:', e);
        }
      };      

      doSync();

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
