// src/App.jsx
// React 앱의 라우팅 구조. 알림(토스트)과 확인 창은 모든 화면이 함께 쓴다.
import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import path from 'path';

import Login from './pages/Login';
import Register from './pages/Register';
import Home from './pages/Home';
import FolderPage from './pages/FolderPage';
import VersionManager from './pages/VersionManager';
import { ToastProvider, useToast } from './components/Toast';
import { DialogProvider } from './components/Dialog';
import { onConflict, revealConflictCopy } from './syncStatus';
import { parseConflictCopy, josa } from './format';
// 동기화는 main 프로세스의 엔진(sync/)이 맡는다. 렌더러에는 동기화 컴포넌트를 두지 않는다.

/** 엔진이 충돌을 알리면 사본 위치를 볼 수 있는 알림을 띄운다 (버전 기록 창에서는 띄우지 않는다). */
function ConflictNotices() {
  const toast = useToast();
  const { pathname } = useLocation();
  const inVersionWindow = pathname.startsWith('/version');

  useEffect(() => {
    if (inVersionWindow) return undefined;
    return onConflict((conflict) => {
      const name = path.posix.basename(conflict.relativePath);
      // 사본 이름은 `이름_기기이름_시각.확장자`이므로 원래 이름을 알면 기기 이름을 꺼낼 수 있다
      const parsed = parseConflictCopy(path.posix.basename(conflict.copyPath));
      const device = parsed?.candidates.find((c) => c.original === name)?.device || '다른 기기';
      toast.warn(
        '다른 기기와 동시에 수정했습니다',
        `${name}${josa(name, '은', '는')} 이 PC의 내용으로 저장했고, ${device}의 내용은 사본으로 남겼습니다.`,
        { action: { label: '사본 위치 보기', onClick: () => revealConflictCopy(conflict) } },
      );
    });
  }, [toast, inVersionWindow]);

  return null;
}

const App = () => (
  <ToastProvider>
    <DialogProvider>
      {/* Electron에서는 HashRouter를 쓴다 */}
      <Router>
        <ConflictNotices />
        <Routes>
          <Route path="" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/home" element={<Home />} />
          <Route path="/folder/:id" element={<FolderPage />} />
          {/* 버전 기록 창 (별도 창으로 열린다) */}
          <Route path="/version" element={<VersionManager />} />
        </Routes>
      </Router>
    </DialogProvider>
  </ToastProvider>
);

export default App;
