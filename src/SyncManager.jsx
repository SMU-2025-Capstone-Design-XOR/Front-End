// src/SyncManager.jsx
import React, { useEffect, useRef, useState } from 'react';
import crypto from 'crypto';
import mime from 'mime-types';
import chokidar from 'chokidar';
import { ipcRenderer } from 'electron';
const fs = window.require('fs');
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
  const watchersRef = useRef({});

  // 1) 앱 시작 시 서버에 등록된 싱크 폴더 목록 불러오기
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      console.warn('토큰 없음: 동기화 스킵');
      return;
    }    
    (async () => {
      try {
        const data = await getSyncFolder();
        setFolders(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error('Failed to load sync‐folders:', e);
      }
    })();
  }, []);

//   // 1) 앱 시작 시 & IPC 갱신 요청 올 때마다 서버에 등록된 폴더 목록 불러오기
//   useEffect(() => {
//     const load = async () => {
//       const token = localStorage.getItem('token');
//       if (!token) {
//         console.warn('토큰 없음: 동기화 스킵');
//         return;
//       }
//       try {
//         const data = await getSyncFolder();
//         setFolders(Array.isArray(data) ? data : []);
//       } catch (e) {
//         console.error('Failed to load sync‐folders:', e);
//       }
//     };
//     // 첫 로드
//     load();
//     // Home으로부터 “sync-folders-updated” 이벤트 수신
//     ipcRenderer.on('sync-folders-updated', load);
//     // 정리
//     return () => {
//       ipcRenderer.removeListener('sync-folders-updated', load);
//     };
//   }, []);

  // 2) folders 배열이 바뀔 때마다 watcher 재설정
  useEffect(() => {
    // 기존 watcher 종료
    Object.values(watchersRef.current).forEach(w => w.close());
    watchersRef.current = {};

    folders.forEach(folder => {
      const { id, folderPath: root } = folder;

      // 2-1) 초기 동기화
      (async () => {
        try {
          const clientFiles = fs.readdirSync(root)
            .filter(n => fs.statSync(path.join(root, n)).isFile())
            .map(name => {
              const full = path.join(root, name);
              const stat = fs.statSync(full);
              const buf = fs.readFileSync(full);
              const hash = crypto.createHash('sha256').update(buf).digest('hex');
              return {
                originalName: name,
                relativePath: name,
                size: stat.size,
                hash,
                mimeType: mime.lookup(full) || 'application/octet-stream',
                lastModified: new Date(stat.mtimeMs).toISOString()
              };
            });

          const { filesToUpload = [], filesToDownload = [] } =
            await syncFolder(id, clientFiles, []);

          for (const name of filesToUpload) {
            await uploadFile(id, path.join(root, name));
          }
          for (const name of filesToDownload) {
            const blob = await downloadFolderFile(id, name);
            const buf = await blob.arrayBuffer();
            fs.writeFileSync(path.join(root, name), Buffer.from(buf));
          }
        } catch (e) {
          console.error(`Initial sync error for folder ${id}:`, e);
        }
      })();

      // 2-2) 증분 동기화: Chokidar watcher
      const watcher = chokidar.watch(root, {
        // 임시파일·숨김파일 무시
        ignored: /(^|[\/\\])\..+|~$|^~|\.swp$/,
        ignoreInitial: true,
        persistent: true,
        // 쓰기 중간 이벤트 무시하고 최종 변경만 잡아냄
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 100
        }
      });

      watcher
        .on('add',   filePath => handleChange('add',   filePath, id, root))
        .on('change',filePath => handleChange('change',filePath, id, root))
        .on('unlink',filePath => handleDelete(filePath, id, root));

      watchersRef.current[id] = watcher;
    });

    // cleanup
    return () => {
      Object.values(watchersRef.current).forEach(w => w.close());
    };
  }, [folders]);


  // 파일 추가/수정 처리
  async function handleChange(event, fullPath, id, root) {
    try {
      const filename = path.relative(root, fullPath);
      const stat = fs.statSync(fullPath);
      const buf = fs.readFileSync(fullPath);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');

      const payload = [{
        originalName: filename,
        relativePath: filename,
        size: stat.size,
        hash,
        mimeType: mime.lookup(fullPath) || 'application/octet-stream',
        lastModified: new Date(stat.mtimeMs).toISOString()
      }];

      const { filesToUpload = [], filesToDownload = [] } =
        await syncFolder(id, payload, []);

      for (const n of filesToUpload) {
        await uploadFile(id, path.join(root, n));
      }
      for (const n of filesToDownload) {
        const blob = await downloadFolderFile(id, n);
        const buf2 = await blob.arrayBuffer();
        fs.writeFileSync(path.join(root, n), Buffer.from(buf2));
      }
    } catch (e) {
      console.error(`Incremental sync error for folder ${id}:`, e);
    }
  }

  // 파일 삭제 처리
  async function handleDelete(fullPath, id, root) {
    try {
      const filename = path.relative(root, fullPath);
      const list = await getFolderFileList(id);
      const meta = Array.isArray(list)
        ? list.find(f => (f.originalName || f.relativePath) === filename)
        : null;
      const deletedId = meta?.id;
      if (deletedId != null) {
        await syncFolder(id, [], [deletedId]);
      }
    } catch (e) {
      console.error(`Deletion sync error for folder ${id}:`, e);
    }
  }

  return null; // UI 없음
}
