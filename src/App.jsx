// // src/App.jsx
// // use React Router
import React from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import Home from './pages/Home';
import FolderPage from './pages/FolderPage';
import VersionManager from './pages/VersionManager';
import SyncManager from './SyncManager';

 const App = () => {
   console.log('App loaded');
   return (
    <>
      <Router>
         <Routes>
           <Route path="" element={<Login />} />
           <Route path="/register" element={<Register />} />
           <Route path="/home" element={
            <>
              <SyncManager />
              <Home />
            </>
            } />
           <Route path="/folder/:id" element={
            <>
              <SyncManager/>
              <FolderPage />
            </>
            } />
            <Route path="/version" element={<VersionManager />} />
         </Routes>
      </Router>
    </>
   );
 };

 export default App;