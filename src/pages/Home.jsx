// src/pages/Home.jsx
// 홈: 동기화 폴더 목록(줄 목록)과 "이 기기" 정보 (시안 Main · HomeEmpty)
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import os from 'os';
import path from 'path';

import Header from '../components/Header';
import Icon from '../components/Icon';
import MenuButton from '../components/Menu';
import { useToast } from '../components/Toast';
import { useDialog } from '../components/Dialog';
import { useSyncStatus } from '../syncStatus';
import { formatAgo, formatFull, formatInterval, josa } from '../format';
import { API_BASE, getSyncFolder, deleteSyncFolder } from '../apiService';

const { ipcRenderer } = window.require('electron');

const HOW_IT_WORKS = [
  '파일을 저장하면 자동으로 올리고, 바뀐 부분만 보관합니다.',
  '파일마다 버전 기록이 남아 예전 내용으로 되돌릴 수 있습니다.',
  '두 기기에서 동시에 고치면 한쪽을 사본으로 남깁니다.',
  '지운 파일은 휴지통으로 가고, 삭제된 파일 탭에서 되살릴 수 있습니다.',
];

/**
 * 서버의 폴더 목록에 "이 기기에서의 위치"를 붙여 화면용 목록을 만든다.
 * 위치는 main 프로세스의 동기화 엔진이 기억한다: 폴더를 등록한 기기는 고른 경로,
 * 다른 기기는 ~/XOR/{사용자명}/{폴더 이름}. 엔진이 아직 연결하기 전이면 localPath는 null이다.
 */
