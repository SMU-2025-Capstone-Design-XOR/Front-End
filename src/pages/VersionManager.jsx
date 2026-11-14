// src/pages/VersionManager.jsx
// 버전 기록 창 (시안 Versions). 별도 창으로 열리고 쿼리로 대상 파일을 받는다.
import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import path from 'path';

import Icon, { fileIconOf } from '../components/Icon';
import { Modal, useDialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { formatSize, formatWhen, josa } from '../format';
import { restoreToFolder, saveVersionAs, versionedName, RestoreError, pausedNote } from '../restore';
import { getFileVersions, setVersionNote } from '../apiService';

const { ipcRenderer } = window.require('electron');

const NOTE_MAX = 500; // 서버의 FileVersion.NOTE_MAX_LENGTH와 같다

export default function VersionManager() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const folderId = params.get('folderId');
  const fileId = params.get('fileId');
  const relativePath = params.get('relativePath') || '';
  const folderName = params.get('folderName') || '';
  const fileName = relativePath ? path.posix.basename(relativePath) : '파일';

  const toast = useToast();
  const dialog = useDialog();

  const [versions, setVersions] = useState(null); // 최신순. null = 불러오는 중
  const [error, setError] = useState('');
  // 삭제된 파일의 기록을 보는 중인가. 되살아나면(이 창에서 되돌리기 포함) 풀린다.
  const [isDeleted, setIsDeleted] = useState(params.get('deleted') === '1');
  const [noteTarget, setNoteTarget] = useState(null); // 메모를 고치는 중인 버전
  const [noteInput, setNoteInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = `${fileName} · 버전 기록`; }, [fileName]);

  const load = useCallback(async () => {
    if (!folderId || !fileId) {
      setError('어느 파일의 버전 기록인지 알 수 없습니다.');
      return;
    }
    try {
      const list = await getFileVersions(folderId, fileId);
      setVersions([...list].sort((a, b) => b.versionNumber - a.versionNumber));
      setError('');
    } catch (err) {
      console.error('버전 목록 로드 실패:', err);
      setError(err.status === 404 ? '파일이 서버에서 삭제되었습니다.' : '버전 기록을 불러오지 못했습니다.');
    }
  }, [folderId, fileId]);

  useEffect(() => { load(); }, [load]);

  // 이 파일이 바뀌면(되돌리기로 새 버전이 올라간 경우 포함) 목록을 다시 읽는다
  useEffect(() => {
    const onChange = (channel) => (_e, payload) => {
      if (Number(payload?.folderId) !== Number(folderId) || payload?.relativePath !== relativePath) return;
      setIsDeleted(channel === 'sync-file-deleted');
      load();
    };
    const handlers = ['sync-file-added', 'sync-file-updated', 'sync-file-deleted'].map((ch) => [ch, onChange(ch)]);
    handlers.forEach(([ch, fn]) => ipcRenderer.on(ch, fn));
    return () => handlers.forEach(([ch, fn]) => ipcRenderer.removeListener(ch, fn));
  }, [folderId, relativePath, load]);

  const latest = versions?.[0]?.versionNumber ?? 0;
  const currentVersion = isDeleted ? null : latest; // 삭제된 파일에는 "현재" 버전이 없다

  // ── 요약: 버전 수, 실제 저장한 크기, 전부 통째로 저장했을 때와 비교한 절감률 ──
  const storedTotal = (versions || []).reduce((n, v) => n + (v.storedSize || 0), 0);
  const originalTotal = (versions || []).reduce((n, v) => n + (v.originalSize || 0), 0);
  const savedPercent = originalTotal > 0 ? Math.round((1 - storedTotal / originalTotal) * 100) : 0;

  const openNote = (v) => {
    setNoteTarget(v);
    setNoteInput(v.note || '');
  };

  const saveNote = async () => {
    if (!noteTarget || busy) return;
    setBusy(true);
    try {
      const updated = await setVersionNote(folderId, fileId, noteTarget.versionNumber, noteInput);
      setVersions((list) => list.map((v) => (v.versionNumber === noteTarget.versionNumber ? { ...v, note: updated.note || null } : v)));
      setNoteTarget(null);
    } catch (err) {
      console.error('메모 저장 실패:', err);
      toast.error('메모를 저장하지 못했습니다', err.body?.message || err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAs = async (v) => {
    try {
      const saved = await saveVersionAs({
        folderId, fileId, version: v.versionNumber, suggestedName: versionedName(fileName, v.versionNumber),
      });
      if (saved) toast.success(`v${v.versionNumber}${josa(String(v.versionNumber), '을', '를')} 저장했습니다`, saved);
    } catch (err) {
      console.error('버전 저장 실패:', err);
      toast.error('저장하지 못했습니다', err.body?.message || err.message);
    }
  };

  // 이 버전으로 되돌리기: 그 내용을 동기화 폴더의 파일에 쓴다 → 엔진이 새 버전으로 올린다 (기록은 지워지지 않는다)
  const handleRevert = async (v) => {
    const n = v.versionNumber;
    const current = versions.find((x) => x.versionNumber === latest);
    if (!isDeleted && current && current.hash === v.hash) {
      toast.info('이미 같은 내용입니다', `지금 파일은 v${n}과 내용이 같습니다.`);
      return;
    }
    const ok = await dialog.confirm({
      title: `v${n}${josa(String(n), '으로', '로')} 되돌릴까요?`,
      message: isDeleted
        ? `삭제된 ${fileName}${josa(fileName, '을', '를')} v${n} 내용으로 되살립니다. 새 버전(v${latest + 1})으로 저장되고 다른 기기에도 내려갑니다.`
        : `이 PC의 ${fileName}${josa(fileName, '이', '가')} v${n} 내용으로 바뀌고 새 버전(v${latest + 1})으로 저장됩니다. 지금까지의 버전은 지워지지 않습니다.`,
      confirmLabel: '되돌리기',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await restoreToFolder({ folderId, fileId, version: n, relativePath, mustNotExist: isDeleted });
      toast.success(
        `v${n}${josa(String(n), '으로', '로')} 되돌렸습니다`,
        `${fileName}${josa(fileName, '이', '가')} v${n} 내용으로 바뀌었고 v${latest + 1}${josa(String(latest + 1), '으로', '로')} 저장됩니다.${await pausedNote(folderId)}`,
      );
    } catch (err) {
      console.error('되돌리기 실패:', err);
      toast.error('되돌리지 못했습니다', err instanceof RestoreError ? err.message : (err.body?.message || err.message));
    } finally {
      setBusy(false);
    }
  };

  const headIcon = fileIconOf(fileName);
  const where = [folderName, path.posix.dirname(relativePath) !== '.' ? path.posix.dirname(relativePath) : ''].filter(Boolean).join('/');

  return (
    <div className="page">
      <header className="ver-header">
        <div className="ver-header__icon"><Icon name={headIcon.name} size={24} /></div>
        <div className="ver-header__title">
          <h1>{fileName}</h1>
          <p>버전 기록{where ? ` · ${where}` : ''}{isDeleted ? ' · 삭제된 파일' : ''}</p>
        </div>
        <button type="button" className="btn" onClick={() => window.close()}>닫기</button>
      </header>

      <main className="ver-main">
        {error && <div role="alert" className="alert"><Icon name="error" size={16} sw={2.5} />{error}</div>}
        {!error && versions === null && <p className="state-msg">불러오는 중</p>}
        {!error && versions !== null && versions.length === 0 && <p className="state-msg">버전이 없습니다.</p>}

        {versions !== null && versions.length > 0 && (
          <>
            <dl className="ver-stats">
              <div><dt>버전</dt><dd>{versions.length}개</dd></div>
              <div><dt>실제 저장한 크기</dt><dd>{formatSize(storedTotal)}</dd></div>
              <div>
                <dt>전부 통째로 저장했다면 {formatSize(originalTotal)}</dt>
                {savedPercent > 0 ? <dd className="saved">{savedPercent}% 절감</dd> : <dd>절감 없음</dd>}
              </div>
            </dl>

            <ol className="ver-list">
              {versions.map((v) => {
                const isCurrent = v.versionNumber === currentVersion;
                return (
                  <li key={v.versionNumber} className={`ver-item${isCurrent ? ' ver-item--current' : ''}`} data-version={v.versionNumber}>
                    <div className="ver-item__top">
                      <span className="ver-item__num">v{v.versionNumber}</span>
                      {isCurrent && <span className="badge badge--solid">현재</span>}
                      {v.versionType === 'SNAPSHOT'
                        ? <span className="badge badge--dark">전체본</span>
                        : <span className="badge badge--gray">변경분</span>}
                      {v.conflictWith != null && <span className="badge badge--warn">v{v.conflictWith}{josa(String(v.conflictWith), '과', '와')} 동시에 수정됨</span>}
                      <span className="ver-item__meta">{formatSize(v.storedSize)} 저장 · 파일 {formatSize(v.originalSize)}</span>
                      <div className="spacer" />
                      <span className="ver-item__meta">{formatWhen(v.createdDate)}{v.deviceName ? ` · ${v.deviceName}` : ''}</span>
                    </div>
                    <div className="ver-item__bottom">
                      {v.note
                        ? <p className="ver-item__note">{v.note}</p>
                        : (
                          <>
                            <button type="button" className="btn btn--sm btn--dashed" style={{ gap: 6 }} onClick={() => openNote(v)}>
                              <Icon name="plus" size={14} sw={2.5} />메모 추가
                            </button>
                            <div className="spacer" />
                          </>
                        )}
                      {v.note && <button type="button" className="btn btn--sm" onClick={() => openNote(v)}>메모 수정</button>}
                      {!isCurrent && (
                        <>
                          <button type="button" className="btn btn--sm" onClick={() => handleSaveAs(v)}>다른 이름으로 저장</button>
                          <button type="button" className="btn btn--soft btn--sm" style={{ padding: '0 14px' }} disabled={busy} onClick={() => handleRevert(v)}>
                            이 버전으로 되돌리기
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            <p className="ver-foot">
              되돌리면 그 내용이 새 버전(v{latest + 1})으로 저장됩니다. 지금까지의 버전은 지워지지 않습니다.
            </p>
          </>
        )}
      </main>

      {noteTarget && (
        <Modal label="버전 메모" onClose={() => setNoteTarget(null)}>
          <h3>v{noteTarget.versionNumber} 메모</h3>
          <label htmlFor="memo" className="dialog__hint">이 버전에서 무엇을 바꿨는지 적어 두면 다른 기기에서도 보입니다.</label>
          <textarea
            id="memo" rows={3} maxLength={NOTE_MAX} value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveNote(); }}
          />
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={() => setNoteTarget(null)}>취소</button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={saveNote}>저장</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
