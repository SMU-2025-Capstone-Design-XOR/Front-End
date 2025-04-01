// src/pages/Home.jsx
import React, { useState } from 'react';
import '../styles.css';
// apiService에서 폴더 전송 함수를 import합니다.
import { sendSyncFolder } from '../apiService';

const Home = () => {
  const [folderPath, setFolderPath] = useState('');

  // nodeIntegration 활성화된 Electron에서는 window.require 사용 가능
  const { ipcRenderer } = window.require('electron');

  const handleSelectFolder = async () => {
    const selectedFolder = await ipcRenderer.invoke('open-folder-dialog');
    if (selectedFolder) {
      setFolderPath(selectedFolder);
      console.log('선택된 폴더:', selectedFolder);
      // 폴더 선택 후, API를 통해 서버로 폴더 정보를 전송합니다.
      try {
        const result = await sendSyncFolder(selectedFolder);
        console.log('폴더 전송 성공:', result);
      } catch (error) {
        console.error('폴더 전송 에러:', error);
      }
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>홈 화면</h1>
        <p>로그인 후 표시될 홈 화면입니다.</p>
        <button onClick={handleSelectFolder}>파일 선택</button>
        {folderPath && <p>선택된 폴더: {folderPath}</p>}
      </div>
    </div>
  );
};

export default Home;
