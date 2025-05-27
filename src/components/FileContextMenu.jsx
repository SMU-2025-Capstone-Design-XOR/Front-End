import React, { useRef, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import shareSvg      from '../assets/Context_Menu/fs.svg';
import versionSvg    from '../assets/Context_Menu/vs.svg';
import infoSvg       from '../assets/Context_Menu/fi.svg';
import downloadSvg   from '../assets/Context_Menu/fd.svg';
import deleteSvg     from '../assets/Context_Menu/fde.svg';

import '../css/folder_context.css';
import '../css/file-context.css';

// onShare은 일단 나중에
const FileContextMenu = ({ x, y, visible, onClose, onShare, onVersion, onInfo, onDownload, onDelete }) => {
  
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
      className="file-context-menu"
      // style={{ top: y, left: x }}
      style={{ top: adjustedY, left: x }}
      onContextMenu={e => e.preventDefault()}
      onMouseLeave={onClose}
    >
      <div className="component" onClick={() => { onShare(); onClose(); }}>
        <img className="icon" src={shareSvg} alt="파일 공유" />
        <span className="label">파일 공유</span>
      </div>
      <div className="component" onClick={() => { onVersion(); onClose(); }}>
        <img className="icon" src={versionSvg} alt="버전 관리" />
        <span className="label">버전 관리</span>
      </div>
      <div className="component" onClick={() => { onInfo(); onClose(); }}>
        <img className="icon" src={infoSvg} alt="정보 가져오기" />
        <span className="label">정보 가져오기</span>
      </div>
      <div className="component" onClick={() => { onDownload(); onClose(); }}>
        <img className="icon" src={downloadSvg} alt="파일 다운로드" />
        <span className="label">파일 다운로드</span>
      </div>
      <div className="component" onClick={() => { onDelete(); onClose(); }}>
        <img className="icon" src={deleteSvg} alt="파일 삭제" />
        <span className="label">파일 삭제</span>
      </div>
    </div>
  );
};

FileContextMenu.propTypes = {
  x:         PropTypes.number.isRequired,
  y:         PropTypes.number.isRequired,
  visible:   PropTypes.bool.isRequired,
  onClose:   PropTypes.func.isRequired,
  onShare:   PropTypes.func.isRequired,
  onVersion: PropTypes.func.isRequired,
  onInfo:    PropTypes.func.isRequired,
  onDownload:PropTypes.func.isRequired,
  onDelete:  PropTypes.func.isRequired,
};

export default FileContextMenu;
