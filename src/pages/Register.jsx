// src/pages/Register.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '../apiService';
import Icon from '../components/Icon';

const Register = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  // 입력칸 아래에 보여 줄 오류 { username, password, email }와 폼 위에 보여 줄 오류
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleRegister = async (e) => {
    e.preventDefault();
    if (busy) return;

    const errors = {};
    if (!username.trim()) errors.username = '아이디를 입력해 주세요.';
    if (!password) errors.password = '비밀번호를 입력해 주세요.';
    if (!email.trim()) errors.email = '이메일을 입력해 주세요.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = '이메일 주소 형식이 맞지 않습니다.';
    setFieldErrors(errors);
    setFormError('');
    if (Object.keys(errors).length) return;

    setBusy(true);
    try {
      let response;
      try {
        response = await fetch(`${API_BASE}/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), password, email: email.trim() }),
        });
      } catch (networkError) {
        console.error('회원가입 요청 실패:', networkError);
        setFormError('서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인해 주세요.');
        return;
      }
      if (!response.ok) {
        // 서버의 400 문구: "이미 사용 중인 닉네임 입니다." / "이미 사용 중인 이메일 입니다."
        let message = '';
        try { message = (await response.json()).message || ''; } catch { /* 본문이 JSON이 아님 */ }
        if (message.includes('닉네임')) setFieldErrors({ username: '이미 쓰고 있는 아이디입니다.' });
        else if (message.includes('이메일')) setFieldErrors({ email: '이미 쓰고 있는 이메일입니다.' });
        else setFormError('가입하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
        return;
      }
      // 알림 창 없이 로그인 화면으로 가고 아이디를 채워 둔다
      navigate('/', { state: { username: username.trim() } });
    } finally {
      setBusy(false);
    }
  };

  const field = (name, label, type, value, setValue, autoComplete) => (
    <div className={`field${fieldErrors[name] ? ' field--error' : ''}`}>
      <label htmlFor={`reg-${name}`}>{label}</label>
      <input
        id={`reg-${name}`} type={type} autoComplete={autoComplete} value={value}
        aria-invalid={!!fieldErrors[name]}
        onChange={(e) => { setValue(e.target.value); setFieldErrors((prev) => ({ ...prev, [name]: undefined })); }}
      />
      {fieldErrors[name] && <p className="field__error">{fieldErrors[name]}</p>}
    </div>
  );

  return (
    <div className="auth">
      <div className="auth__brand">
        <Icon name="logo" size={34} color="#2459D6" />
        XOR
      </div>

      <form className="auth__card" onSubmit={handleRegister} noValidate>
        <h1>회원가입</h1>

        {formError && (
          <div role="alert" className="alert">
            <Icon name="error" size={16} sw={2.5} />
            {formError}
          </div>
        )}

        {field('username', '아이디', 'text', username, setUsername, 'username')}
        {field('password', '비밀번호', 'password', password, setPassword, 'new-password')}
        {field('email', '이메일', 'email', email, setEmail, 'email')}

        <button type="submit" className="btn btn--primary auth__submit" disabled={busy}>가입하기</button>
        <p className="auth__foot">
          이미 계정이 있으신가요? <a role="link" tabIndex={0} onClick={() => navigate('/')} onKeyDown={(e) => { if (e.key === 'Enter') navigate('/'); }}>로그인</a>
        </p>
      </form>
    </div>
  );
};

export default Register;
