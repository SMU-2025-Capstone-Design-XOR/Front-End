// src/pages/Home.jsx
import React, { useState, useEffect } from 'react';
import '../styles.css';
import { sendSyncFolder, backupFile } from '../apiService';

// nodeIntegration 활성화되어 있으므로, window.require 사용
const chokidar = window.require('chokidar');
const fs = window.require('fs');

const Home = () => {
  const [folderPath, setFolderPath] = useState('');
  const [backupStatus, setBackupStatus] = useState('');
  
  // Electron IPC를 통해 폴더 선택 다이얼로그 호출
  const { ipcRenderer } = window.require('electron');

  const handleSelectFolder = async () => {
    const selectedFolder = await ipcRenderer.invoke('open-folder-dialog');
    if (selectedFolder) {
      setFolderPath(selectedFolder);
      console.log('선택된 폴더:', selectedFolder);
      // 선택된 폴더 정보를 백엔드에 전송 (싱크 폴더 지정)
      try {
        const result = await sendSyncFolder(selectedFolder);
        console.log('폴더 전송 성공:', result);
      } catch (error) {
        console.error('폴더 전송 에러:', error);
      }
    }
  };

  // 폴더 경로가 설정되면, 해당 폴더 내 .txt 파일을 감시하는 watcher 설정
  useEffect(() => {
    if (folderPath) {
      const watcher = chokidar.watch(`${folderPath}/**/*.txt`, {
        persistent: true,
        ignoreInitial: true
      });
      
      watcher.on('change', async (filePath) => {
        console.log(`변경 감지: ${filePath}`);
        setBackupStatus(`백업 중: ${filePath}`);
        try {
          // 파일 내용을 읽음 (UTF-8 인코딩)
          const content = fs.readFileSync(filePath, 'utf8');
          // 백업 API 호출: 파일 경로와 내용을 백엔드에 전송 (S3 연동)
          const result = await backupFile({ filePath, content });
          console.log('백업 성공:', result);
          setBackupStatus(`백업 성공: ${filePath}`);
        } catch (error) {
          console.error('백업 에러:', error);
          setBackupStatus(`백업 실패: ${filePath}`);
        }
      });
      
      return () => watcher.close();
    }
  }, [folderPath]);

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>홈 화면</h1>
        <p>로그인 후 표시될 홈 화면입니다.</p>
        <button onClick={handleSelectFolder}>파일 선택</button>
        {folderPath && <p>선택된 폴더: {folderPath}</p>}
        {backupStatus && <p>{backupStatus}</p>}
      </div>
    </div>
  );
};

export default Home;
