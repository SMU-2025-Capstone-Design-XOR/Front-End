// src/pages/Register.jsx

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../css/register.css';
import { API_BASE } from '../apiService';

// Figma‑to‑React 컴포넌트
import TextField from '../components/TextField';
import Button from '../components/Button';

const Register = () => {
  const [username, setUsername] = useState(''); // 사용자명
  const [password, setPassword] = useState(''); // 비밀번호
  const [email, setEmail] = useState('');       // 이메일
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_BASE}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email })
      });
      if (!response.ok) throw new Error('회원가입 실패');
      alert('회원가입 성공!');
      navigate('/'); // 로그인 페이지로 이동
    } catch (error) {
      alert('회원가입 실패. 다시 시도하세요.');
    }
  };

  return (
    <div className="create-an-account">
      <div className="frame-2">
        <div className="text-wrapper">Sign up</div>
        <form onSubmit={handleRegister}>
          {/* 사용자명 입력 */}
          <TextField
            id="username"
            label="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
          />
          {/* 비밀번호 입력 */}
          <TextField
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          {/* 이메일 입력 */}
          <TextField
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />

          {/* 회원가입 버튼 */}
          <Button
            type="submit"
            text="Sign up"
            className="button-instance design-component-instance-node"
          />

          {/* 뒤로가기 버튼 (로그인 화면으로) */}
          <Button
            text="Back"
            onClick={() => navigate('/')}
            className="button-instance button-3"
          />
        </form>
      </div>
    </div>
  );
};

export default Register;
