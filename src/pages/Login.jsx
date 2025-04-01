// src/pages/Login.jsx

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles.css';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('백엔드 서버 api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (!response.ok) throw new Error('로그인 실패');
      const data = await response.json();
      // data.token 이 JWT라고 가정
      localStorage.setItem('token', data.token);
      alert('로그인 성공!');
      navigate('/home');
    } catch (error) {
      alert('로그인 실패. 다시 시도하세요.');
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>로그인</h1>
        <form onSubmit={handleSubmit}>
          <input type="text" placeholder="아이디" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <input type="password" placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="submit">로그인</button>
        </form>
        <button className="switch-btn" onClick={() => navigate('/register')}>회원가입</button>
      </div>
    </div>
  );
};

export default Login;

