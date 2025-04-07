// src/index.js
// createRoot, React entry file

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './auth.css';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);
