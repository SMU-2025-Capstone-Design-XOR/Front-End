// src/pages/Login.jsx
import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { API_BASE, getUserIdFromToken } from '../apiService';
import Icon from '../components/Icon';

const { ipcRenderer } = window.require('electron');

const Login = () => {
  const navigate = useNavigate();
  const { state } = useLocation();
  // 회원가입 직후에는 방금 만든 아이디를, 아니면 기억해 둔 아이디를 채워 둔다
  const savedUsername = localStorage.getItem('rememberedUsername') || '';

  const [username, setUsername] = useState(state?.username || savedUsername);
  const [password, setPassword] = useState('');
  const [rememberId, setRememberId] = useState(!!savedUsername);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError('아이디와 비밀번호를 입력해 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let response;
      try {
        response = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
      } catch (networkError) {
        console.error('로그인 요청 실패:', networkError);
        setError('서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인해 주세요.');
        return;
      }
      if (!response.ok) {
        // 서버는 없는 아이디와 틀린 비밀번호를 모두 400으로 답한다
        setError(response.status >= 500
          ? '서버에서 오류가 났습니다. 잠시 뒤 다시 시도해 주세요.'
          : '아이디 또는 비밀번호가 맞지 않습니다.');
        return;
      }
      const data = await response.json();
      if (!data.token) {
        setError('서버 응답에 로그인 정보가 없습니다.');
        return;
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('currentUser', username);
      localStorage.setItem('xorUser', username);
      if (rememberId) localStorage.setItem('rememberedUsername', username);
      else localStorage.removeItem('rememberedUsername');

      // main 프로세스의 동기화 엔진 시작 (폴더별 전체 점검 → 변경 목록 → 폴링).
      // 같은 사용자가 다시 로그인한 경우에는 토큰만 바꿔 멈춰 있던 큐를 이어 간다.
      await ipcRenderer.invoke('sync:start', {
        token: data.token,
        userId: getUserIdFromToken(),
        username,
      });
      navigate('/home');
    } catch (err) {
      console.error('로그인 에러:', err);
      setError('로그인하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth__brand">
        <Icon name="logo" size={34} color="#2459D6" />
        XOR
      </div>
      <p className="auth__tagline">바뀐 부분만 저장하는 파일 백업·버전 관리·동기화</p>

      <form className="auth__card" onSubmit={handleSubmit} noValidate>
        <h1>로그인</h1>

        {error && (
          <div role="alert" className="alert">
            <Icon name="error" size={16} sw={2.5} />
            {error}
          </div>
        )}
        {!error && state?.expired && (
          <div role="status" className="alert alert--info">
            <Icon name="lock" size={16} sw={2.5} />
            로그인이 만료되었습니다. 다시 로그인하면 동기화가 이어집니다.
          </div>
        )}

        <div className="field">
          <label htmlFor="login-id">아이디</label>
          <input
            id="login-id" type="text" autoComplete="username" autoFocus={!username}
            value={username} onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="login-pw">비밀번호</label>
          <input
            id="login-pw" type="password" autoComplete="current-password" autoFocus={!!username}
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={rememberId} onChange={() => setRememberId((v) => !v)} />
          아이디 기억하기
        </label>
        <button type="submit" className="btn btn--primary auth__submit" disabled={busy}>로그인</button>
        <p className="auth__foot">
          계정이 없으신가요? <a role="link" tabIndex={0} onClick={() => navigate('/register')} onKeyDown={(e) => { if (e.key === 'Enter') navigate('/register'); }}>회원가입</a>
        </p>
      </form>

      <p className="auth__note">서버 {API_BASE}</p>
    </div>
  );
};

export default Login;
