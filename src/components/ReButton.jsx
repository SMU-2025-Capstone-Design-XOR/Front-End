// src/components/ReButton.jsx
import React from "react";
import "../css/version.css"; // 버전 관련 전체 스타일을 import

/**
 * props:
 *  - className: 버튼의 배경/크기/위치 등을 조정할 클래스 (예: "vertitle")
 *  - frameClassName: 버튼 내부 텍스트 위치(예: "button-instance")
 *  - text: 버튼 위에 표시할 문자열
 *  - onClick: 클릭 이벤트 핸들러
 */
export const ReButton = ({ className, frameClassName, text, onClick }) => {
  return (
    <button className={`${className} ${frameClassName}`} onClick={onClick}>
      <span className="design-component-instance-node">{text}</span>
    </button>
  );
};
