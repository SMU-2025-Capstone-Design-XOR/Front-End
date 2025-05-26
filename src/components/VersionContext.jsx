import React, { useRef, useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import editSvg from '../assets/Context_Menu/ve.svg';

// import '../css/folder_context.css';
import '../css/file-context.css';

// onClose은 나중에
const VersionContext = ({ x, y, visible, onEdit }) => {
  
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
      style={{ top: adjustedY, left: x }}
      onContextMenu={e => e.preventDefault()}
    //   onMouseLeave={onClose}
    >
      <div className="component" onClick={() => { onEdit(); }}>
        <img className="icon" src={editSvg} alt="버전 정보 수정" />
        <span className="label">버전 정보 수정</span>
      </div>
    </div>
  );
};

VersionContext.propTypes = {
  x:         PropTypes.number.isRequired,
  y:         PropTypes.number.isRequired,
  visible:   PropTypes.bool.isRequired,
//   onClose:   PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
};

export default VersionContext;
