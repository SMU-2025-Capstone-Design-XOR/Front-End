// src/components/Dialog.jsx
// 확인 창·정보 창. confirm()과 정보 alert() 대신 쓴다 (docs/design-ui/States 시안).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/** 화면 가운데에 뜨는 창의 틀. 바깥을 누르거나 Esc를 누르면 onClose. */
export function Modal({ label, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    // 창 안의 첫 입력칸(없으면 기본 버튼)에 초점을 둔다
    const el = ref.current?.querySelector('[data-autofocus]') || ref.current?.querySelector('textarea, input, button');
    el?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} className="dialog">
        {children}
      </div>
    </div>
  );
}

const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const [current, setCurrent] = useState(null); // { type: 'confirm' | 'info', ...옵션, resolve }

  const close = useCallback((result) => {
    setCurrent((dlg) => {
      if (dlg) dlg.resolve(result);
      return null;
    });
  }, []);

  const api = useMemo(() => ({
    /**
     * 확인 창. 확인을 누르면 true, 취소·Esc·바깥 클릭이면 false로 끝나는 Promise.
     * @param {{ title: string, message?: string, confirmLabel?: string, danger?: boolean }} opts
     */
    confirm: (opts) => new Promise((resolve) => setCurrent({ type: 'confirm', ...opts, resolve })),
    /**
     * 정보 창.
     * @param {{ title: string, rows: Array<[string, string]> }} opts
     */
    info: (opts) => new Promise((resolve) => setCurrent({ type: 'info', ...opts, resolve })),
  }), []);

  return (
    <DialogContext.Provider value={api}>
      {children}
      {current?.type === 'confirm' && (
        <Modal label={current.title} onClose={() => close(false)}>
          <h3>{current.title}</h3>
          {current.message && <p className="dialog__msg">{current.message}</p>}
          <div className="dialog__actions">
            <button type="button" className="btn" data-autofocus={current.danger ? '' : undefined} onClick={() => close(false)}>취소</button>
            <button
              type="button" className={`btn ${current.danger ? 'btn--danger' : 'btn--primary'}`}
              data-autofocus={current.danger ? undefined : ''} onClick={() => close(true)}
            >
              {current.confirmLabel || '확인'}
            </button>
          </div>
        </Modal>
      )}
      {current?.type === 'info' && (
        <Modal label={current.title} onClose={() => close(true)}>
          <h3>{current.title}</h3>
          <dl className="info-list">
            {current.rows.map(([k, v]) => (
              <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>
            ))}
          </dl>
          <div className="dialog__actions">
            <button type="button" className="btn" data-autofocus="" onClick={() => close(true)}>닫기</button>
          </div>
        </Modal>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  return useContext(DialogContext);
}
