// // src/App.jsx
// // use React Router
import React from 'react';
 import { HashRouter as Router, Routes, Route } from 'react-router-dom';
 import Login from './pages/Login';
 import Register from './pages/Register';
 import Home from './pages/Home';
 import FolderPage from './pages/FolderPage';
import SyncManager from './SyncManager';

 const App = () => {
   console.log('App loaded');
   return (
    <>
      {/* SyncManager는 라우트가 바뀌어도 계속 살아 있습니다 */}
      <SyncManager />
      <Router>
         <Routes>
           <Route path="" element={<Login />} />
           <Route path="/register" element={<Register />} />
           <Route path="/home" element={<Home />} />
           <Route path="/folder/:id" element={<FolderPage />} />
         </Routes>
      </Router>
    </>
   );
 };

 export default App;