function toViewFolders(serverFolders, engineFolders) {
  return serverFolders.map((folder) => {
    const name = folder.name || path.basename(folder.folderPath || '');
    const linked = engineFolders.find((f) => Number(f.id) === Number(folder.id));
    return {
      id: folder.id,
      name,
      serverPath: folder.folderPath, // 처음 등록한 기기의 경로 (참고용)
      createdAt: folder.createdAt,
      localPath: linked ? linked.localRoot : null,
      blocked: !!linked?.blocked,
      registeredElsewhere: !!linked?.registeredElsewhere,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

export default function Home() {
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { status } = useSyncStatus();
  const username = localStorage.getItem('currentUser') || '';
  const config = ipcRenderer.sendSync('get-config');

  const [folders, setFolders] = useState(null); // null = 아직 불러오는 중
  const [, tick] = useState(0);

  // 서버의 폴더 목록 + 엔진이 기억하는 로컬 위치를 다시 읽는다
  const reloadFolders = useCallback(async () => {
    const data = await getSyncFolder();
    const engineFolders = await ipcRenderer.invoke('sync:folders');
    setFolders(toViewFolders(Array.isArray(data) ? data : [], engineFolders));
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      navigate('/');
      return undefined;
    }
    const load = () => reloadFolders().catch((err) => {
      if (err.status === 401 || err.status === 403) {
        // 이 서버는 토큰이 없거나 만료되면 403을 준다
        navigate('/', { state: { expired: true } });
      } else {
        console.error('폴더 목록 로드 오류:', err);
        setFolders((prev) => prev || []);
        toast.error('폴더 목록을 불러오지 못했습니다', '서버에 연결할 수 있는지 확인해 주세요.');
      }
    });
    load();

    // 엔진이 알려 주는 폴더 변화: 서버에서 삭제됨 / 다른 기기가 등록한 폴더가 연결됨
    ipcRenderer.on('sync-folder-removed', load);
    ipcRenderer.on('dosync-folder-added', load);
    const timer = setInterval(() => tick((n) => n + 1), 10000); // "마지막 확인" 글자 갱신
    return () => {
      ipcRenderer.removeListener('sync-folder-removed', load);
      ipcRenderer.removeListener('dosync-folder-added', load);
      clearInterval(timer);
    };
  }, [navigate, reloadFolders, toast]);

  // "폴더 추가": 고른 폴더를 그대로 등록한다(복사하지 않는다). 등록·초기 점검·업로드는 main 프로세스의 엔진이 한다.
  const handleAddFolder = async () => {
    const selected = await ipcRenderer.invoke('open-folder-dialog');
    if (!selected) return;
    try {
      const result = await ipcRenderer.invoke('sync:register-folder', selected);
      if (!result.ok) {
        if (result.status === 409) {
          // 같은 이름의 폴더가 이미 있다. 다른 기기에서 등록한 폴더는 목록에 이미 연결돼 있다.
          const name = result.current?.name || path.basename(selected);
          toast.error('같은 이름의 폴더가 이미 있습니다', `‘${name}’ 폴더가 이미 등록되어 있습니다. 폴더 이름을 바꾼 뒤 다시 추가해 주세요.`);
        } else {
          console.error('폴더 등록 실패:', result);
          toast.error('폴더를 추가하지 못했습니다', result.message || '');
        }
        return;
      }
      await reloadFolders();
      toast.success('폴더를 추가했습니다', `${path.basename(selected)} 안의 파일을 올리기 시작합니다.`);
    } catch (err) {
      console.error('폴더 등록 실패:', err);
      toast.error('폴더를 추가하지 못했습니다', err.message);
    }
  };

  const openFolder = (folder) => {
    navigate(`/folder/${folder.id}`, {
      state: { folderPath: folder.serverPath, localPath: folder.localPath, folderName: folder.name },
    });
  };

  const openInExplorer = async (folder) => {
    const error = folder.localPath ? await ipcRenderer.invoke('open-path', folder.localPath) : '이 PC에 아직 연결되지 않았습니다.';
    if (error) toast.error('폴더를 열지 못했습니다', error);
  };

  const showInfo = (folder) => {
    dialog.info({
      title: '폴더 정보',
      rows: [
        ['이름', folder.name],
        ['이 PC의 위치', folder.localPath || '연결하는 중'],
        ['등록', folder.registeredElsewhere ? '다른 기기에서 등록' : '이 PC에서 등록'],
        ['처음 등록한 위치', folder.serverPath || ''],
        ['등록한 시각', formatFull(folder.createdAt)],
      ],
    });
  };

  const handleDelete = async (folder) => {
    const ok = await dialog.confirm({
      title: `${folder.name} 동기화 폴더를 삭제할까요?`,
      message: '서버에 보관한 파일과 버전 기록이 모두 지워지고 되돌릴 수 없습니다. 이 PC와 다른 기기에 있는 폴더와 파일은 그대로 남습니다.',
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    try {
      // 서버에서 삭제한 뒤 엔진의 감시를 멈추고 상태 파일을 지운다 (로컬 폴더는 그대로 둔다)
      await deleteSyncFolder(folder.id);
      await ipcRenderer.invoke('sync:remove-folder', folder.id);
      await reloadFolders();
      toast.success('동기화 폴더를 삭제했습니다', `${folder.name}${josa(folder.name, '은', '는')} 이 PC에 그대로 남아 있습니다.`);
    } catch (err) {
      console.error('폴더 삭제 실패:', err);
      toast.error('폴더를 삭제하지 못했습니다', err.body?.message || err.message);
    }
  };

  const pendingOf = (id) => status.folders?.find((f) => Number(f.id) === Number(id))?.pending || 0;

  const renderFolder = (folder) => {
    const pending = pendingOf(folder.id);
    const menu = (
      <MenuButton
        label={`${folder.name} 폴더 메뉴`}
        items={[
          { icon: 'folder', label: '탐색기에서 열기', onClick: () => openInExplorer(folder) },
          { icon: 'info', label: '폴더 정보', onClick: () => showInfo(folder) },
          'sep',
          { icon: 'trash', label: '동기화 폴더 삭제', danger: true, onClick: () => handleDelete(folder) },
        ]}
      >
        <Icon name="dots" size={18} />
      </MenuButton>
    );

    if (folder.blocked) {
      return (
        <section key={folder.id} className="folder-row folder-row--blocked">
          <div className="folder-row__icon"><Icon name="folderAlert" size={24} /></div>
          <div className="folder-row__body">
            <div className="folder-row__name">
              <h2>{folder.name}</h2>
              <span className="badge badge--danger">동기화 중지 · 폴더를 찾을 수 없음</span>
            </div>
            <p className="folder-row__path">
              {folder.localPath} · 파일을 지운 것으로 처리하지 않도록 멈췄습니다. 폴더를 이 위치에 되돌려 놓고 로그아웃한 뒤 다시 로그인하면 이어집니다.
            </p>
          </div>
          {menu}
        </section>
      );
    }
    return (
      <section key={folder.id} className="folder-row">
        <div className="folder-row__icon"><Icon name="folder" size={24} /></div>
        <div className="folder-row__body">
          <div className="folder-row__name">
            <h2>{folder.name}</h2>
            {!folder.localPath
              ? <span className="badge badge--gray">연결하는 중</span>
              : pending > 0
                ? <span className="badge badge--accent">동기화 중 · {pending}개 남음</span>
                : <span className="badge badge--ok">동기화됨</span>}
            {folder.registeredElsewhere && <span className="badge badge--gray">다른 기기에서 등록</span>}
          </div>
          <p className="folder-row__path">{folder.localPath || '이 PC에 폴더를 준비하고 있습니다'}</p>
        </div>
        <button type="button" className="btn btn--soft folder-row__open" onClick={() => openFolder(folder)}>열기</button>
        {menu}
      </section>
    );
  };

  const empty = folders !== null && folders.length === 0;

  return (
    <div className="page page--home">
      <Header />
      <main className="home-main">
        <div className="home-col">
          <div className="home-title">
            <div>
              <h1>동기화 폴더</h1>
              <p>
                {folders === null ? '불러오는 중' : empty ? '아직 등록된 폴더가 없습니다' : `이 계정에 등록된 폴더 ${folders.length}개`}
              </p>
            </div>
            {!empty && folders !== null && (
              <button type="button" className="btn btn--primary btn--lg" onClick={handleAddFolder}>
                <Icon name="plus" size={18} sw={2.5} />
                폴더 추가
              </button>
            )}
          </div>

          {empty ? (
            <div className="home-empty">
              <div className="home-empty__icon"><Icon name="folderPlus" size={38} /></div>
              <div className="home-empty__text">
                <h2>백업할 폴더를 골라 주세요</h2>
                <p>고른 폴더를 그 자리에서 그대로 동기화합니다. 파일을 다른 곳으로 복사하지 않습니다. 다른 기기에서 이미 등록한 폴더는 잠시 뒤 자동으로 나타납니다.</p>
              </div>
              <button type="button" className="btn btn--primary btn--lg" style={{ padding: '0 24px' }} onClick={handleAddFolder}>
                <Icon name="plus" size={18} sw={2.5} />
                폴더 추가
              </button>
            </div>
          ) : (
            <div className="folder-list">{(folders || []).map(renderFolder)}</div>
          )}
        </div>

        <aside className="home-side">
          <section className="side-card">
            <h2>이 기기</h2>
            <dl className="device-list">
              <dt>기기 이름</dt><dd className="strong">{os.hostname()}</dd>
              <dt>계정</dt><dd className="strong">{username}</dd>
              <dt>서버</dt><dd>{API_BASE}</dd>
              <dt>확인 주기</dt><dd>{formatInterval(config.pollIntervalMs)}</dd>
              <dt>마지막 확인</dt><dd>{formatAgo(status.lastPollAt)}</dd>
            </dl>
            <button type="button" className="btn btn--strong btn--lg" onClick={() => ipcRenderer.send('sync:poll-now')}>
              <Icon name="sync" size={18} sw={2.5} />
              지금 동기화
            </button>
          </section>

          <section className="side-card" style={{ gap: 12 }}>
            <h2>이렇게 동작합니다</h2>
            <ul className="how-list">
              {HOW_IT_WORKS.map((text) => (
                <li key={text}>
                  <Icon name="check" size={18} color="#2459D6" sw={2.5} />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </main>
    </div>
  );
}
