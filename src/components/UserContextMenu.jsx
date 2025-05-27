// src/components/UserContextMenu.jsx
import React from "react";
import logOutIcon from "../assets/Context_Menu/log-out.svg";
import '../css/folder_context.css';

export const UserContextMenu = ({ x, y, onLogout, onClose }) => {
  
  // 메뉴 고정 너비와 같게
  const MENU_WIDTH = 300;
  // 화면 오른쪽 넘침 방지
  const adjustedX = (x + MENU_WIDTH > window.innerWidth)
    ? (x - MENU_WIDTH)
    : x;

  return (
    <div
      className="folder-context-menu"
      style={{ top: y, left: adjustedX }}
      onMouseLeave={onClose}
    >
      <div className="component" onClick={() => { onLogout(); onClose(); }}>
        <img className="icon" src={logOutIcon} alt="로그아웃" />
        <span className="label">로그아웃</span>
      </div>

      
    </div>
  );
};
