// src/index.js
// ✅ React 진입점 (렌더링 시작 파일)
// 이 파일은 Webpack의 entry point로 설정되어 있으며,
// index.html의 <div id="root">에 React 앱을 렌더링합니다.

import React from 'react';
import { createRoot } from 'react-dom/client'; // React 18+ 방식 (Concurrent Mode 지원)
import App from './App'; // App.jsx에서 전체 라우팅 구조 정의
import './css/login.css'; // 전역 스타일 import

// index.html에서 <div id="root"> 가져오기
const container = document.getElementById('root');

// React 18 방식: createRoot()로 루트 만들기
const root = createRoot(container);

// App 컴포넌트를 root DOM에 렌더링
root.render(<App />);
