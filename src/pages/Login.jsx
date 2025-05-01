// src/pages/Login.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '../css/login.css';

// Figma-to-React가 만들어준 컴포넌트 경로로 import
import TextField from '../components/TextField';
import Button from '../components/Button';

const Login = () => {
  const navigate = useNavigate();

  const savedUsername = localStorage.getItem('rememberedUsername') || '';

  const [username, setUsername] = useState(savedUsername);
  const [password, setPassword] = useState('');
  const [rememberId, setRememberId] = useState(!!savedUsername);

  const handleSubmit = async (e) => {
    // console.log('▶️ handleSubmit 호출:', { username, password });
    e.preventDefault();
    try {
      const response = await fetch('http://15.164.33.175:8080/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (!response.ok) throw new Error('로그인 실패');
      const data = await response.json();
      if (data.token) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('currentUser', username);

        if (rememberId) {
          localStorage.setItem('rememberedUsername', username);
        } else {
          localStorage.removeItem('rememberedUsername');
        }

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
          <TextField
            id="username"
            label="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
          />

          <TextField
            id="password"
            label="Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />

          {/* Figma 스타일 체크박스 */}
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

          {/* Figma 스타일 버튼 */}
          <Button
            type="submit"
            text="Login"
            className="button-instance button-4"
          />
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
