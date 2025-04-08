// src/pages/Home.jsx
import React, { useState, useEffect } from 'react';
import '../css/auth.css';
import { sendSyncFolder, backupFile, downloadBackupFile } from '../apiService';

// nodeIntegration 활성화되어 있으므로, window.require 사용
const chokidar = window.require('chokidar');
const fs = window.require('fs');

const Home = () => {
  const [folderPath, setFolderPath] = useState('');
  // syncFolder가 이미 지정되어 있다면 localStorage에서 가져오기
  // const [folderPath, setFolderPath] = useState(localStorage.getItem('syncFolder') || '');
  const [fileStatuses, setFileStatuses] = useState([]);

  const { ipcRenderer } = window.require('electron');


  // 폴더 선택 함수: 최초로 폴더를 선택하면 서버에 저장하고 localStorage에도 저장하여 반복 요청을 피함
  const handleSelectFolder = async () => {
    if (!folderPath) {
      const selectedFolder = await ipcRenderer.invoke('open-folder-dialog');
      if (selectedFolder) {
        setFolderPath(selectedFolder);
        // 로컬에도 저장
        localStorage.setItem('syncFolder', selectedFolder);
        console.log('선택된 폴더:', selectedFolder);
        try {
          const result = await sendSyncFolder(selectedFolder);
          console.log('폴더 전송 성공:', result);
        } catch (error) {
          console.error('폴더 전송 에러:', error);
        }
      }
    } else {
      console.log('이미 지정된 폴더 사용:', folderPath);
    }
  };

  // 파일별 상태 업데이트 함수 (배열로 관리)
  const updateFileStatus = (filePath, status) => {
    setFileStatuses(prevStatuses => {
      const idx = prevStatuses.findIndex(item => item.filePath === filePath);
      if (idx !== -1) {
        const newStatuses = [...prevStatuses];
        newStatuses[idx] = { filePath, status };
        return newStatuses;
      } else {
        return [...prevStatuses, { filePath, status }];
      }
    });
  };

  // folderPath가 설정되면, 해당 폴더 내의 .txt 파일을 감시
  useEffect(() => {
    if (folderPath) {
      // const watcher = chokidar.watch(`${folderPath}/**/*.txt`, {
      //   persistent: true,
      //   ignoreInitial: true
      // });
      
      // 변경: 서브폴더 제외 -> `${folderPath}/*.txt`
      const watcher = chokidar.watch(`${folderPath}/*.txt`, {
        persistent: true,
        ignoreInitial: true
      });      
      
      watcher.on('change', async (filePath) => {
        console.log(`변경 감지: ${filePath}`);
        updateFileStatus(filePath, '백업 중...');
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const result = await backupFile({ filePath, content });
          console.log('백업 성공:', result);
          updateFileStatus(filePath, '백업 성공');
        } catch (error) {
          console.error('백업 에러:', error);
          updateFileStatus(filePath, '백업 실패');
        }
      });
      
      return () => watcher.close();
    }
  }, [folderPath]);

  // 추가로, 백업 파일 다운로드(검증) 기능 예시:
  const handleDownloadBackup = async (filePath) => {
    try {
      const blob = await downloadBackupFile(filePath);
      // Blob URL 생성 후 다운로드 링크 클릭
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filePath.split('/').pop(); // 파일명 추출
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('다운로드 에러:', error);
      alert('다운로드 실패');
    }
  };


  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>HOME</h1>
        <button onClick={handleSelectFolder}>싱크용 폴더 선택</button>
        {folderPath && <p>선택된 폴더: {folderPath}</p>}
        {fileStatuses.length > 0 && (
          <div>
            <h2>파일 백업 상태</h2>
            <ul>
              {fileStatuses.map((item) => (
                <li key={item.filePath}>
                  <strong>{item.filePath}</strong>: {item.status}{' '}
                  {/* 검증: 백업 파일 다운로드 버튼 */}
                  <button onClick={() => handleDownloadBackup(item.filePath)}>다운로드 확인</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
export default Home;


  // // 파일 변경 시 diff 계산 및 버전관리 로직
  // useEffect(() => {
  //   if (folderPath) {
  //     const watcher = chokidar.watch(`${folderPath}/**/*.txt`, {
  //       persistent: true,
  //       ignoreInitial: true
  //     });

  //     watcher.on('change', async (filePath) => {
  //       console.log(`변경 감지: ${filePath}`);
  //       updateFileStatus(filePath, '백업 중...');

  //       try {
  //         const newContent = fs.readFileSync(filePath, 'utf8');
  //         let previousVersion = fileVersions[filePath];
  //         let newVersion, diffText;

  //         if (!previousVersion) {
  //           // 이전 버전이 없으면 초기 버전으로 설정 (버전 1)
  //           newVersion = 1;
  //           diffText = newContent; // 초기 백업에서는 전체 텍스트를 diff로 전달하거나 빈 문자열을 보낼 수 있음.
  //         } else {
  //           newVersion = previousVersion.version + 1;
  //           // 이전 내용과 새 내용 사이의 라인 단위 diff 계산
  //           const diff = jsdiff.diffLines(previousVersion.content, newContent);
  //           // diff 배열을 간단한 텍스트로 변환 (예: 추가된/삭제된 부분 요약)
  //           diffText = diff.map(part => {
  //             if (part.added) return `+${part.value}`;
  //             if (part.removed) return `-${part.value}`;
  //             return part.value;
  //           }).join('');
  //         }

  //         // 백업 API 호출 시 파일 경로, 새 내용, 버전 정보, 그리고 diff 결과를 전달
  //         const backupData = {
  //           filePath,
  //           content: newContent,
  //           version: newVersion,
  //           diff: diffText,
  //           timestamp: new Date().toISOString()
  //         };

  //         const result = await backupFile(backupData);
  //         console.log('백업 성공:', result);
  //         updateFileStatus(filePath, `백업 성공 (v${newVersion})`);

  //         // 파일 버전 정보를 업데이트
  //         setFileVersions(prev => ({
  //           ...prev,
  //           [filePath]: { version: newVersion, content: newContent }
  //         }));
  //       } catch (error) {
  //         console.error('백업 에러:', error);
  //         updateFileStatus(filePath, '백업 실패');
  //       }
  //     });

  //     return () => watcher.close();
  //   }
  // }, [folderPath, fileVersions]);
