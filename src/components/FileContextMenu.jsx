import React from 'react';
import PropTypes from 'prop-types';
import shareSvg      from '../assets/Context_Menu/file-share.svg';
import versionSvg    from '../assets/Context_Menu/file-version.svg';
import infoSvg       from '../assets/Context_Menu/file-info.svg';
import downloadSvg   from '../assets/Context_Menu/file-download.svg';
import deleteSvg     from '../assets/Context_Menu/file-delete.svg';
import '../css/file-context.css';

const FileContextMenu = ({ x, y, visible, onClose, onShare, onVersion, onInfo, onDownload, onDelete }) => {
  if (!visible) return null;

  return (
    <div
      className="file-context-menu"
      style={{ top: y, left: x }}
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
