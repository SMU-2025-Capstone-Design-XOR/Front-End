// src/components/SubFolderContextMenu.jsx
import React, { useRef, useState, useEffect } from 'react';
import PropTypes from 'prop-types';

import folderInfoSvg from '../assets/Context_Menu/folder-information.svg';
import deleteSvg     from '../assets/Context_Menu/folder-delete.svg';

import '../css/folder_context.css';

const SubFolderContextMenu = ({ x, y, visible, onInfo, onDelete, onClose }) => {
  
  const menuRef = useRef(null);
  const [adjustedY, setAdjustedY] = useState(y);

  // 메뉴가 보이는 시점에 높이를 계산해서, 아래로 넘치면 위로 보정
  useEffect(() => {
    if (!visible) return;

    const el = menuRef.current;
    if (!el) return;

    const menuHeight = el.offsetHeight;
    const viewportHeight = window.innerHeight;

    // 아래로 넘치면, 메뉴 높이만큼 위로 띄우도록
    if (y + menuHeight > viewportHeight) {
      setAdjustedY(y - menuHeight);
    } else {
      setAdjustedY(y);
    }
  }, [visible, x, y]);  
  
  
  if (!visible) return null;

  return (
    <div
      ref={menuRef}
      className="folder-context-menu"
      style={{ top: adjustedY, left: x }}
      // style={{ top: y, left: x }}
      onContextMenu={e => e.preventDefault()}
      onMouseLeave={onClose}
    >
    {/* 첫 번째 메뉴 */}
      <div className="component" onClick={() => {onInfo(); onClose();}}>
        <img className="icon" src={folderInfoSvg} alt="Folder information" />
        <span className="label">서브폴더 정보 가져오기</span>
      </div>
    
    {/* 두 번째 메뉴 */}
      <div className="component" onClick={() => {onDelete(); onClose();}}>
        <img className="icon" src={deleteSvg} alt="Sync delete" />
        <span className="label">서브폴더 삭제하기</span>
      </div>
    </div>
  );
};

SubFolderContextMenu.propTypes = {
  x:        PropTypes.number.isRequired,
  y:        PropTypes.number.isRequired,
  visible:  PropTypes.bool.isRequired,
  onInfo:   PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onClose:   PropTypes.func.isRequired,
};

export default SubFolderContextMenu;
