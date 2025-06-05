// // src/App.jsx
// ✅ React 앱의 "라우팅 구조"를 정의하는 컴포넌트입니다.
// 각 페이지별로 URL 경로를 지정하고 어떤 컴포넌트를 렌더링할지 설정합니다.
import React from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';

// 각 페이지 컴포넌트 import
import Login from './pages/Login'; // 로그인 페이지
import Register from './pages/Register'; // 회원가입 페이지
import Home from './pages/Home'; // 홈 화면 페이지
import FolderPage from './pages/FolderPage'; // 홈 화면 내에서 폴더 진입 시 페이지
import VersionManager from './pages/VersionManager'; // 폴더 내 파일의 버전관리목록 페이지
import SyncManager from './SyncManager'; // 백그라운드 동기화 기능 컴포넌트

 const App = () => {
  console.log('App이 정상적으로 로드되었습니다.'); // 디버깅용 콘솔 로그
   
  return (
    <>
      {/* Router로 페이지 이동 설정: Electron에서는 HashRouter 권장 */}
      <Router>
         <Routes>
            {/* 기본 경로: 로그인 페이지 */}
            <Route path="" element={<Login />} />
            {/* 회원가입 페이지 */}
            <Route path="/register" element={<Register />} />
            {/* 홈 페이지 (파일 목록 + 백그라운드 동기화 기능) */}
            <Route path="/home" element={
              <>
                <SyncManager />
                <Home />
              </>
            } />
            {/* 특정 폴더 열람 페이지: URL에서 폴더 id 추출 */}
            <Route path="/folder/:id" element={
              <>
                <SyncManager/>
                <FolderPage />
              </>
            } />
            {/* 버전 관리 페이지 */}
              <Route path="/version" element={<VersionManager />} />
          </Routes>
      </Router>
    </>
   );
 };

 export default App;