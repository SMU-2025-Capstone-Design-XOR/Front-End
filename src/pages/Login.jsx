// src/pages/Login.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ipcRenderer } from 'electron'; // Electron의 main process와 통신
import '../css/login.css';
import { API_BASE, getUserIdFromToken } from '../apiService';

// Figma-to-React가 만들어준 컴포넌트 경로로 import
import TextField from '../components/TextField';
import Button from '../components/Button';

const Login = () => {
  const navigate = useNavigate();

  const savedUsername = localStorage.getItem('rememberedUsername') || '';

  const [username, setUsername] = useState(savedUsername); // 아이디 입력 상태
  const [password, setPassword] = useState('');             // 비밀번호 입력 상태
  const [rememberId, setRememberId] = useState(!!savedUsername); // 체크 여부 상태

  // 로그인 요청 처리
  const handleSubmit = async (e) => {

    e.preventDefault(); // 폼 기본 제출 동작 방지
    try {
      // 로그인 API 호출
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (!response.ok) throw new Error('로그인 실패');
      const data = await response.json();

      // 로그인 성공 시 토큰 저장
      if (data.token) {
        localStorage.setItem('token', data.token); // 인증 토큰 저장
        localStorage.setItem('currentUser', username); // 현재 사용자명 저장

        // remember me 체크 시 username 저장
        if (rememberId) {
          localStorage.setItem('rememberedUsername', username);
        } else {
          localStorage.removeItem('rememberedUsername');
        }


        // 사용자 폴더 생성 요청 후, 실제 경로를 받아와서 필요하면 저장
        const createdDir = await ipcRenderer.invoke('init-user-folder', username);
        // 계정 이름만 남겨도 되지만, 경로가 필요하다면 아래처럼 저장하세요
        localStorage.setItem('userDir', createdDir);
        localStorage.setItem('xorUser', username);     

        // main 프로세스의 동기화 엔진 시작 (폴더별 전체 점검 → 변경 목록 → 폴링)
        await ipcRenderer.invoke('sync:start', {
          token: data.token,
          userId: getUserIdFromToken(),
          username,
        });

        alert('로그인 성공!');
        navigate('/home');
      } else {
        throw new Error('토큰이 없습니다');
      }
    } catch (error) {
      console.error('로그인 에러:', error);
      alert('로그인 실패. 다시 시도하세요.');
    }
  };

  return (
    <div className="login-page">
      <div className="frame-2">
        <div className="text-wrapper">Login</div>

        <form onSubmit={handleSubmit}>
          {/* 아이디 입력 필드 */}
          <TextField
            id="username"
            label="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
          />
          {/* 비밀번호 입력 필드 */}
          <TextField
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />

          {/* Remember Username 체크박스 */}
          <div className="check-box-instance">
            <label className="check-box-1-line">
              <input
                type="checkbox"
                checked={rememberId}
                onChange={() => setRememberId(prev => !prev)}
              />
              <span className="check-box-2">Remember Username</span>
            </label>
          </div>

          {/* 로그인 버튼 */}
          <Button
            type="submit"
            text="Login"
            className="button-instance button-4"
          />
          {/* 회원가입 페이지로 이동 */}
          <Button
            text="Sign up"
            onClick={() => navigate('/register')}
            className="button-instance design-component-instance-node"
          />
        </form>
      </div>
    </div>
  );
}


export default Login;
