// src/pages/VersionManager.jsx
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getCurrentWindow } from '@electron/remote';
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

  const [versionNotes, setVersionNotes] = useState({});

  // Context menu state
  const [ctxVisible, setCtxVisible] = useState(false);
  const [ctxX, setCtxX] = useState(0);
  const [ctxY, setCtxY] = useState(0);
  const [selectedVersion, setSelectedVersion] = useState(null);
  

  // Edit modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [noteInput, setNoteInput] = useState('');

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

  // Load notes map whenever versions change
  useEffect(() => {
    async function loadNotes() {
      const notes = {};
      await Promise.all(
        versions.map(async v => {
          const note = await getVersionNote(folderId, v.versionNumber);
          notes[v.versionNumber] = note || '';
        })
      );
      setVersionNotes(notes);
    }
    if (versions.length) loadNotes();
  }, [versions, folderId]);

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

//   const handleCloseContext = () => {
//     setCtxVisible(false);
//     setSelectedVersion(null);
//   };

const handleEdit = async () => {
    if (!selectedVersion) return;
    const oldNote = await getVersionNote(folderId, selectedVersion.versionNumber);
    setNoteInput(oldNote || '');
    setEditModalVisible(true);
    setCtxVisible(false);
};

const saveEdit = async () => {
    if (!selectedVersion) return;
    await setVersionNote(folderId, selectedVersion.versionNumber, noteInput);
    // setVersions(vs => [...vs]);
    setVersionNotes(prev => ({
        ...prev,
        [selectedVersion.versionNumber]: noteInput
      }));
    setEditModalVisible(false);
    setSelectedVersion(null);
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
            const note = versionNotes[v.versionNumber] || '';
            const label = `V${v.versionNumber} ${note || 'File'}`;
            const lastMod = v.lastModified;
            const formattedDate = lastMod
                ? new Date(lastMod).toLocaleString()
                : '';
            // 첫 번째 아이템 top 148px, 다음은 148 + 60 * idx
            const topPos = 148 + idx * 70;
            return (                
            <div
                key={v.versionId}
                className="versionmap"
                style={{ position: 'absolute', top: topPos}}
                onContextMenu={e => handleContextMenu(e, v)}
            >
            <div className="div">
              <div>
                <p className="text-wrapper">{label}</p>
                {formattedDate && (
                  <p className="text-subtext">{formattedDate}</p>
                )}
              </div>
            </div>
            <div
                  className="restore"
                  onClick={() => handleRestore(v.versionNumber)}
                >
                  <span className="label-text">Restore</span>
                </div>
            {/* <VersionItem
              label={label}
              top={0}
              onRestore={() => handleRestore(v.versionNumber)}
            /> */}
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
        // onClose={handleCloseContext}
        onEdit={handleEdit}
      />
      
      {editModalVisible && selectedVersion &&(
        <div className="modal-overlay">
          <div className="modal">
            <h2>V{selectedVersion?.versionNumber} 버전 정보 수정</h2>
            <textarea
              value={noteInput}
              onChange={e => setNoteInput(e.target.value)}
              rows={4}
              style={{ width: '100%' }}
            />
            <div className="modal-buttons">
              <button onClick={() => { setEditModalVisible(false); setSelectedVersion(null); }}>취소</button>
              <button onClick={saveEdit}>저장</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
