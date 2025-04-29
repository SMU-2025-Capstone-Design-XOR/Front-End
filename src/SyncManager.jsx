import React, { useEffect, useRef, useState } from 'react';
import crypto from 'crypto';
import mime   from 'mime-types';
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
  const watchersRef = useRef({});

  // 1) 앱 시작 시 서버에 등록된 싱크 폴더 목록 불러오기
  useEffect(() => {
    (async () => {
      try {
        const data = await getSyncFolder();
        setFolders(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error('Failed to load sync‐folders:', e);
      }
    })();
  }, []);

  // 2) folders 배열이 바뀔 때마다(→새 폴더 추가·삭제) watcher 재설정
  useEffect(() => {
    // (a) 기존 watcher 정리
    Object.values(watchersRef.current).forEach(w => w.close());
    watchersRef.current = {};
    // (b) 각 폴더별로 초기 동기화 및 증분 동기화 등록
    folders.forEach(folder => {
      const { id, folderPath: root } = folder;

      // ── 2-1) 초기 동기화 ──
      (async () => {
        try {
            // 1) 로컬 폴더 스캔 → 메타 정보 수집 (이름, 해시, 크기, 마지막 수정 시간 등)
            const clientFiles = fs.readdirSync(root)
                .filter(n => fs.statSync(path.join(root,n)).isFile())
                .map(name => {
                const full = path.join(root,name);
                const stat = fs.statSync(full);
                const hash = crypto
                    .createHash('sha256')
                    .update(fs.readFileSync(full))
                    .digest('hex');
                return {
                    originalName: name,
                    relativePath: name,
                    size: stat.size,
                    hash,
                    mimeType: mime.lookup(full) || 'application/octet-stream',
                    lastModified: new Date(stat.mtimeMs).toISOString()
                };
                });
                
             // 2) sync API 호출 → 업로드/다운로드 대상 목록 획득
            const { filesToUpload = [], filesToDownload = [] } =
                await syncFolder(id, clientFiles, []);
            // 3) 필요한 파일 업로드
            for (const name of filesToUpload) {
                await uploadFile(id, path.join(root, name));
            }
            // 4) 필요한 파일 다운로드
            for (const name of filesToDownload) {
                const blob = await downloadFolderFile(id, name);
                const buf  = await blob.arrayBuffer();
                fs.writeFileSync(path.join(root, name), Buffer.from(buf));
            }
            } catch (e) {
            console.error(`Initial sync error for folder ${id}:`, e);
            }
        })();

      // ── 2-2) 증분 동기화(watch) ──
      watchersRef.current[id] = fs.watch(root, async (_evt, filename) => {
        if (!filename) return;
        const full = path.join(root, filename);

        // ● 삭제 감지
        if (!fs.existsSync(full)) {
            // 서버에 해당 파일 ID 알려주기
            const list = await getFolderFileList(id);
            const meta = Array.isArray(list)
                ? list.find(f => (f.originalName||f.relativePath) === filename)
                : null;
            const deletedId = meta?.id;
            await syncFolder(id, [], deletedId ? [deletedId] : []);
            return;
        }

        // ● 추가/수정 감지
        try {
          const stat = fs.statSync(full);
          const hash = crypto
            .createHash('sha256')
            .update(fs.readFileSync(full))
            .digest('hex');
          const payload = [{
            originalName: filename,
            relativePath: filename,
            size: stat.size,
            hash,
            mimeType: mime.lookup(full) || 'application/octet-stream',
            lastModified: new Date(stat.mtimeMs).toISOString()
          }];
          const { filesToUpload = [], filesToDownload = [] } =
            await syncFolder(id, payload, []);
          for (const n of filesToUpload) {
            await uploadFile(id, path.join(root, n));
          }
          for (const n of filesToDownload) {
            const blob = await downloadFolderFile(id, n);
            const buf  = await blob.arrayBuffer();
            fs.writeFileSync(path.join(root, n), Buffer.from(buf));
          }
        } catch (e) {
          console.error(`Incremental sync error for folder ${id}:`, e);
        }
      });
    });

    return () => Object.values(watchersRef.current).forEach(w => w.close());
  }, [folders]);

  return null; // no UI
}
