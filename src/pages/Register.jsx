// src/pages/Register.jsx

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../auth.css';

const Register = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('http://15.164.33.175:8080/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email })
      });
      if (!response.ok) throw new Error('회원가입 실패');
      alert('회원가입 성공!');
      navigate('/');
    } catch (error) {
      alert('회원가입 실패. 다시 시도하세요.');
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-box">
        <h1>회원가입</h1>
        <form onSubmit={handleRegister}>
          <input type="text" placeholder="아이디" value={username} onChange={(e) => setUsername(e.target.value)} required />
          <input type="password" placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <input type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button type="submit">회원가입</button>
        </form>
        <button className="switch-btn" onClick={() => navigate('/')}>로그인 화면으로</button>
      </div>
    </div>
  );
};

export default Register;
