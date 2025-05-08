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


  // 폴더 및 서브 폴더 관련 핸들러

  // ── Helper: 빈 디렉터리까지 깔끔히 삭제 ──
  function cleanupEmptyDirs(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        cleanupEmptyDirs(full);
        if (fs.readdirSync(full).length === 0) {
          fs.rmdirSync(full);
          console.warn(`📁 [SyncManager] 폴더 삭제: ${full}`);
        }
      }
    }
  }

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


  // 메인 폴더 내 서브폴더 삭제 처리
  useEffect(() => {
    // console.log('SyncManager - folders 업데이트:', JSON.stringify(folders, null, 2));
    const onDeleteDir = (_e, payload) => {
      try {
        // 넘겨받은 payload 매개변수에 대응하는 값 넘겨받음
        const { folderId, relativePath } = payload;
        // 디버깅 처리
        console.warn('onDeleteDir - payload:', payload);
        console.warn('onDeleteDir - folders:', JSON.stringify(folders, null, 2));

        if (!folderId || !relativePath) {
          console.warn('onDeleteDir - 유효하지 않은 payload:', payload);
          return;
        }
        // IPC 통신을 통해 넘어온 삭제요청 파일의 존재 여부를 검사 -> 파일의 절대경로를 통해 상대경로를 구함
        const folder = folders.find(f => f.id === folderId);
        if (!folder) {
          console.warn(`onDeleteDir - folderId ${folderId}에 해당하는 폴더를 찾지 못함.`);
          return;
        }
        const root = folder.folderPath;
        const fullPath = path.join(root, relativePath);
        // 서버에서 삭제 요청을 한 것이므로 로컬에서 삭제해야한다.
        if (fs.existsSync(fullPath)) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.warn(`📁 [SyncManager] 서브 폴더 삭제 완료 → ${fullPath}`);
  
          // UI 갱신
          ipcRenderer.send('sync-file-deleted', { folderId, relativePath });
        }
  
      } catch (error) {
        console.error('onDeleteDir - 에러:', error);
      }
    };
    ipcRenderer.on('delete-subfolder', onDeleteDir);
    return () => {
      ipcRenderer.removeListener('delete-subfolder', onDeleteDir);
    };
  }, [folders]);
  // useEffect(() => {
  //   const onDeleteDir = (_e, { folderId, relativePath}) => {
  //     // IPC 통신을 통해 넘어온 삭제요청 파일의 존재 여부를 검사 -> 파일의 절대경로를 통해 상대경로를 구함
  //     const folder = folders.find(f => f.id === folderId);
  //     if (!folder) return;
  //     const root = folder.folderPath;
  //     const fullPath = path.join(root, relativePath);

  //     // 서버에서 삭제 요청을 한 것이므로 로컬에서 삭제해야한다.
  //     if (fs.existsSync(fullPath)) {
  //       fs.rmSync(fullPath, { recursive: true, force: true});
  //       console.warn(`📁 [SyncManager] 서브 폴더 삭제 완료 → ${fullPath}`);
  //       // UI 갱신
  //       ipcRenderer.send('sync-file-deleted', { folderId, relativePath });
  //     }
  //   };

  //   ipcRenderer.on('delete-subfolder', onDeleteDir);
  //   return () => {
  //     ipcRenderer.removeListener('delete-subfolder', onDeleteDir);
  //   };
  // }, [folders])


  // ── 최초 싱크폴더 목록 ──
  useEffect(() => {
    (async () => {
      try {
        const data = await getSyncFolder();
        setFolders(data || []);
      } catch (e) {
        console.error(e);
        if (e.message.startsWith('HTTP 403')) {
          localStorage.removeItem('token');
          alert('세션 만료, 재로그인 필요');
          navigate('/');
        }
      }
    })();
  }, []);

  // ── 전체 폴더 메타 스캔 ──
  function buildClientFiles(root) {
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
            originalName: relativePath,     // 백엔드 기준 이름
            relativePath: relativePath,     // 실제 업로드 경로
            size: stat.size,
            hash: hash,
            mimeType: mimeType,
            lastModified: new Date(stat.mtimeMs).toISOString(),
          });
        } else if (entry.isDirectory()) {
          walk(fullPath); // 재귀 탐색
        }
      }
    };
  
    walk(root);
    return results;
  }


  // 로컬 파일 동기화 관련 핸들러

  // ── 로컬 파일 추가 핸들러 ──
  async function handleLocalAdd(fullPath, id, root) {
    try {

      // 1) 상대경로 계산 및 보정
      let rel = path.relative(root, fullPath).replace(/\\/g,'/');
      if (!rel) rel = path.basename(fullPath);
      // 2) 메타 생성 (백엔드가 기대하는 최소 필드만)
      const stat = fs.statSync(fullPath);
      const buf  = fs.readFileSync(fullPath);
      const meta = [{
        originalName: path.basename(fullPath),
        relativePath: rel,
        size: stat.size,
        hash: crypto.createHash('sha256').update(buf).digest('hex'),
        mimeType: mime.lookup(fullPath) || 'application/octet-stream',
        lastModified: new Date(stat.mtimeMs).toISOString()
      }];
      const { filesToUpload = [] } = await syncFolder(id, meta, []);
      if (filesToUpload.includes(rel)) {
        console.warn(`📁 [SyncManager] IPC 보내기 → sync-file-added (folderId=${id}, relativePath=${rel})`);
        await uploadFile(id, fullPath, rel);
        // notify UI
        ipcRenderer.send('sync-file-added', { folderId: id, relativePath: rel });
      }
      // 맵 업데이트
      prevClientMapRef.current[id]?.set(rel, meta[0]);
    } catch (e) {
      console.error(`handleLocalAdd[${id}]`, e);
    }
  }

  // ── 로컬 파일 변경 핸들러 ──
  async function handleLocalChange(fullPath, id, root) {
    // 1) rel 과 미리보기 로깅
    const rel = path
      .relative(root, fullPath)
      .replace(/\\/g, '/')
      .trim() || path.basename(fullPath);
    console.warn(`📁 [SyncManager] handleLocalChange 시작 → folderId=${id}, rel=${rel}`);

    // 2) 전체 스냅샷 메타 생성 (originalName==relativePath 로 통일)
    const clientFiles = buildClientFiles(root).map(f => ({
      originalName:  f.relativePath,
      relativePath:  f.relativePath,
      size:          f.size,
      hash:          f.hash,
      mimeType:      f.mimeType,
      lastModified:  f.lastModified
    }));

    // 3) 서버에 스냅샷 전달 → 변경 대상 요청
    let { filesToUpload = [], filesToDownload = [] } =
      await syncFolder(id, clientFiles, []);
    console.log(`📁 [SyncManager] syncFolder 응답 →`, { filesToUpload, filesToDownload });

    // 4) 내 쪽 업데이트가 최신이면 업로드
    if (filesToUpload.includes(rel)) {
      console.warn(`📁 [SyncManager] 업로드 대상 → ${rel}`);
      await uploadFile(id, fullPath, rel);
    }

    // 5) 서버 쪽이 최신이면 다운로드
    if (filesToDownload.includes(rel)) {
      console.warn(`📁 [SyncManager] 다운로드 대상 → ${rel}`);
      const blob = await downloadFolderFile(id, rel);
      const arr  = await blob.arrayBuffer();
      fs.writeFileSync(fullPath, Buffer.from(arr));
    }

    // 6) UI 갱신
    ipcRenderer.send('sync-file-updated', { folderId: id, relativePath: rel });
  }

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
        // Skip if folder removed on server
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

        // If local root missing, re-download everything
        if (!fs.existsSync(root)) {
          console.warn(`📁 [SyncManager] 로컬 폴더가 사라졌습니다. 재생성 후 전체 다운로드 → ${root}`);
          fs.mkdirSync(root, { recursive: true });
          const serverList = await getFolderFileList(id);
          for (const f of serverList) {
            const rel = f.relativePath || f.originalName;
            const blob = await downloadFolderFile(id, rel);
            const buf = await blob.arrayBuffer();
            const dest = path.join(root, rel);
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, Buffer.from(buf));
            ipcRenderer.send('sync-file-added', { folderId: id, relativePath: rel });
          }
          initialSyncDoneRef.current[id] = true;
          prevClientMapRef.current[id] = new Map(serverList.map(f => [f.relativePath || f.originalName, f]));
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

        // Download missing files
        for (const [rel] of serverMap) {
          if (rel.endsWith('/')) continue;

          if (!localMap.has(rel)) {
            console.warn(`📁 [SyncManager] 파일 다운로드 → ${rel}`);
            try{
              const blob = await downloadFolderFile(id, rel);
              const buf = await blob.arrayBuffer();
              const dest = path.join(root, rel);
              fs.mkdirSync(path.dirname(dest), { recursive: true });
              fs.writeFileSync(dest, Buffer.from(buf));
              ipcRenderer.send('sync-file-added', { folderId: id, relativePath: rel });
            }catch(e){
              console.error(`다운로드 실패: ${rel}`, e);
            }
          }
        }        

        cleanupEmptyDirs(root);
        initialSyncDoneRef.current[id] = true;
        prevClientMapRef.current[id] = localMap;
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
      .on('addDir', p => {
        doSync();
        const relDir = path.relative(root, p).replace(/\\/g,'/');
        ipcRenderer.send('sync-folder-added', { folderId: id, relativePath: relDir });
      })
      .on('unlinkDir', p => {
        doSync();
        const relDir = path.relative(root, p).replace(/\\/g,'/');
        ipcRenderer.send('sync-folder-deleted', { folderId: id, relativePath: relDir });
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
