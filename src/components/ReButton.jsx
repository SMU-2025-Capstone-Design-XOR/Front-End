// src/components/ReButton.jsx
import React from "react";
import "../css/version.css"; // .vertitle, .button-instance, .design-component-instance-node 등을 사용하기 때문에 동일 CSS를 import합니다.

export const ReButton = ({ className, divclassName, frameClassName, text, onClick }) => {
  return (
    <div className={divclassName}>
      <button className={`${className} ${frameClassName}`} onClick={onClick}>
        <div className={divclassName}>{/* 폰트 스타일용 wrapper */}
          <span className="design-component-instance-node">{text}</span>
        </div>
      </button>
    </div>
  );
};
