// src/components/Menu.jsx
// 버튼을 왼쪽 클릭하면 열리는 메뉴. 바깥을 누르거나 Esc를 누르면 닫힌다 (우클릭 메뉴를 대신한다).
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icon';

/**
 * @param {object} props
 *   label       메뉴의 이름 (aria-label)
 *   className   버튼의 class
 *   children    버튼 안에 넣을 내용
 *   head        메뉴 맨 위의 설명 줄 (선택)
 *   items       [{ icon, label, onClick, danger }] 또는 'sep'(구분선)
 */
export default function MenuButton({ label, className = 'icon-btn', children, head, items }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  // 버튼 바로 아래 오른쪽 끝에 맞춘다. 아래에 자리가 없으면 위로 연다.
  useLayoutEffect(() => {
    if (!open) return;
    const b = btnRef.current.getBoundingClientRect();
    const m = menuRef.current.getBoundingClientRect();
    let top = b.bottom + 6;
    if (top + m.height > window.innerHeight - 8) top = Math.max(8, b.top - 6 - m.height);
    const left = Math.min(Math.max(8, b.right - m.width), window.innerWidth - m.width - 8);
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { close(); btnRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    document.addEventListener('scroll', close, true); // 목록이 스크롤되면 위치가 어긋나므로 닫는다
    menuRef.current?.querySelector('button')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef} type="button" className={className}
        aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label={label} className="menu" style={pos}>
          {head && (<><div className="menu__head">{head}</div><div className="menu__sep" style={{ margin: 4 }} /></>)}
          {items.map((item, i) => (item === 'sep'
            ? <div key={i} className="menu__sep" />
            : (
              <button
                key={i} type="button" role="menuitem"
                className={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
                onClick={() => { setOpen(false); item.onClick(); }}
              >
                <Icon name={item.icon} size={16} />
                {item.label}
              </button>
            )))}
        </div>
      )}
    </>
  );
}
