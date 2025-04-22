// src/pages/Home.jsx

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../css/home.css';
import '../css/all.css';
import {
  sendSyncFolder,
  backupFile,
  downloadFile,
  getSyncFolder,
  deleteSyncFolder
} from '../apiService';

// Electron 및 Node.js API 가져오기
const { ipcRenderer, remote } = window.require('electron');
const chokidar = window.require('chokidar');
const fs       = window.require('fs');
const path     = window.require('path');

const Home = () => {
  const navigate    = useNavigate();
  const currentUser = localStorage.getItem('currentUser') || 'default';
  const localKey    = `syncFolder_${currentUser}`;

  // 로컬에 선택된 폴더(단일)와 서버에 저장된 폴더 목록(복수)을 각각 관리
  const [folderPath, setFolderPath]     = useState(localStorage.getItem(localKey) || '');
  const [syncFolders, setSyncFolders]   = useState([]);      // 서버에 저장된 싱크 폴더 리스트
  const [fileStatuses, setFileStatuses] = useState([]);      // 로컬 파일 백업 상태 리스트

  /** 1️⃣ 서버의 싱크 폴더 목록을 불러와 상태에 세팅 */
  const fetchServerFolders = async () => {
    try {
      const data = await getSyncFolder();
      // 백엔드는 [{ id, folderPath }, …] 형태로 보내준다 가정
      setSyncFolders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('서버 싱크폴더 목록 가져오기 실패:', err);
      alert('싱크 폴더 목록 로드에 실패했습니다.');
    }
  };

  useEffect(() => {
    fetchServerFolders();
  }, []);

  /** 2️⃣ 로컬 폴더 선택 → 서버 전송 → 목록 갱신 */
  const handleSelectFolder = async () => {
    const selected = await ipcRenderer.invoke('open-folder-dialog');
    if (!selected) return;

    setFolderPath(selected);
    localStorage.setItem(localKey, selected);

    try {
      await sendSyncFolder(selected);
      await fetchServerFolders();
    } catch (err) {
      console.error('폴더 전송 에러:', err);
      alert('이미 존재하는 폴더입니다.');
    }
  };

  /** 3️⃣ 서버 폴더 삭제: 우클릭 컨텍스트 메뉴 */
  const handleContextMenu = (folderId) => (e) => {
    e.preventDefault();
    const menu = new remote.Menu();
    menu.append(new remote.MenuItem({
      label: '폴더 삭제',
      click: async () => {
        if (!window.confirm('이 싱크 폴더를 정말 삭제하시겠습니까?')) return;
        try {
          await deleteSyncFolder(folderId);
          fetchServerFolders();
        } catch (err) {
          console.error('삭제 실패:', err);
          alert('삭제 중 오류가 발생했습니다.');
        }
      }
    }));
    menu.popup({ window: remote.getCurrentWindow() });
  };

  /** 4️⃣ 로컬 폴더 내 파일 변화 감지 → 백업 API 호출 */
  useEffect(() => {
    if (!folderPath) return;
    const watcher = chokidar.watch(`${folderPath}/*`, {
      persistent: true,
      ignoreInitial: true,
    });

    watcher.on('change', async (filePath) => {
      updateFileStatus(filePath, '백업 중…');
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        await backupFile({ filePath, content });
        updateFileStatus(filePath, '백업 성공');
      } catch (err) {
        console.error('백업 에러:', err);
        updateFileStatus(filePath, '백업 실패');
      }
    });

    return () => watcher.close();
  }, [folderPath]);

  /** 파일 상태 리스트 갱신 헬퍼 */
  const updateFileStatus = (filePath, status) => {
    setFileStatuses(prev => {
      const idx = prev.findIndex(item => item.filePath === filePath);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { filePath, status };
        return copy;
      } else {
        return [...prev, { filePath, status }];
      }
    });
  };

  /** 로그아웃 */
  const handleLogout = () => {
    localStorage.clear();
    navigate('/');
  };

  /** 백업된 파일 다운로드 */
  const handleDownload = async (filePath) => {
    try {
      const blob = await downloadFile(filePath);
      const url  = window.URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = path.basename(filePath);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('다운로드 에러:', err);
      alert('다운로드에 실패했습니다.');
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">

        {/* 상단 버튼 영역 */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button onClick={handleLogout}>로그아웃</button>
          <button onClick={handleSelectFolder}>싱크용 폴더 선택</button>
        </div>

        {/* 서버 싱크 폴더 목록 */}
        {syncFolders.length > 0 && (
          <section>
            <h2>서버 싱크 폴더</h2>
            <ul>
              {syncFolders.map(({ id, folderPath }) => (
                <li
                  key={id}
                  // onContextMenu={handleContextMenu(id)}
                  style={{ cursor: 'context-menu', margin: '4px 0' }}
                  title="우클릭으로 삭제"
                >
                  {folderPath}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 로컬 파일 백업 상태 */}
        {fileStatuses.length > 0 && (
          <section style={{ marginTop: '24px' }}>
            <h2>파일 백업 상태</h2>
            <ul>
              {fileStatuses.map(({ filePath, status }) => (
                <li key={filePath} style={{ margin: '4px 0' }}>
                  <strong>{filePath}</strong>: {status}{' '}
                  <button onClick={() => handleDownload(filePath)}>다운로드</button>
                </li>
              ))}
            </ul>
          </section>
        )}

      </div>
    </div>
  );
};

export default Home;

