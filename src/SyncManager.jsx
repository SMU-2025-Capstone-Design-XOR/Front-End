// src/SyncManager.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import crypto from 'crypto';
import mime from 'mime-types';
import chokidar from 'chokidar';
const { ipcRenderer } = window.require('electron');
const fs   = window.require('fs');
const path = window.require('path');

import {
  getSyncFolder,
  getFolderFileList,
  syncFolder,
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

  // ── 전체 폴더 메타 스캔 ──
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
      const localFiles = buildClientFiles(root);
      const localPaths = new Set(localFiles.map(f => f.relativePath));
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

      for (const [serverRel, serverMetaItem] of serverMap.entries()) {
        if (!localPaths.has(serverRel)) {
          console.warn(`☁️ 서버에만 있음 → 로컬로 다운로드: ${serverRel}`);
          const blob = await downloadFolderFile(id, serverRel);
          const arrayBuf = await blob.arrayBuffer();
          const dest = path.join(root, serverRel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, Buffer.from(arrayBuf));
          ipcRenderer.send('sync-file-added', { folderId: id, relativePath: serverRel });
  
          const stat = fs.statSync(dest);
          const buf = fs.readFileSync(dest);
          const downloadedMeta = {
            originalName: path.basename(dest),
            relativePath: serverRel,
            size: stat.size,
            hash: crypto.createHash('sha256').update(buf).digest('hex'),
            mimeType: mime.lookup(dest) || 'application/octet-stream',
            lastModified: new Date(stat.mtimeMs).toISOString()
          };
          clientMap.set(serverRel, downloadedMeta);
        }
      }

      // clientMap.set(rel, newFileMeta);
      prevClientMapRef.current[id] = clientMap;
  
    } catch (e) {
      // console.error(`❌ handleLocalAdd[${id}]`, e);
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
  async function handleLocalSubAdd(fullPath, id, root) {
    try {
      const rel = path.relative(root, fullPath).replace(/\\/g, '/') + '/';
      if (rel.startsWith('.')) return;
      const clientMap = prevClientMapRef.current[id] || new Map();
      if (!clientMap.has(rel)) {
        console.log(`📁 [SyncManager] 서브폴더 추가 → ${rel}`);
        clientMap.set(rel, { relativePath: rel, originalName: rel, type: 'folder' });
        prevClientMapRef.current[id] = clientMap;
        ipcRenderer.send('sync-folder-added', { folderId: id, relativePath: rel });
      }
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
        ipcRenderer.send('sync-folder-removed', { folderId: id, relativePath: rel });
      }
    } catch (e) {
      console.error(`❌ handleLocalSubDelete[${id}]`, e);
    }
  }

  // 메인 폴더 내 서브폴더 삭제 처리
  // useEffect(() => {
  //   // console.log('SyncManager - folders 업데이트:', JSON.stringify(folders, null, 2));
  //   const onDeleteDir = (_e, payload) => {
  //     try {
  //       // 넘겨받은 payload 매개변수에 대응하는 값 넘겨받음
  //       const { folderId, relativePath } = payload;
  //       // 디버깅 처리
  //       console.warn('onDeleteDir - payload:', payload);
  //       console.warn('onDeleteDir - folders:', JSON.stringify(folders, null, 2));

  //       if (!folderId || !relativePath) {
  //         console.warn('onDeleteDir - 유효하지 않은 payload:', payload);
  //         return;
  //       }
  //       // IPC 통신을 통해 넘어온 삭제요청 파일의 존재 여부를 검사 -> 파일의 절대경로를 통해 상대경로를 구함
  //       const folder = folders.find(f => f.id === folderId);
  //       if (!folder) {
  //         console.warn(`onDeleteDir - folderId ${folderId}에 해당하는 폴더를 찾지 못함.`);
  //         return;
  //       }
  //       const root = folder.folderPath;
  //       const fullPath = path.join(root, relativePath);
  //       // 서버에서 삭제 요청을 한 것이므로 로컬에서 삭제해야한다.
  //       if (fs.existsSync(fullPath)) {
  //         fs.rmSync(fullPath, { recursive: true, force: true });
  //         console.warn(`📁 [SyncManager] 서브 폴더 삭제 완료 → ${fullPath}`);
  
  //         // UI 갱신
  //         ipcRenderer.send('sync-file-deleted', { folderId, relativePath });
  //       }
  
  //     } catch (error) {
  //       console.error('onDeleteDir - 에러:', error);
  //     }
  //   };
  //   ipcRenderer.on('delete-subfolder', onDeleteDir);
  //   return () => {
  //     ipcRenderer.removeListener('delete-subfolder', onDeleteDir);
  //   };
  // }, [folders]);

  // 루트경로에서 메인폴더 추가/삭제 동시 처리
  useEffect(() => {
    const onAdd = (_e, folder) => {
      console.warn(`📁 [SyncManager] 폴더 추가 수신 → id=${folder.id}, path=${folder.folderPath}`);
      setFolders(prev => [...prev, folder]);
    };
    const onRemove = (_e, { folderId, folderPath }) => {
      console.warn(`📁 [SyncManager] 폴더 삭제 수신 → id=${folderId}`);
      if (folderPath && fs.existsSync(folderPath)) {
        fs.rmdirSync(folderPath, { recursive: true });
        console.warn(`📁 [SyncManager] 로컬 폴더 삭제 → ${folderPath}`);
      }
      setFolders(prev => prev.filter(f => f.id !== folderId));
    };
    ipcRenderer.on('sync-folder-added',   onAdd);
    ipcRenderer.on('sync-folder-removed', onRemove);
    return () => {
      ipcRenderer.removeListener('sync-folder-added',   onAdd);
      ipcRenderer.removeListener('sync-folder-removed', onRemove);
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

          // 서버에만 있는 폴더 생성
          for (const [rel, meta] of serverMap) {
            if (rel.endsWith('/')) {
              const dest = path.join(root, rel);
              if (!fs.existsSync(dest)) {
                fs.mkdirSync(dest, { recursive: true });
                console.warn(`📁 [SyncManager] 서버 폴더 로컬에 생성됨 → ${dest}`);
                ipcRenderer.send('sync-folder-added', { folderId: id, relativePath: rel });
              }
            }
          }          
      
          // 로컬 폴더가 존재하지 않는 경우 전체 재다운로드
          if (!fs.existsSync(root)) {
            console.warn(`📁 [SyncManager] 로컬 폴더가 사라졌습니다. 재생성 후 전체 다운로드 → ${root}`);
            fs.mkdirSync(root, { recursive: true });
            const serverList = await getFolderFileList(id);
            for (const f of serverList) {
              const rel = f.relativePath || f.originalName;
              try {
                const blob = await downloadFolderFile(id, rel);
                const buf = await blob.arrayBuffer();
                const dest = path.join(root, rel);
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
      
          const serverList = await getFolderFileList(id);
          const serverMap = new Map(serverList.map(f => [f.relativePath || f.originalName, f]));
          const localFiles = buildClientFiles(root);
          const localMap = new Map(localFiles.map(f => [f.relativePath, f]));
      
          // 1) 서버에 없는 로컬 항목 먼저 삭제
          for (const [rel, meta] of localMap) {
            if (!serverMap.has(rel)) {
              const full = path.join(root, rel);
              if (meta.isDirectory) {
                fs.rmSync(full, { recursive: true, force: true });
              } else {
                fs.unlinkSync(full);
              }
              ipcRenderer.send('sync-file-deleted', { folderId: id, relativePath: rel });
            }
          }
      
          // 2) 서버에만 있는 항목 다운로드 (폴더는 제외)
          for (const [rel, meta] of serverMap) {
            if (rel.endsWith('/')) continue; // 폴더는 다운로드 대상에서 제외
      
            if (!localMap.has(rel)) {
              console.warn(`📁 [SyncManager] 파일 다운로드 → ${rel}`);
              try {
                const blob = await downloadFolderFile(id, rel);
                const buf = await blob.arrayBuffer();
                const dest = path.join(root, rel);
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.writeFileSync(dest, Buffer.from(buf));
                ipcRenderer.send('sync-file-added', { folderId: id, relativePath: rel });
              } catch (e) {
                if (e.message.startsWith('HTTP 404')) {
                  console.warn(`📁 [SyncManager] 다운로드 실패 (서버에 없음): ${rel}`);
                  serverMap.delete(rel);

                  const fullPath = path.join(root, rel);
                  if (fs.existsSync(fullPath)) {
                    fs.unlinkSync(fullPath);
                    ipcRenderer.send('sync-file-deleted', { folderId: id, relativePath: rel });
                  }

                } else {
                  console.error(`📁 [SyncManager] 다운로드 실패: ${rel}`, e);
                }
              }
            }
          }
      
          cleanupEmptyDirs(root);
          initialSyncDoneRef.current[id] = true;
          prevClientMapRef.current[id] = localMap;
      
        } catch (e) {
          console.error('📁 [SyncManager] 동기화 중 에러 발생:', e);
        }
      };      

      doSync();
      intervalsRef.current[id] = setInterval(doSync, 5000);

      // File system watcher
      // const watcher = chokidar.watch(root, { ignoreInitial: true, depth: Infinity });
      const watcher = chokidar.watch(root, {
        ignored: /(^|[\/\\])\..+|~$|\.swp$/,
        ignoreInitial: true,
        persistent: true,
        depth: Infinity,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
      });

      watcher
      .on('add', p => handleLocalAdd(p, id, root))
      .on('change', p => handleLocalChange(p, id, root))
      .on('unlink', p => handleLocalDelete(p, id, root))
      .on('addDir', p => handleLocalSubAdd(p, id, root))
      .on('unlinkDir', p => handleLocalSubDelete(p, id, root));

      watchersRef.current[id] = watcher;
    });

    return () => {
      Object.values(watchersRef.current).forEach(w => w.close());
      Object.values(intervalsRef.current).forEach(i => clearInterval(i));
    };
  }, [folders]);


  return null; // UI 없음
}
