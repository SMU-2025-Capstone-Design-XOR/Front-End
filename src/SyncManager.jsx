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

  // ── (1) 재귀적으로 root 아래 모든 파일 메타 생성 ──
  function buildClientFiles(root) {
    const results = [];
    function walk(dir) {
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
    }
    walk(root);
    return results;
  }

  // ── 1) 최초 싱크폴더 목록 가져오기 ──
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

  // ── 변경된 파일만 처리하는 핸들러 ──
  async function handleChange(fullPath, id, root) {
    try {
      // 1) 이 파일만 메타 생성
      const stat = fs.statSync(fullPath);
      const buf  = fs.readFileSync(fullPath);
      const rel  = path.relative(root, fullPath).replace(/\\/g,'/');
      const fileMeta = [{
        originalName: rel,
        relativePath: rel,
        size: stat.size,
        hash: crypto.createHash('sha256').update(buf).digest('hex'),
        mimeType: mime.lookup(fullPath) || 'application/octet-stream',
        lastModified: new Date(stat.mtimeMs).toISOString()
      }];

      // 2) sync 요청 (삭제 파일 없으므로 빈 배열)
      const { filesToUpload = [] } = await syncFolder(id, fileMeta, []);

      // 3) 실제 업로드
      if (filesToUpload.includes(rel)) {
        await uploadFile(id, fullPath);
      }
    } catch (e) {
      console.error(`handleChange error for folder ${id}:`, e);
    }
  }

  // ── 2) folders 바뀔 때마다 watcher & polling 재설정 ──
  useEffect(() => {
    // 이전 watcher/interval 정리
    Object.values(watchersRef.current).forEach(w => w.close());
    Object.values(intervalsRef.current).forEach(i => clearInterval(i));
    watchersRef.current        = {};
    intervalsRef.current       = {};
    prevClientFilesRef.current = {};

    folders.forEach(folder => {
      const { id, folderPath: root } = folder;
      const POLL_MS = 10_000;

      // 전체 폴더 스캔 + 동기화 로직 (폴링이나 add/unlink 시 사용)
      const doSync = async () => {
        try {
          // 1) 현재 전체 메타 스캔 & 중복 제거
          const allFiles = buildClientFiles(root);
          const seen     = new Set();
          const clientFiles = allFiles.filter(f => {
            if (seen.has(f.relativePath)) return false;
            seen.add(f.relativePath);
            return true;
          });
          const currentMap = new Map(clientFiles.map(f => [f.relativePath, f]));

          // 2) 삭제된 파일 ID 수집
          const prevMap = prevClientFilesRef.current[id] || new Map();
          const deletedFileIds = [];
          if (prevMap.size > 0) {
            const serverList = await getFolderFileList(id);
            for (const prevRel of prevMap.keys()) {
              if (!currentMap.has(prevRel)) {
                const meta = serverList.find(f => f.relativePath === prevRel);
                if (meta?.id != null) deletedFileIds.push(meta.id);
              }
            }
          }

          // 3) 서버 sync 요청
          const { filesToUpload = [], filesToDownload = [], serverFiles = [] } =
            await syncFolder(id, clientFiles, deletedFileIds);

          // 4) 변경된 파일 업로드
          for (const rel of filesToUpload) {
            await uploadFile(id, path.join(root, rel));
          }


          // 6 -> 5) 서버에서 삭제된 파일도 로컬에서 삭제
          const serverSet = new Set(serverFiles.map(f => f.relativePath));
          clientFiles.forEach(f => {
            if (!serverSet.has(f.relativePath)) {
              const full = path.join(root, f.relativePath);
              if (fs.existsSync(full)) fs.unlinkSync(full);
            }
          });

          // 6) 서버 → 로컬 다운로드 (serverFiles 에 여전히 남아 있는 것만)
          const toDownload = filesToDownload.filter(rel => serverSet.has(rel));
          for (const rel of toDownload) {
            const blob = await downloadFolderFile(id, rel);
            const buf  = await blob.arrayBuffer();
            const full = path.join(root, rel);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, Buffer.from(buf));
          }


          // 7) 다음 비교용으로 현재 맵 저장
          prevClientFilesRef.current[id] = currentMap;

        } catch (e) {
          console.error(`Sync error for folder ${id}:`, e);
        }
      };

      // (A) 초기 동기화
      doSync();

      // (B) 로컬 변경 감지: add/unlink → 전체 동기화, change → 변경 파일만 처리
      const watcher = chokidar.watch(root, {
        ignored: /(^|[\/\\])\..+|~$|\.swp$/,
        persistent: true,
        ignoreInitial: true,
        depth: Infinity,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 }
      });
      watcher
        .on('add',    () => doSync())
        .on('unlink', () => doSync())
        .on('change', filePath => handleChange(filePath, id, root));
      watchersRef.current[id] = watcher;

      // (C) 원격 폴링
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
