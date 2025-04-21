// // src/pages/Login.jsx
// import React, { useState, useEffect } from 'react';
// import { useNavigate } from 'react-router-dom';
// import '../css/auth.css';

// const Login = () => {
//   const navigate = useNavigate();

//   const savedUsername = localStorage.getItem('rememberedUsername') || '';
//   const savedAutoLogin = localStorage.getItem('autoLogin') === 'true';

//   const [username, setUsername] = useState(savedUsername);
//   const [password, setPassword] = useState('');
//   const [rememberId, setRememberId] = useState(!!savedUsername);
//   const [autoLogin, setAutoLogin] = useState(savedAutoLogin);

//   useEffect(() => {
//     const token = localStorage.getItem('token');
//     if (token && autoLogin) {
//       navigate('/home');
//     }
//   }, [autoLogin, navigate]);

//   const handleSubmit = async (e) => {
//     e.preventDefault();
//     try {
//       const response = await fetch('http://15.164.33.175:8080/auth/login', {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ username, password })
//       });
//       if (!response.ok) throw new Error('로그인 실패');
//       const data = await response.json();
//       if (data.token) {
//         localStorage.setItem('token', data.token);
//         localStorage.setItem('currentUser', username);

//         if (rememberId) {
//           localStorage.setItem('rememberedUsername', username);
//         } else {
//           localStorage.removeItem('rememberedUsername');
//         }

//         if (autoLogin) {
//           localStorage.setItem('autoLogin', 'true');
//         } else {
//           localStorage.removeItem('autoLogin');
//         }

//         alert('로그인 성공!');
//         navigate('/home');
//       } else {
//         throw new Error('토큰이 없습니다');
//       }
//     } catch (error) {
//       console.error('로그인 에러:', error);
//       alert('로그인 실패. 다시 시도하세요.');
//     }
//   };

//   return (
//     <div className="auth-container">
//       <div className="auth-box">
//         <h1>Login</h1>
//         <form onSubmit={handleSubmit}>
//           <input
//             type="text"
//             placeholder="Username"
//             value={username}
//             onChange={e => setUsername(e.target.value)}
//             required
//           />
//           <input
//             type="password"
//             placeholder="Password"
//             value={password}
//             onChange={e => setPassword(e.target.value)}
//             required
//           />

//           {/* 체크박스 컨테이너를 flex로 가로 배치 */}
//           <div style={{ display: 'flex', gap: '16px', margin: '8px 0' }}>
//             <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
//               <input
//                 type="checkbox"
//                 checked={rememberId}
//                 onChange={() => setRememberId(prev => !prev)}
//               />
//               Remember Id
//             </label>
//             <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
//               <input
//                 type="checkbox"
//                 checked={autoLogin}
//                 onChange={() => setAutoLogin(prev => !prev)}
//               />
//               Auto Login
//             </label>
//           </div>

//           <button type="submit">Login</button>
//         </form>
//         <button
//           className="switch-btn"
//           onClick={() => navigate('/register')}
//         >
//           Create an account
//         </button>
//       </div>
//     </div>
//   );
// };

// export default Login;

import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import '../css/auth.css';

export default function LoginPage() {
  const navigate = useNavigate();

  // Load saved settings
  const savedUsername = localStorage.getItem('rememberedUsername') || '';
  const savedAutoLogin = localStorage.getItem('autoLogin') === 'true';

  // Form state
  const [username, setUsername] = useState(savedUsername);
  const [password, setPassword] = useState('');
  const [rememberId, setRememberId] = useState(!!savedUsername);
  const [autoLogin, setAutoLogin] = useState(savedAutoLogin);

  // If token exists and auto-login enabled, redirect
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token && autoLogin) {
      navigate('/home');
    }
  }, [autoLogin, navigate]);

  const handleSubmit = async (e) => {
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
        // Remember ID
        if (rememberId) {
          localStorage.setItem('rememberedUsername', username);
        } else {
          localStorage.removeItem('rememberedUsername');
        }
        // Auto-login
        if (autoLogin) {
          localStorage.setItem('autoLogin', 'true');
        } else {
          localStorage.removeItem('autoLogin');
        }
        navigate('/home');
      } else {
        throw new Error('토큰이 없습니다');
      }
    } catch (error) {
      console.error('로그인 에러:', error);
      alert('로그인 실패. 다시 시도하세요.');
    }
  };

  // Checkbox options
  const checkboxOptions = [
    { id: 'remember', label: 'Remember Username', checked: rememberId, onChange: () => setRememberId(prev => !prev) },
    { id: 'autoLogin', label: 'Auto Login', checked: autoLogin, onChange: () => setAutoLogin(prev => !prev) }
  ];

  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <Card className="w-[685px] bg-[#f2f2f2] rounded-[20px] shadow-none border-none">
        <CardContent className="p-[60px]">
          <h1 className="text-[69px] text-[#111111c4] font-bold text-center mb-16 leading-6 font-['Commissioner-Bold']">
            Login
          </h1>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Username */}
            <div className="space-y-1">
              <Label htmlFor="username" className="font-['Poppins-Medium'] text-[#3c3c3c] text-[22px]">
                Username
              </Label>
              <Input
                id="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="h-14 rounded-xl border-[#666666ad]"
              />
            </div>
            {/* Password */}
            <div className="space-y-1">
              <Label htmlFor="password" className="font-['Poppins-Medium'] text-[#3c3c3c] text-[22px]">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="h-14 rounded-xl border-[#666666ad]"
              />
            </div>
            {/* Checkboxes */}
            <div className="flex space-x-10 py-2">
              {checkboxOptions.map(opt => (
                <div key={opt.id} className="flex items-center space-x-2">
                  <Checkbox id={opt.id} checked={opt.checked} onCheckedChange={opt.onChange} className="w-6 h-6" />
                  <Label htmlFor={opt.id} className="font-['Poppins-Medium'] text-[#333333] text-[17px]">
                    {opt.label}
                  </Label>
                </div>
              ))}
            </div>
            {/* Submit Buttons */}
            <Button type="submit" className="w-full h-[60px] bg-[#111111c4] hover:bg-[#111111] rounded-2xl font-['Poppins-SemiBold'] text-[34px]">
              Login
            </Button>
            <Button onClick={() => navigate('/register')} className="w-full h-[60px] bg-[#111111c4] hover:bg-[#111111] rounded-2xl font-['Poppins-SemiBold'] text-[34px]">
              Create an account
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
