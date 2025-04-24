// src/pages/FolderPage.jsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Menu, MenuItem, getCurrentWindow }   from '@electron/remote';

import folderIcon from '../assets/Home/folder.svg';
import personIcon from '../assets/Home/person-24.svg';

import {
  getFolderFileList,
  uploadFile,
  downloadFolderFile
} from '../apiService';

const { ipcRenderer } = window.require('electron');
const fs   = window.require('fs');
const path = window.require('path');

export default function FolderPage() {
  const { id } = useParams();
  const { state } = useLocation();
  const folderPath = state?.folderPath || '';
  const navigate   = useNavigate();
  const username   = localStorage.getItem('currentUser') || 'User';
  const [fileList, setFileList] = useState([]);

  // 파일 목록 불러오기
  useEffect(() => {
    (async () => {
      try {
        const files = await getFolderFileList(id);
        setFileList(Array.isArray(files) ? files : []);
      } catch {
        alert('파일 목록 조회 실패');
      }
    })();
  }, [id]);

  // 유저 메뉴
  const showUserMenu = e => {
    e.preventDefault();
    const menu = new Menu();
    menu.append(new MenuItem({
      label: '로그아웃',
      click: () => {
        if (window.confirm('로그아웃하시겠습니까?')) {
          localStorage.clear();
          navigate('/');
        }
      }
    }));
    menu.popup({ window: getCurrentWindow() });
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 헤더 */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          height: '72px',
          backgroundColor: '#f2f2f2',
          borderBottom: '1px solid #dee5ed',
          boxSizing: 'border-box'
        }}
      >
        {/* 뒤로가기 버튼 */}
        <button
          onClick={() => navigate(-1)}
          style={{
            fontSize: '24px',
            marginRight: '16px',
            background: 'none',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          ←
        </button>

        {/* 현재 경로 표시 */}
        <div style={{ flexGrow: 1, fontWeight: 'bold', fontSize: '18px' }}>
          {folderPath}
        </div>

        {/* 사용자 이름 */}
        <div style={{ marginRight: '16px', fontSize: '16px' }}>
          {username}
        </div>

        {/* 사용자 아이콘 */}
        <img
          src={personIcon}
          alt="User"
          onContextMenu={showUserMenu}
          style={{
            width: '24px',
            height: '24px',
            cursor: 'pointer'
          }}
        />
      </header>

      {/* 파일 리스트 */}
      <main
        style={{
          padding: '16px',
          overflowY: 'auto',
          flexGrow: 1,
          backgroundColor: '#fff'
        }}
      >
        {fileList.length === 0 && (
          <div style={{ color: '#666' }}>이 폴더에 파일이 없습니다.</div>
        )}
        {fileList.map(name => (
          <div
            key={name}
            style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: '12px'
            }}
          >
            <span style={{ marginRight: '8px' }}>📄</span>
            <span style={{ flexGrow: 1 }}>{name}</span>
            <button
              onClick={() => uploadFile(id, path.join(folderPath, name))}
              style={{
                marginRight: '8px',
                padding: '4px 8px',
                cursor: 'pointer'
              }}
            >
              업로드
            </button>
            <button
              onClick={() => downloadFolderFile(id, name)}
              style={{
                padding: '4px 8px',
                cursor: 'pointer'
              }}
            >
              다운로드
            </button>
          </div>
        ))}
      </main>
    </div>
  );
}
