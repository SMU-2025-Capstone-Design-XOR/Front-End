// src/SyncManager.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import crypto from 'crypto';
import mime from 'mime-types';
import chokidar from 'chokidar';
import { ipcRenderer } from 'electron';
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
  const [folders, setFolders]   = useState([]);
  const watchersRef            = useRef({});
  const intervalsRef           = useRef({});
  const prevClientFilesRef     = useRef({}); // { [folderId]: Map<relativePath, FileMeta> }
  const navigate               = useNavigate();

  // root 아래 모든 파일 메타 생성 (recursive)
  function buildClientFiles(root) {
    const results = [];
    function walk(dir) {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isFile()) {
          const buf = fs.readFileSync(full);
          const rel = path.relative(root, full).replace(/\\/g, '/');
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
    }
    walk(root);
    return results;
  }

  // 1) 최초 싱크폴더 목록 가져오기
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    (async () => {
      try {
        const data = await getSyncFolder();
        setFolders(Array.isArray(data) ? data : []);
      } catch (e) {
        if (e.message.startsWith('HTTP 403')) {
          localStorage.removeItem('token');
          alert('세션이 만료되었습니다. 다시 로그인 해주세요.');
          navigate('/');
        } else {
          console.error('Failed to load sync‐folders:', e);
        }
      }
    })();
  }, []);

  // 2) folders 바뀔 때마다 watcher & polling 재설정
  useEffect(() => {
    // cleanup 이전 watcher & interval
    Object.values(watchersRef.current).forEach(w => w.close());
    Object.values(intervalsRef.current).forEach(i => clearInterval(i));
    watchersRef.current        = {};
    intervalsRef.current       = {};
    prevClientFilesRef.current = {};

    folders.forEach(folder => {
      const { id, folderPath: root } = folder;
      const POLL_MS = 30_000; // 30초마다 원격 폴링

      // doSync: 스캔 → 서버 sync → 업로드/다운로드/삭제 적용
      const doSync = async () => {
        try {
          
          // 1) 현재 메타 스캔 & 중복 제거
          const allFiles = buildClientFiles(root);
          const seen     = new Set();
          const clientFiles = allFiles.filter(f => {
            // relativePath 가 이미 한 번 나왔으면 걸러내고,
            if (seen.has(f.relativePath)) return false;
            // 아니면 이번에 추가하고 살려둡니다.
            seen.add(f.relativePath);
            return true;
          });

          const currentMap = new Map(clientFiles.map(f => [f.relativePath, f]));

          // 2) 지난 스캔과 비교해 로컬에서 삭제된 파일(relativePath) 찾아 ID 수집
          const prevMap = prevClientFilesRef.current[id] || new Map();
          const deletedFileIds = [];
          if (prevMap.size > 0) {
            // 서버 메타 한 번 가져와서 id 찾아두기
            const serverList = await getFolderFileList(id);
            for (const prevRel of prevMap.keys()) {
              if (!currentMap.has(prevRel)) {
                const meta = serverList.find(f => f.relativePath === prevRel);
                if (meta?.id != null) deletedFileIds.push(meta.id);
              }
            }
          }

          // 3) 서버에 sync 요청 (삭제 ID 포함)
          const { filesToUpload = [], filesToDownload = [], serverFiles = [] } =
            await syncFolder(id, clientFiles, deletedFileIds);

          // 4) 로컬 → 서버 업로드
          for (const rel of filesToUpload) {
            await uploadFile(id, path.join(root, rel));
          }
          // 5) 서버 → 로컬 다운로드
          for (const rel of filesToDownload) {
            const blob = await downloadFolderFile(id, rel);
            const buf  = await blob.arrayBuffer();
            const full = path.join(root, rel);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, Buffer.from(buf));
          }
          // 6) 서버에서 삭제된 파일 로컬에서도 삭제
          const serverSet = new Set(serverFiles.map(f => f.relativePath));
          clientFiles.forEach(f => {
            if (!serverSet.has(f.relativePath)) {
              const full = path.join(root, f.relativePath);
              if (fs.existsSync(full)) fs.unlinkSync(full);
            }
          });

          // 7) 다음 비교를 위해 currentMap 저장
          prevClientFilesRef.current[id] = currentMap;

        } catch (e) {
          console.error(`Sync error for folder ${id}:`, e);
        }
      };

      // 초기 동기화
      doSync();

      // 2-2) 로컬 변경 감지: add/change/unlink → doSync
      const watcher = chokidar.watch(root, {
        ignored: /(^|[\/\\])\..+|~$|\.swp$/,
        persistent: true,
        ignoreInitial: true,
        depth: Infinity,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
      });
      watcher.on('add',    () => doSync())
             .on('change', () => doSync())
             .on('unlink', () => doSync());
      watchersRef.current[id] = watcher;

      // 2-3) 원격 폴링
      const iv = setInterval(doSync, POLL_MS);
      intervalsRef.current[id] = iv;
    });

    return () => {
      Object.values(watchersRef.current).forEach(w => w.close());
      Object.values(intervalsRef.current).forEach(i => clearInterval(i));
    };
  }, [folders]);

  return null; // UI 없음
}

