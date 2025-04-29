// src/pages/FolderPage.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Menu, MenuItem, getCurrentWindow } from '@electron/remote';
import { dialog } from '@electron/remote';

import folderIcon from '../assets/Home/folder.svg';
import personIcon from '../assets/Home/person-24.svg';
import { UserContextMenu } from '../components/UserContextMenu';

import {
  getFolderFileList,
  getFolderFileMeta,
  downloadFolderFile,
  deleteFolderFile
} from '../apiService';

const fs     = window.require('fs');
const path   = window.require('path');
const Buffer = window.require('buffer').Buffer;

export default function FolderPage() {
  const { id }     = useParams();              // sync-folder ID
  const { state }  = useLocation();
  const folderPath = state?.folderPath || '';
  const navigate   = useNavigate();
  const username   = localStorage.getItem('currentUser') || 'User';

  // ── 헤더용 User 컨텍스트 메뉴 ── 
  const [userMenu, setUserMenu] = useState({ visible: false, x:0, y:0 });
  const showUserMenu = e => {
    e.preventDefault();
    setUserMenu({ visible: true, x: e.clientX, y: e.clientY });
  };
  const closeUserMenu = () => setUserMenu(m => ({ ...m, visible: false }));
  const handleLogout = () => {
    if (window.confirm('로그아웃하시겠습니까?')) {
      localStorage.clear();
      navigate('/');
    }
  };

  // ── 1) 파일 리스트: { id, name } 배열 ──
  const [fileList, setFileList] = useState([]);

  // ── 2) 마운트 시 / ID 바뀔 때마다 목록 조회 ──
  useEffect(() => {
    (async () => {
      try {
        const files = await getFolderFileList(id);
        const mapped = Array.isArray(files)
          ? files.map(f => {
              // 문자열로만 내려줄 경우
              if (typeof f === 'string') {
                return {
                  fileId:   f,
                  fileName: f,
                  name:     f
                };
              }
              // 객체 형태(FileMetaDTO)로 내려줄 경우
              // f.id가 없으면 f.relativePath를 대신 사용
              const idKey = (f.id != null ? f.id : f.relativePath).toString();
              const relPath = f.relativePath || idKey;
              return {
                fileId:   idKey,
                fileName: relPath,
                name:     f.originalName || relPath
              };
            })
          : [];        
        setFileList(mapped);
      } catch (err) {
        console.error(err);
        alert('파일 목록 조회 실패');
      }
    })();
  }, [id]);

  // ── “정보 가져오기” ──
  const handleInfo = async (fileName) => {
    try {
      const meta = await getFolderFileMeta(id, fileName);
      alert(JSON.stringify(meta, null, 2));
    } catch (err) {
      console.error(err);
      alert('메타정보 조회 실패');
    }
  };

  // ── “파일 다운로드” ──
  const handleDownload = async (fileName) => {
    try {
      const blob = await downloadFolderFile(id, fileName);
      const buf  = await blob.arrayBuffer();
      const { filePath } = await dialog.showSaveDialog({
        defaultPath: path.join(folderPath, fileName)
      });
      if (!filePath) return;
      fs.writeFileSync(filePath, Buffer.from(buf));
      alert('다운로드 완료!');
    } catch (err) {
      console.error(err);
      alert('다운로드 중 오류');
    }
  };

  const handleDelete = async (_fileId, fileName) => {
    // 1) 사용자 확인
    if (!window.confirm(`${fileName} 을(를) 정말 삭제하시겠습니까?`)) return;

    try {
      // 2) 서버에서 다시 메타 목록을 받아서, 해당 이름의 파일 ID 추출
      const metaList = await getFolderFileList(id);
      // 메타 객체 배열일 경우에만
      const fileMeta = Array.isArray(metaList)
        ? metaList.find(f =>
            // originalName 혹은 relativePath 중 매칭되는 값 찾기
            f.originalName === fileName ||
            f.relativePath === fileName
          )
        : null;

      if (!fileMeta || fileMeta.id == null) {
        throw new Error('삭제할 파일의 ID를 찾을 수 없습니다.');
      }
      const actualId = fileMeta.id;

      // 3) ID로 삭제 API 호출
      await deleteFolderFile(id, actualId);
      alert('삭제되었습니다.');

      // 4) 로컬 UI 업데이트: fileId로 필터링
      setFileList(fl => fl.filter(f => f.fileId !== actualId.toString()));
    } catch (err) {
      console.error(err);
      alert('삭제 실패: ' + err.message);
    }
  };


  // ── 우클릭 컨텍스트 메뉴 ──
  const showFileMenu = (e, { fileId, fileName, name }) => {
    e.preventDefault();
    const menu = new Menu();
    menu.append(new MenuItem({
      label: '파일 공유',
      click: () => alert(`’${name}‘ 공유 처리…`)
    }));
    menu.append(new MenuItem({
      label: '버전 관리',
      click: () => alert(`’${name}‘ 버전 관리 열기…`)
    }));
    menu.append(new MenuItem({
      label: '정보 가져오기',
      click: () => handleInfo(fileName)
    }));
    menu.append(new MenuItem({
      label: '파일 다운로드',
      click: () => handleDownload(fileName)
    }));
    menu.append(new MenuItem({
      label: '파일 삭제', 
      // click: () => handleDelete(fileId, name)
      click: () => handleDelete(null, fileName)

    }));
    menu.popup({ window: getCurrentWindow() });
  };

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column' }}>
      {/* ── 헤더 ── */}
      <header style={{
        display: 'flex', alignItems: 'center',
        padding: '0 16px', height: '72px',
        backgroundColor:'#f2f2f2', borderBottom:'1px solid #dee5ed'
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            fontSize:'24px', marginRight:'16px',
            background:'none', border:'none', cursor:'pointer'
          }}
        >←</button>
        <div style={{ flexGrow:1, fontWeight:'bold', fontSize:'18px' }}>
          {folderPath}
        </div>
        <div style={{ marginRight:'16px', fontSize:'16px' }}>
          {username}
        </div>
        <img
          src={personIcon}
          alt="User"
          onContextMenu={showUserMenu}
          style={{ width:24, height:24, cursor:'pointer' }}
        />
        {userMenu.visible && (
          <UserContextMenu
            x={userMenu.x}
            y={userMenu.y}
            onLogout={handleLogout}
            onClose={closeUserMenu}
          />
        )}
      </header>

      {/* ── 메인: 파일 리스트 ── */}
      <main style={{ padding:16, overflowY:'auto', flexGrow:1, background:'#fff' }}>
        {fileList.map(item => (
          <div
            key={item.fileId}                 /* ← fileId 로 바꿨습니다 */
            onContextMenu={e => showFileMenu(e, item)}
            style={{ display:'flex', alignItems:'center', padding:'8px 0' }}
          >
            <span style={{ marginRight: 8 }}>📄</span>
            <span style={{ flexGrow: 1 }}>{item.name}</span>
          </div>
        ))}
      </main>
    </div>
  );
}
