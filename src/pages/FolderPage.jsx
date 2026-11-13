// src/pages/FolderPage.jsx
// 폴더 화면: 파일 표와 삭제된 파일 탭 (시안 Folder · Deleted)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import path from 'path';

import Header from '../components/Header';
import Icon, { fileIconOf } from '../components/Icon';
import MenuButton from '../components/Menu';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog';
import { useSyncStatus } from '../syncStatus';
import { formatSize, formatWhen, formatFull, josa, parseConflictCopy } from '../format';
import { restoreToFolder, saveVersionAs, RestoreError } from '../restore';
import {
  getSyncFolder,
  getFolderFileList,
  getDeletedFiles,
  getFileVersions,
  deleteFolderFile,
  getPresignedDownloadUrl,
  getUserIdFromToken,
} from '../apiService';

const { ipcRenderer, clipboard } = window.require('electron');

const SHARE_MINUTES = 30;

// 점으로 시작하는 이름은 화면에 보이지 않는다 (엔진의 무시 목록과 같은 기준)
const isHidden = (rel) => rel.split('/').some((seg) => seg.startsWith('.'));
const dirOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const baseOf = (rel) => rel.slice(rel.lastIndexOf('/') + 1);

export default function FolderPage() {
  const { id } = useParams(); // 동기화 폴더 ID
  const { state } = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { status } = useSyncStatus();

  // 폴더 이름과 이 기기에서의 위치. 홈에서 넘겨받지 못했으면(새로 고침 등) 서버와 엔진에서 다시 읽는다.
  const [folderName, setFolderName] = useState(state?.folderName || '');
  const [localRoot, setLocalRoot] = useState(state?.localPath || null);
  useEffect(() => {
    ipcRenderer.invoke('sync:folders').then((list) => {
      const linked = list.find((f) => Number(f.id) === Number(id));
      if (linked) { setLocalRoot(linked.localRoot); setFolderName((name) => name || linked.name); }
    }).catch((err) => console.error('로컬 폴더 위치 조회 실패:', err));
    if (!state?.folderName) {
      getSyncFolder().then((list) => {
        const found = (Array.isArray(list) ? list : []).find((f) => Number(f.id) === Number(id));
        if (found) setFolderName(found.name);
      }).catch(() => {});
    }
  }, [id, state?.folderName]);

  const [files, setFiles] = useState(null);      // 삭제되지 않은 파일 (서버 목록 그대로, relativePath = 실제 경로)
  const [deleted, setDeleted] = useState([]);    // 삭제된 파일 (변경 목록의 툼스톤)
  const [tab, setTab] = useState('files');       // 'files' | 'deleted'
  const [subPath, setSubPath] = useState('');    // 보고 있는 하위 폴더 ('' = 맨 위)
  const [copyVersions, setCopyVersions] = useState({}); // 충돌 사본 경로 → 원래 파일의 버전 번호

  const reload = useCallback(async () => {
    try {
      const [list, tombstones] = await Promise.all([getFolderFileList(id), getDeletedFiles(id)]);
      setFiles(list.filter((f) => f.type === 'file' && !isHidden(f.relativePath)));
      setDeleted(tombstones.filter((f) => !isHidden(f.relativePath))
        .sort((a, b) => String(b.lastModified || '').localeCompare(String(a.lastModified || ''))));
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        navigate('/', { state: { expired: true } });
        return;
      }
      console.error('파일 목록 조회 실패:', err);
      setFiles((prev) => prev || []);
      toast.error('파일 목록을 불러오지 못했습니다', err.status === 404 ? '폴더가 서버에서 삭제되었습니다.' : '서버에 연결할 수 있는지 확인해 주세요.');
    }
  }, [id, navigate, toast]);

  useEffect(() => { reload(); }, [reload]);

  // 엔진이 파일 변화를 알리면 목록을 다시 읽는다 (여러 건이 연달아 오면 한 번으로 합친다)
  useEffect(() => {
    let timer = null;
    const onChange = (_e, payload) => {
      if (Number(payload?.folderId) !== Number(id)) return;
      clearTimeout(timer);
      timer = setTimeout(reload, 300);
    };
    const channels = ['sync-file-added', 'sync-file-updated', 'sync-file-deleted'];
    channels.forEach((ch) => ipcRenderer.on(ch, onChange));
    return () => {
      clearTimeout(timer);
      channels.forEach((ch) => ipcRenderer.removeListener(ch, onChange));
    };
  }, [id, reload]);

  // 지금 보고 있는 하위 폴더가 없어졌으면(마지막 파일 삭제 등) 남아 있는 가장 가까운 위 단계로 올라간다
  useEffect(() => {
    if (!files || !subPath) return;
    let p = subPath;
    while (p && !files.some((f) => f.relativePath.startsWith(`${p}/`))) p = dirOf(p);
    if (p !== subPath) setSubPath(p);
  }, [files, subPath]);

  // ── 지금 단계에 보여 줄 하위 폴더와 파일 ──
  const { dirs, rows } = useMemo(() => {
    const dirCount = new Map();
    const here = [];
    const prefix = subPath ? `${subPath}/` : '';
    for (const f of files || []) {
      if (!f.relativePath.startsWith(prefix)) continue;
      const rest = f.relativePath.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash < 0) here.push(f);
      else dirCount.set(rest.slice(0, slash), (dirCount.get(rest.slice(0, slash)) || 0) + 1);
    }
    return {
      dirs: [...dirCount].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
      rows: here.sort((a, b) => baseOf(a.relativePath).localeCompare(baseOf(b.relativePath), 'ko')),
    };
  }, [files, subPath]);

  // ── 충돌 사본 표시: 이름이 `원래이름_기기_YYYYMMDD-HHMMSS.확장자`이고 같은 자리에 원래 파일(삭제된 것 포함)이 있을 때만 ──
  const conflictInfo = useMemo(() => {
    const known = new Map();
    for (const f of [...(files || []), ...deleted]) known.set(f.relativePath, f);
    const out = new Map();
    for (const f of rows) {
      const parsed = parseConflictCopy(baseOf(f.relativePath));
      if (!parsed) continue;
      const dir = dirOf(f.relativePath);
      for (const c of parsed.candidates) {
        const original = known.get(dir ? `${dir}/${c.original}` : c.original);
        if (original) { out.set(f.relativePath, { original, name: c.original, stamp: parsed.stamp }); break; }
      }
    }
    return out;
  }, [files, deleted, rows]);

  // 사본이 원래 파일의 몇 번째 버전인지: 원래 파일의 버전 목록에서 저장 시각이 사본 이름의 시각과 같은 버전
  const askedRef = useRef(new Set());
  useEffect(() => {
    for (const [copyPath, info] of conflictInfo) {
      if (askedRef.current.has(copyPath)) continue;
      askedRef.current.add(copyPath);
      getFileVersions(id, info.original.fileId).then((versions) => {
        const hit = versions.find((v) => String(v.createdDate || '').replace(/[-:]/g, '').replace('T', '-').slice(0, 15) === info.stamp);
        if (hit) setCopyVersions((prev) => ({ ...prev, [copyPath]: hit.versionNumber }));
      }).catch(() => {});
    }
  }, [id, conflictInfo]);

  const pendingPaths = useMemo(
    () => new Set(status.folders?.find((f) => Number(f.id) === Number(id))?.paths || []),
    [status, id],
  );

  // ── 동작 ──
  const openVersions = (file, isDeleted = false) => {
    ipcRenderer.send('open-version-window', {
      folderId: Number(id), fileId: file.fileId, relativePath: file.relativePath, folderName, deleted: isDeleted,
    });
  };

  const openInExplorer = async () => {
    const target = localRoot ? path.join(localRoot, ...subPath.split('/').filter(Boolean)) : null;
    const error = target ? await ipcRenderer.invoke('open-path', target) : '이 PC에 아직 연결되지 않았습니다.';
    if (error) toast.error('폴더를 열지 못했습니다', error);
  };

  const handleSaveAs = async (file) => {
    try {
      // 최신 버전을 버전 번호로 받는다 (목록을 본 뒤 새 버전이 올라와도 화면에 보인 버전이 저장된다)
      const saved = await saveVersionAs({ folderId: id, fileId: file.fileId, version: file.version, suggestedName: baseOf(file.relativePath) });
      if (saved) toast.success('저장했습니다', saved);
    } catch (err) {
      console.error('다른 이름으로 저장 실패:', err);
      toast.error('저장하지 못했습니다', err.body?.message || err.message);
    }
  };

  const handleShare = async (file) => {
    try {
      // 최신본의 S3 키: users/{나}/sync-folders/{폴더}/{상대 경로}/latest/{파일명}
      const key = `users/${getUserIdFromToken()}/sync-folders/${id}/${file.relativePath}/latest/${baseOf(file.relativePath)}`;
      const url = await getPresignedDownloadUrl(key, SHARE_MINUTES);
      clipboard.writeText(url);
      toast.info('공유 링크를 복사했습니다', `붙여 넣어 전달하세요. 링크는 ${SHARE_MINUTES}분 뒤에 만료됩니다.`, { icon: 'link' });
    } catch (err) {
      console.error('파일 공유 실패:', err);
      toast.error('공유 링크를 만들지 못했습니다', err.body?.message || err.message);
    }
  };

  const showInfo = (file) => {
    const dir = dirOf(file.relativePath);
    dialog.info({
      title: '파일 정보',
      rows: [
        ['이름', baseOf(file.relativePath)],
        ['위치', dir ? `${folderName}/${dir}` : folderName],
        ['크기', `${formatSize(file.size)} (${Number(file.size || 0).toLocaleString('ko-KR')}바이트)`],
        ['현재 버전', `v${file.version}`],
        ['수정한 시각', formatFull(file.lastModified)],
      ],
    });
  };

  const handleDelete = async (file) => {
    const name = baseOf(file.relativePath);
    const ok = await dialog.confirm({
      title: `${name}${josa(name, '을', '를')} 삭제할까요?`,
      message: '이 PC와 다른 기기에서 휴지통으로 이동합니다. 버전 기록은 남아 있어 삭제된 파일 탭에서 되살릴 수 있습니다.',
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    try {
      // baseVersion이 낡았으면 409: 그 사이 다른 기기가 고쳤다 → 수정이 이긴다
      await deleteFolderFile(id, file.fileId, file.version);
      // 로컬 파일은 여기서 지우지 않는다. 엔진이 삭제 표시(툼스톤)를 받아 휴지통으로 보낸다.
      ipcRenderer.send('sync:poll-now');
      toast.success('삭제했습니다', `${name}${josa(name, '은', '는')} 삭제된 파일 탭에서 되살릴 수 있습니다.`);
    } catch (err) {
      if (err.status === 409) {
        ipcRenderer.send('sync:poll-now');
        toast.error('삭제하지 않았습니다', '다른 기기에서 이 파일을 방금 수정했습니다. 수정한 내용을 내려받았습니다.');
      } else {
        console.error('파일 삭제 실패:', err);
        toast.error('삭제하지 못했습니다', err.body?.message || err.message);
      }
    }
    reload();
  };

  // 되살리기: 마지막 버전을 원래 자리에 써 두면 엔진이 새 파일로 올리고, 서버가 같은 파일을 되살린다
  const [reviving, setReviving] = useState(null);
  const handleRevive = async (file) => {
    const name = baseOf(file.relativePath);
    setReviving(file.fileId);
    try {
      await restoreToFolder({ folderId: id, fileId: file.fileId, version: file.version, relativePath: file.relativePath, mustNotExist: true });
      toast.success('되살렸습니다', `${name}${josa(name, '이', '가')} 이 폴더에 다시 생겼고, 곧 다른 기기에도 내려갑니다.`);
    } catch (err) {
      console.error('되살리기 실패:', err);
      toast.error('되살리지 못했습니다', err instanceof RestoreError ? err.message : (err.body?.message || err.message));
    } finally {
      setReviving(null);
    }
  };

  // ── 현재 위치 ──
  const segments = subPath ? subPath.split('/') : [];
  const title = segments.length ? segments[segments.length - 1] : folderName;
  const herePath = localRoot ? path.join(localRoot, ...segments) : '';

  return (
    <div className="page">
      <Header />
      <main className="folder-main">
        <nav aria-label="현재 위치" className="crumbs">
          <button type="button" onClick={() => navigate('/home')}>동기화 폴더</button>
          <span aria-hidden="true">/</span>
          {segments.length === 0
            ? <span className="here">{folderName}</span>
            : <button type="button" onClick={() => { setSubPath(''); setTab('files'); }}>{folderName}</button>}
          {segments.map((seg, i) => (
            <React.Fragment key={segments.slice(0, i + 1).join('/')}>
              <span aria-hidden="true">/</span>
              {i === segments.length - 1
                ? <span className="here">{seg}</span>
                : <button type="button" onClick={() => { setSubPath(segments.slice(0, i + 1).join('/')); setTab('files'); }}>{seg}</button>}
            </React.Fragment>
          ))}
        </nav>

        <div className="folder-head">
          <div>
            <h1>{title}</h1>
            <p>{herePath || '이 PC에 폴더를 준비하고 있습니다'}</p>
          </div>
          <button type="button" className="btn" onClick={openInExplorer}>탐색기에서 열기</button>
        </div>

        <div className="tabs" role="tablist">
          <button type="button" role="tab" className="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')}>
            파일 {(files || []).length}
          </button>
          <button type="button" role="tab" className="tab" aria-selected={tab === 'deleted'} onClick={() => setTab('deleted')}>
            삭제된 파일 {deleted.length}
          </button>
        </div>

        {tab === 'files' && (
          <div className="table-card">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">이름</th>
                  <th scope="col" className="num" style={{ width: 96 }}>크기</th>
                  <th scope="col" style={{ width: 170 }}>수정한 시각</th>
                  <th scope="col" style={{ width: 72 }}>버전</th>
                  <th scope="col" style={{ width: 190 }}><span className="sr-only">동작</span></th>
                </tr>
              </thead>
              <tbody>
                {dirs.map((dir) => (
                  <tr key={`dir:${dir.name}`}>
                    <td>
                      <button type="button" className="name-cell" onClick={() => setSubPath(subPath ? `${subPath}/${dir.name}` : dir.name)}>
                        <Icon name="folder" size={22} color="#2459D6" />
                        <span className="name">{dir.name}</span>
                      </button>
                    </td>
                    <td className="num sub">파일 {dir.count}개</td>
                    <td /><td /><td />
                  </tr>
                ))}
                {rows.map((file) => {
                  const name = baseOf(file.relativePath);
                  const icon = fileIconOf(name);
                  const conflict = conflictInfo.get(file.relativePath);
                  const copyVersion = copyVersions[file.relativePath];
                  return (
                    <tr key={file.fileId}>
                      <td>
                        <div className="name-cell">
                          <Icon name={icon.name} size={22} color={icon.color} />
                          <div style={{ minWidth: 0 }}>
                            <div className="name">{name}</div>
                            {pendingPaths.has(file.relativePath) && (
                              <div className="mark mark--sync"><Icon name="sync" size={12} sw={3} />동기화 중</div>
                            )}
                            {conflict && (
                              <div className="mark mark--conflict">
                                충돌 사본 · {conflict.name}{copyVersion ? `의 v${copyVersion}` : '의 사본'}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="num sub">{formatSize(file.size)}</td>
                      <td className="sub">{formatWhen(file.lastModified)}</td>
                      <td className="ver">v{file.version}</td>
                      <td className="actions">
                        <div className="row-actions">
                          <button type="button" className="btn btn--sm btn--ver" onClick={() => openVersions(file)}>버전 기록</button>
                          <MenuButton
                            label={`${name} 메뉴`} className="icon-btn icon-btn--sm"
                            items={[
                              { icon: 'download', label: '다른 이름으로 저장', onClick: () => handleSaveAs(file) },
                              { icon: 'link', label: '공유 링크 복사', onClick: () => handleShare(file) },
                              { icon: 'info', label: '파일 정보', onClick: () => showInfo(file) },
                              'sep',
                              { icon: 'trash', label: '삭제', danger: true, onClick: () => handleDelete(file) },
                            ]}
                          >
                            <Icon name="dots" size={18} />
                          </MenuButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {files !== null && dirs.length + rows.length === 0 && (
                  <tr><td colSpan={5} className="table-empty">아직 파일이 없습니다. 이 폴더에 파일을 넣으면 자동으로 올라갑니다.</td></tr>
                )}
                {files === null && (
                  <tr><td colSpan={5} className="table-empty">불러오는 중</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'deleted' && (
          <>
            <div className="banner">
              <Icon name="info" size={18} color="#1D49B5" />
              <p>삭제한 파일의 버전 기록은 서버에 남아 있습니다. 되살리면 이 폴더에 다시 생기고 다른 기기에도 내려갑니다. 이 PC에서 지운 파일은 휴지통에도 있습니다.</p>
            </div>
            <div className="table-card">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">이름</th>
                    <th scope="col" className="num" style={{ width: 96 }}>크기</th>
                    <th scope="col" style={{ width: 170 }}>마지막 수정</th>
                    <th scope="col" style={{ width: 110 }}>마지막 버전</th>
                    <th scope="col" style={{ width: 220 }}><span className="sr-only">동작</span></th>
                  </tr>
                </thead>
                <tbody>
                  {deleted.map((file) => {
                    const name = baseOf(file.relativePath);
                    const dir = dirOf(file.relativePath);
                    const icon = fileIconOf(name);
                    return (
                      <tr key={file.fileId}>
                        <td>
                          <div className="name-cell">
                            <Icon name={icon.name} size={22} color="#566070" />
                            <div style={{ minWidth: 0 }}>
                              <div className="name">{name}</div>
                              {dir && <div className="mark mark--where">{dir} 폴더</div>}
                            </div>
                          </div>
                        </td>
                        <td className="num sub">{formatSize(file.size)}</td>
                        <td className="sub">{formatWhen(file.lastModified)}</td>
                        <td className="ver">v{file.version}</td>
                        <td className="actions">
                          <div className="row-actions">
                            <button type="button" className="btn btn--sm" onClick={() => openVersions(file, true)}>버전 기록</button>
                            <button
                              type="button" className="btn btn--primary btn--sm" style={{ padding: '0 14px' }}
                              disabled={reviving === file.fileId} onClick={() => handleRevive(file)}
                            >
                              되살리기
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {deleted.length === 0 && (
                    <tr><td colSpan={5} className="table-empty">삭제된 파일이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
