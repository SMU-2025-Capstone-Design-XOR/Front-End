// src/pages/Register.jsx

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../css/register.css';

// Figma‑to‑React 컴포넌트
import TextField from '../components/TextField';
import Button from '../components/Button';

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
    <div className="create-an-account">
      <div className="frame-2">
        <div className="text-wrapper">Sign up</div>
        <form onSubmit={handleRegister}>
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
          <TextField
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />

          {/* Sign up */}
          <Button
            type="submit"
            text="Sign up"
            className="button-instance design-component-instance-node"
          />

          {/* Back */}
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
