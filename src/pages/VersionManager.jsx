// src/pages/VersionManager.jsx
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { dialog } from '@electron/remote';
import fs from 'fs';
import path from 'path';
import { ReButton } from '../components/ReButton';
import '../css/version.css';

import {
    getFileVersions,
    downloadFileVersion,
} from '../apiService';

export default function VersionManager() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  const folderId     = params.get('folderId');
  const fileId = params.get('fileId');
  const relativePath = params.get('relativePath');

  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);


  useEffect(() => {
    if (!folderId || !fileId) {
      setError('folderId 또는 fileId가 없습니다.');
      return;
    }
    setLoading(true);
    getFileVersions(folderId, fileId)
      .then(list => {
        setVersions(list);
        setLoading(false);
      })
      .catch(err => {
        console.error('버전 리스트 로드 실패', err);
        setError('버전 리스트를 불러오지 못했습니다.');
        setLoading(false);
      });
  }, [folderId, fileId]);


  const handleRestore = async (versionNumber) => {
    try {
      const { blob, filename, mimeType } = await downloadFileVersion(folderId, fileId, versionNumber);
      // 브라우저 다운로드
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('버전 복원 실패', err);
      alert('복원 중 오류가 발생했습니다: ' + err.message);
    }
  };

  return (
    <div className="version-manager" style={{ padding: 20 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <button onClick={() => navigate(-1)}>Back</button>
      <h2 style={{ margin: 0 }}>버전 관리</h2>
      </header>
      <h3>{relativePath}</h3>
      {loading && <p>로딩 중...</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && (
        <ul className="version-list">
          {versions.map(v => (
            <li key={v.versionId} className="version-item">
              <div className="version-info">
                <span className="version-label">v{v.versionNumber} ({v.versionType})</span>
                <span className="version-date">{new Date(v.createdDate).toLocaleString()}</span>
              </div>
              <button className="restore-button" onClick={() => handleRestore(v.versionNumber)}>
                복원
              </button>
            </li>
          ))}
          {versions.length === 0 && <li>버전이 없습니다.</li>}
        </ul>
      )}
    </div>
  );
}
