// src/pages/VersionManager.jsx
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getFileVersions } from '../apiService'; // 나중에 백엔드 구현될 API

export default function VersionManager() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  const folderId     = params.get('folderId');
  const relativePath = params.get('relativePath');

  const [versions, setVersions] = useState([]);

//   useEffect(() => {
//     // 예: 백엔드에서 버전 리스트 받아오기
//     (async () => {
//       try {
//         const list = await getFileVersions(folderId, relativePath);
//         setVersions(list);
//       } catch (e) {
//         console.error('버전 리스트 로드 실패', e);
//       }
//     })();
//   }, [folderId, relativePath]);

  return (
    <div style={{ padding: 20 }}>
      <h2>버전 관리</h2>
      <button onClick={() => navigate(-1)}>← 뒤로</button>
      <h3>{relativePath}</h3>
      <ul>
        {versions.map(v => (
          <li key={v.versionId}>
            <strong>{v.versionLabel}</strong> — {new Date(v.timestamp).toLocaleString()}
            <button onClick={() => {/* 복원 로직 */}}>복원</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
