// src/components/Header.jsx
// 머리줄: XOR(홈으로), 동기화 상태, 사용자 메뉴(로그아웃)
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import os from 'os';
import Icon from './Icon';
import MenuButton from './Menu';
import { useSyncStatus, clearConflicts, revealConflictCopy } from '../syncStatus';
import { formatAgo } from '../format';

const { ipcRenderer } = window.require('electron');

/** 엔진을 멈추고 로그인 화면으로 간다. "아이디 기억하기"는 남긴다. */
export function logout(navigate) {
  ipcRenderer.invoke('sync:stop');
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
  localStorage.removeItem('xorUser');
  localStorage.removeItem('userDir');
  navigate('/');
}

/** 엔진 상태 다섯 가지(syncing·idle·error·auth-required·conflict)를 머리줄에 보여 준다. */
function SyncPill() {
  const navigate = useNavigate();
  const { status, conflicts } = useSyncStatus();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 10000); // "1분 전" 같은 글자를 갱신한다
    return () => clearInterval(t);
  }, []);

  if (status.state === 'auth-required') {
    // 로그인 화면으로 보낸다. 엔진은 멈춘 채 두고, 다시 로그인하면 토큰만 바꿔 이어 간다.
    return (
      <button type="button" className="pill pill--danger" onClick={() => navigate('/', { state: { expired: true } })}>
        <Icon name="lock" size={16} sw={2.5} />다시 로그인 필요
      </button>
    );
  }
  if (status.state === 'error' && status.retrying) {
    return (
      <button type="button" className="pill pill--danger" title={status.message || ''} onClick={() => ipcRenderer.send('sync:poll-now')}>
        <Icon name="error" size={16} sw={2.5} />서버에 연결할 수 없음 · 다시 시도 중
      </button>
    );
  }
  if (status.state === 'error') {
    return (
      <button type="button" className="pill pill--danger" title={status.message || ''} onClick={() => ipcRenderer.send('sync:poll-now')}>
        <Icon name="error" size={16} sw={2.5} />동기화 오류 · 다시 시도
      </button>
    );
  }
  if (conflicts.length > 0) {
    const last = conflicts[conflicts.length - 1];
    return (
      <button type="button" className="pill pill--warn" onClick={() => { revealConflictCopy(last); clearConflicts(); }}>
        <Icon name="warn" size={16} sw={2.5} />충돌 사본 {conflicts.length}개 · 보기
      </button>
    );
  }
  if (status.state === 'syncing') {
    return (
      <div className="pill pill--accent">
        <Icon name="sync" size={16} sw={2.5} />
        {status.pending > 0 ? `동기화 중 · ${status.pending}개 남음` : '동기화 중'}
      </div>
    );
  }
  if (status.state === 'idle') {
    return (
      <div className="pill pill--ok">
        <Icon name="check" size={16} sw={2.5} />
        모두 동기화됨{status.lastPollAt ? ` · ${formatAgo(status.lastPollAt)}` : ''}
      </div>
    );
  }
  return null; // 엔진이 돌지 않는다 (로그인 전)
}

export default function Header() {
  const navigate = useNavigate();
  const username = localStorage.getItem('currentUser') || '';

  return (
    <header className="app-header">
      <button type="button" className="brand" onClick={() => navigate('/home')}>
        <Icon name="logo" size={24} color="#2459D6" />
        XOR
      </button>
      <div className="spacer" />
      <SyncPill />
      <MenuButton
        label="사용자 메뉴" className="btn btn--user"
        head={`${username} · ${os.hostname()}`}
        items={[{ icon: 'logout', label: '로그아웃', onClick: () => logout(navigate) }]}
      >
        <Icon name="user" size={18} />
        {username}
        <Icon name="chevron" size={14} sw={2.5} />
      </MenuButton>
    </header>
  );
}
