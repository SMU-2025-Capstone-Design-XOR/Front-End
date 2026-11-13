// src/components/Icon.jsx
// 시안(docs/design-ui)에서 쓰는 선 아이콘 모음. 모두 24×24 기준이다.
import React from 'react';

const FOLDER = 'M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z';
const SHEET = 'M6 3h8l4 4v14H6z';

// 이름 → 내부 도형. 문자열은 path의 d, 배열은 여러 도형이다.
const SHAPES = {
  logo: [['circle', { cx: 12, cy: 12, r: 9 }], 'M12 3v18M3 12h18'],
  sync: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  warn: ['M12 4l9 16H3z', 'M12 10v4M12 16.6v.1'],
  error: [['circle', { cx: 12, cy: 12, r: 9 }], 'M12 7.5v5.5M12 16.4v.1'],
  info: [['circle', { cx: 12, cy: 12, r: 9 }], 'M12 11v6M12 7.5v.1'],
  lock: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v9H5z',
  user: [['circle', { cx: 12, cy: 8, r: 4 }], 'M4 20c1.5-4 5-5 8-5s6.5 1 8 5'],
  chevron: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  folder: FOLDER,
  folderAlert: [FOLDER, 'M12 11v3.5M12 16.6v.1'],
  folderPlus: [FOLDER, 'M12 11v5M9.5 13.5h5'],
  fileText: [SHEET, 'M14 3v4h4M9 12h6M9 16h6'],
  fileDoc: [SHEET, 'M14 3v4h4M9 12l1.5 5 1.5-4 1.5 4L15 12'],
  fileSheet: [SHEET, 'M14 3v4h4M9 11h6v6H9zM9 14h6M12 11v6'],
  fileSlide: [SHEET, 'M14 3v4h4M9 11h6v4H9zM12 15v3'],
  fileImage: [SHEET, 'M14 3v4h4M8 18l3-4 2 2 1.5-2 1.5 4z'],
  filePlain: [SHEET, 'M14 3v4h4'],
  up: 'M12 19V5M6 11l6-6 6 6',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  logout: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h9',
  close: 'M6 6l12 12M18 6L6 18',
};

export default function Icon({ name, size = 18, color = 'currentColor', sw = 2, style }) {
  if (name === 'dots') {
    return (
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={color} style={style}>
        <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
      </svg>
    );
  }
  const shape = SHAPES[name];
  const parts = Array.isArray(shape) ? shape : [shape];
  return (
    <svg
      aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style}
    >
      {parts.map((p, i) => (typeof p === 'string'
        ? <path key={i} d={p} />
        : React.createElement(p[0], { key: i, ...p[1] })))}
    </svg>
  );
}

/** 파일 이름(확장자)에 맞는 아이콘 이름과 색 */
export function fileIconOf(name) {
  const ext = (/\.([^.]+)$/.exec(name || '')?.[1] || '').toLowerCase();
  if (['doc', 'docx', 'hwp', 'hwpx'].includes(ext)) return { name: 'fileDoc', color: '#2459D6' };
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { name: 'fileSheet', color: '#17603C' };
  if (['ppt', 'pptx'].includes(ext)) return { name: 'fileSlide', color: '#8A4B08' };
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) return { name: 'fileImage', color: '#3F4854' };
  if (['txt', 'md', 'json', 'xml', 'log', 'html', 'js', 'java', 'py', 'yml', 'yaml'].includes(ext)) return { name: 'fileText', color: '#3F4854' };
  return { name: 'filePlain', color: '#566070' };
}
