// src/components/VersionItem.jsx
import React from "react";

/**
 * props:
 *  - label: 버전 레이블 (예: "Version 1")
 *  - onRestore: 복원 버튼 클릭 시 호출될 함수
 *  - top: CSS top 위치 (픽셀 단위) → <div style={{ top: `${top}px` }}>
 */
export const VersionItem = ({ label, onRestore, top }) => {
  return (
    <div className="versionmap" style={{ top: `${top}px` }}>
      <div className="div">
        <div className="text-wrapper">{label}</div>
      </div>
      <div className="restore" onClick={onRestore}>
        <div className="label-text">Restore</div>
      </div>
    </div>
  );
};
