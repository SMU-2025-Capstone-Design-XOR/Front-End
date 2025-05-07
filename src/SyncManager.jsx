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
  const navigate              = useNavigate();

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

  // Home에서 폴더 추가/삭제 동시 처리
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

  // ── (1) 최초 싱크폴더 목록 ──
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

  // ── (2) 로컬 추가 핸들러 ──
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

  // ── (4) 로컬 삭제 핸들러 ──
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

  // ── (5) 전체 폴더 메타 스캔 ──
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
  
  // ── (6) folders 바뀔 때마다 watcher & polling 세팅 ──
  useEffect(() => {
    // 정리
    Object.values(watchersRef.current).forEach(w => w.close());
    Object.values(intervalsRef.current).forEach(i => clearInterval(i));
    watchersRef.current   = {};
    intervalsRef.current  = {};
    prevClientMapRef.current = {};

    folders.forEach(folder => {
      const { id, folderPath: root } = folder;
      prevClientMapRef.current[id] = new Map();

      // (A) 폴링: 오직 서버 변경만 반영
      const doSync = async () => {
        let all;
        try {
          all = await getSyncFolder();
        } catch (e) {
          // getSyncFolder 만 404 처리 → 폴더 삭제
          if (e.message.startsWith('HTTP 404')) {
            console.warn(`✂️ [SyncManager] 서버에서 폴더(${id}) 삭제됨 → 로컬에서도 제거`);
            watchersRef.current[id]?.close();
            clearInterval(intervalsRef.current[id]);
            delete watchersRef.current[id];
            delete intervalsRef.current[id];
            delete prevClientMapRef.current[id];
            fs.rmdirSync(root, { recursive: true });
            setFolders(prev => prev.filter(f => f.id !== id));
            return;
          } else {
            throw e;
          }
        }


        // 0.5) 로컬 root 경로가 통째로 사라졌다면 → 다시 만들고 전체 다운로드
        if (!fs.existsSync(root)) {
          console.warn(`📁 [SyncManager] 로컬 폴더가 사라졌습니다. 재생성 후 전체 다운로드 → ${root}`);
          fs.mkdirSync(root, { recursive: true });
          // const serverList = await getFolderFileList(id);
          // const serverMap  = new Map(serverList.map(f => [f.relativePath, f]));
          const serverList = await getFolderFileList(id);
          // if relativePath is empty, fall back to originalName
          const serverMap  = new Map(
            serverList.map(f => {
              const relKey = (f.relativePath && f.relativePath.trim())
                            ? f.relativePath
                            : f.originalName;
              return [ relKey, f ];      
            })
          );
          for (const [rel, meta] of serverMap) {
            const blob = await downloadFolderFile(id, rel);
            const buf  = await blob.arrayBuffer();
            const full = path.join(root, rel);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, Buffer.from(buf));
            ipcRenderer.send('sync-file-added', { folderId: id, relativePath: rel });
          }
          // 맵 갱신 후 바로 리턴
          prevClientMapRef.current[id] = new Map(serverMap);
          return;
        }
        
        // (1) 실제 동기화 로직
        try {
          const serverList = await getFolderFileList(id);
          const serverMap  = new Map(
            serverList.map(f => {
              const relKey = (f.relativePath && f.relativePath.trim())
                            ? f.relativePath
                            : f.originalName;
              return [ relKey, f ];
            })
          );          
          const localFiles = buildClientFiles(root);
          const localMap   = new Map(localFiles.map(f => [f.relativePath, f]));
          // (1) 서버 → 로컬 다운로드
          for (const [rel, meta] of serverMap) {
            // 빈 상대경로 건너뛰기
            if (!rel || typeof rel !== 'string') {
              console.warn(`[SyncManager] 경로 누락 건너뜀 →`, rel);
              continue;
            }
            if (!localMap.has(rel)) {
              try {
                console.warn(`📁 [SyncManager] 파일 다운로드 → ${rel}`);
                const blob = await downloadFolderFile(id, rel);
                const buf  = await blob.arrayBuffer();
                const full = path.join(root, rel);
                fs.mkdirSync(path.dirname(full), { recursive: true });
                fs.writeFileSync(full, Buffer.from(buf));
                ipcRenderer.send('sync-file-added', { folderId: id, relativePath: rel });
              } catch (err) {
                console.error(`[SyncManager] "${rel}" 다운로드 실패, 건너뜁니다.`, err);
                continue;
              }
            }
          }
          // (2) 로컬에만 있는 → 삭제
          for (const [rel] of localMap) {
            if (!serverMap.has(rel)) {
              const full = path.join(root, rel);
              if (fs.existsSync(full)) {
                console.warn(`📁 [SyncManager] 파일 삭제 (polling) → ${full}`);
                fs.unlinkSync(full);
              }
            }
          }

          // 3) 빈 디렉터리 까지 정리
          cleanupEmptyDirs(root);

          // (3) 갱신된 로컬 맵 저장
          prevClientMapRef.current[id] = localMap;
        } catch (e) {
          // getFolderFileList, buildClientFiles 등 기타 에러
          console.error(`✖️ [SyncManager] 폴더(${id}) doSync 에러`, e);         
        }
      };

      // (B) 초기 동기화 + (C) 폴링
      doSync();
      intervalsRef.current[id] = setInterval(doSync, 5_000);

      // (D) 로컬 감지
      const watcher = chokidar.watch(root, {
        ignored: /(^|[\/\\])\..+|~$|\.swp$/,
        ignoreInitial: true,
        persistent: true,
        depth: Infinity,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
      });
      watcher
        .on('add',    p => handleLocalAdd(p, id, root))
        .on('change', p => handleLocalChange(p, id, root))
        .on('unlink', p => handleLocalDelete(p, id, root))
        .on('addDir', p => doSync())
        .on('unlinkDir', p => doSync());
      watchersRef.current[id] = watcher;
    });

    return () => {
      Object.values(watchersRef.current).forEach(w => w.close());
      Object.values(intervalsRef.current).forEach(i => clearInterval(i));
    };
  }, [folders]);

  return null; // UI 없음
}

