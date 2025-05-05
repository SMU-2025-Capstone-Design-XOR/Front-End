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
      const rel  = path.relative(root, fullPath).replace(/\\/g,'/');
      const stat = fs.statSync(fullPath);
      const buf  = fs.readFileSync(fullPath);
      const meta = [{
        originalName: rel,
        relativePath: rel,
        size: stat.size,
        hash: crypto.createHash('sha256').update(buf).digest('hex'),
        mimeType: mime.lookup(fullPath) || 'application/octet-stream',
        lastModified: new Date(stat.mtimeMs).toISOString()
      }];
      // sync → filesToUpload 에 들어오면 업로드
      const { filesToUpload = [] } = await syncFolder(id, meta, []);
      if (filesToUpload.includes(rel)) {
        await uploadFile(id, fullPath);
        // notify UI
        ipcRenderer.send('sync-file-added', { folderId: id, relativePath: rel });
      }
      // 맵 업데이트
      prevClientMapRef.current[id]?.set(rel, meta[0]);
    } catch (e) {
      console.error(`handleLocalAdd[${id}]`, e);
    }
  }

// ── (3) 로컬 수정 핸들러 ──
  async function handleLocalChange(fullPath, id, root) {
    const rel = path.relative(root, fullPath).replace(/\\/g,'/');
    // 1) 변경된 파일 하나의 메타만 syncFolder로 보냄
    const stat = fs.statSync(fullPath);
    const buf  = fs.readFileSync(fullPath);
    const meta = [{
      originalName:  rel,
      relativePath:  rel,
      size:          stat.size,
      hash:          crypto.createHash('sha256').update(buf).digest('hex'),
      mimeType:      mime.lookup(fullPath) || 'application/octet-stream',
      lastModified:  new Date(stat.mtimeMs).toISOString()
    }];

    // 2) 서버에 “이 파일 업데이트 해도 되나요?” 요청
    const { filesToUpload = [], filesToDownload = [] } = await syncFolder(id, meta, []);

    // 3) 내 쪽이 더 최신이면 upload
    if (filesToUpload.includes(rel)) {
      await uploadFile(id, fullPath);
    }

    // 4) 서버 쪽이 더 최신이면 download
    if (filesToDownload.includes(rel)) {
      const blob = await downloadFolderFile(id, rel);
      const arr  = await blob.arrayBuffer();
      fs.writeFileSync(fullPath, Buffer.from(arr));
    }

    // 5) UI 갱신
    ipcRenderer.send('sync-file-updated', { folderId: id, relativePath: rel });
  }



  // ── (4) 로컬 삭제 핸들러 ──
  async function handleLocalDelete(fullPath, id, root) {
    try {
      const rel        = path.relative(root, fullPath).replace(/\\/g,'/');
      const serverList = await getFolderFileList(id);
      const meta       = serverList.find(f => f.relativePath === rel);
      const fileId     = meta?.id ?? meta?.fileId;
      if (!fileId) return console.warn(`삭제된 파일 : ${rel}`);
      // syncFolder 에 deletedFileIds 로 전달 → 서버에서도 삭제
      await syncFolder(id, [], [fileId]);
      prevClientMapRef.current[id]?.delete(rel);
      // notify UI
      ipcRenderer.send('sync-file-deleted', { folderId: id, relativePath: rel });
    } catch (e) {
      console.error(`handleLocalDelete[${id}]`, e);
    }
  }

  // ── (5) 전체 폴더 메타 스캔 ──
  function buildClientFiles(root) {
    const results = [];
    (function walk(dir) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isFile()) {
          const buf = fs.readFileSync(full);
          const rel = path.relative(root, full).replace(/\\/g,'/');
          results.push({
            originalName: rel,
            relativePath: rel,
            size: stat.size,
            hash: crypto.createHash('sha256').update(buf).digest('hex'),
            mimeType: mime.lookup(full) || 'application/octet-stream',
            lastModified: new Date(stat.mtimeMs).toISOString()
          });
        } else if (stat.isDirectory()) {
          walk(full);
        }
      }
    })(root);
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
        // 0) 서버에 남아 있는 sync-folder 목록을 재조회
        const all = await getSyncFolder();
        if (!all.some(f => f.id === id)) {
          // → 서버에서 완전히 지워진 경우
          console.warn(`폴더 ${id} 가 서버에서 삭제되어 로컬에서도 제거`);
          // 1) watcher/interval 정리
          watchersRef.current[id]?.close();
          clearInterval(intervalsRef.current[id]);
          delete watchersRef.current[id];
          delete intervalsRef.current[id];
          delete prevClientMapRef.current[id];
          // 2) 로컬 디렉터리 통째로 삭제
          fs.rmdirSync(root, { recursive: true });
          // 3) 상태에서도 제거
          setFolders(prev => prev.filter(f => f.id !== id));
          return;
        }

        // 0.5) 로컬 root 경로가 통째로 사라졌다면 → 다시 만들고 전체 다운로드
        if (!fs.existsSync(root)) {
          console.warn(`📁 [SyncManager] 로컬 폴더가 사라졌습니다. 재생성 후 전체 다운로드 → ${root}`);
          fs.mkdirSync(root, { recursive: true });
          const serverList = await getFolderFileList(id);
          const serverMap  = new Map(serverList.map(f => [f.relativePath, f]));
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

        try {
          const serverList = await getFolderFileList(id);
          const serverMap  = new Map(serverList.map(f => [f.relativePath, f]));
          const localFiles = buildClientFiles(root);
          const localMap   = new Map(localFiles.map(f => [f.relativePath, f]));
          // (1) 서버 → 로컬 다운로드
          for (const [rel, meta] of serverMap) {
            if (!localMap.has(rel)) {
              const blob = await downloadFolderFile(id, rel);
              const buf  = await blob.arrayBuffer();
              const full = path.join(root, rel);
              fs.mkdirSync(path.dirname(full), { recursive: true });
              fs.writeFileSync(full, Buffer.from(buf));

              ipcRenderer.send('sync-file-added', { folderId: id, relativePath: rel });
            }
          }
          // (2) 로컬에만 있는 → 삭제
          for (const [rel] of localMap) {
            if (!serverMap.has(rel)) {
              const full = path.join(root, rel);
              if (fs.existsSync(full)) fs.unlinkSync(full);
            }
          }

          // 3) 빈 디렉터리 까지 정리
          cleanupEmptyDirs(root);

          // (3) 갱신된 로컬 맵 저장
          prevClientMapRef.current[id] = localMap;
        } catch (e) {
          
          if (e.message.startsWith('HTTP 404')) {
            console.warn(`폴더 ${id} 가 서버에서 삭제되어 동기화 중단`);
            watchersRef.current[id]?.close();
            clearInterval(intervalsRef.current[id]);
            delete watchersRef.current[id];
            delete intervalsRef.current[id];
            delete prevClientMapRef.current[id];
            // 실제 로컬 디렉터리 삭제
            fs.rmdirSync(root, { recursive: true });
            setFolders(prev => prev.filter(f => f.id !== id));
            return;
          }
          console.error(`doSync[${id}]`, e);          
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
