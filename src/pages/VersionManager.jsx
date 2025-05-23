// src/pages/VersionManager.jsx
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getCurrentWindow } from '@electron/remote';
import fs from 'fs';
import path from 'path';
import { getVersionNote, setVersionNote } from '../utils/versionNoteStore';

import { ReButton } from '../components/ReButton';
import { VersionItem } from "../components/VersionItem";
import VersionContext from '../components/VersionContext';
import back from "../assets/Version/back.svg";
import '../css/version.css';

import {
    getFileVersions,
    downloadFileVersion,
} from '../apiService';

export default function VersionManager() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const folderId     = params.get('folderId');
  const fileId = params.get('fileId');
  const relativePath = params.get('relativePath');

  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Context menu state
  const [ctxVisible, setCtxVisible] = useState(false);
  const [ctxX, setCtxX] = useState(0);
  const [ctxY, setCtxY] = useState(0);
  const [selectedVersion, setSelectedVersion] = useState(null);

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

  const handleContextMenu = (event, version) => {
    event.preventDefault();
    setSelectedVersion(version);
    setCtxX(event.clientX);
    setCtxY(event.clientY);
    setCtxVisible(true);
  };

  const handleCloseContext = () => {
    setCtxVisible(false);
    setSelectedVersion(null);
  };

  const handleEdit = async () => {
    if (!selectedVersion) return;
    const oldNote = getVersionNote(fileId, selectedVersion.versionNumber);
    const newNote = window.prompt(
      `V${selectedVersion.versionNumber}의 설명을 입력하세요:`,
      oldNote || ''
    );
    if (newNote !== null) {
      setVersionNote(fileId, selectedVersion.versionNumber, newNote);
      setVersions([...versions]); // 리렌더 트리거용
    }
    handleCloseContext();
  };
  


return (
    <div className="version">
      {/* 상단 헤더: 뒤로가기 + 타이틀 */}
      <ReButton
        className="vertitle"
        frameClassName="button-instance"
        text="Version Manager"
        // onClick={() => getCurrentWindow().close()}
      />
      <img
        className="back"
        alt="Back"
        src={back}
        onClick={() => getCurrentWindow().close()}
      />

      {/* 파일 이름 레이블 */}
      <div className="filen">
        <div className="label-text-2">{relativePath ? path.basename(relativePath) : "파일명 없음"}</div>
      </div>

      {/* 로딩/에러 표시 */}
      {loading && (
        <div style={{ position: "absolute", top: 160, left: 75, color: "#555" }}>
          로딩 중...
        </div>
      )}
      {error && (
        <div style={{ position: "absolute", top: 160, left: 75, color: "red" }}>
          {error}
        </div>
      )}

      {/* 버전 목록 */}
      {!loading &&
        !error &&
        (versions.length > 0 ? (
          versions.map((v, idx) => {
            // const label = `Version ${v.versionNumber} File`;
            const customLabel = getVersionNote(fileId, v.versionNumber);
            const label = `V${v.versionNumber} ${customLabel || 'File'}`;
            // 첫 번째 아이템 top 148px, 다음은 148 + 60 * idx
            const topPos = 148 + idx * 70;
            return (                
            <div
            key={v.versionId}
            style={{ position: 'absolute', top: topPos}}
            onContextMenu={e => handleContextMenu(e, v)}
          >
            <VersionItem
              label={label}
              top={0}
              onRestore={() => handleRestore(v.versionNumber)}
            />
          </div>            
            );
          })
        ) : (
          <div
            style={{ position: "absolute", top: 148, left: 75, color: "#555" }}
          >
            버전이 없습니다.
          </div>
        ))}
      <VersionContext
        x={ctxX}
        y={ctxY}
        visible={ctxVisible}
        onClose={handleCloseContext}
        onEdit={handleEdit}
      />
    </div>
  );
}
