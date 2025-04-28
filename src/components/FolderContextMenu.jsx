// src/components/FolderContextMenu.jsx
import React from 'react';
import PropTypes from 'prop-types';

import folderInfoSvg from '../assets/Context_Menu/folder-information.svg';
import deleteSvg     from '../assets/Context_Menu/folder-delete.svg';

import '../css/folder_context.css';

const FolderContextMenu = ({ x, y, visible, onInfo, onDelete }) => {
  if (!visible) return null;

  return (
    <div
      className="folder-context-menu"
      style={{ top: y, left: x }}
      onContextMenu={e => e.preventDefault()}
    >
      {/* 첫 번째 메뉴 */}
      <div className="component" onClick={onInfo}>
        <img className="icon" src={folderInfoSvg} alt="Folder information" />
        <span className="label">파일 정보 가져오기</span>
      </div>

      {/* 두 번째 메뉴 */}
      <div className="component" onClick={onDelete}>
        <img className="icon" src={deleteSvg} alt="Sync delete" />
        <span className="label">싱크 폴더 삭제</span>
      </div>
    </div>
  );
};

FolderContextMenu.propTypes = {
  x:        PropTypes.number.isRequired,
  y:        PropTypes.number.isRequired,
  visible:  PropTypes.bool.isRequired,
  onInfo:   PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};

export default FolderContextMenu;
