// src/components/Toast.jsx
// 화면 오른쪽 아래 알림. alert() 대신 쓴다 (docs/design-ui/States 시안).
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import Icon from './Icon';

const ToastContext = createContext(null);

const KINDS = {
  success: { icon: 'check', color: '#17603C', sw: 2.5, role: 'status', ms: 6000 },
  warn: { icon: 'warn', color: '#8A4B08', sw: 2, role: 'status', ms: 15000 },
  error: { icon: 'error', color: '#A8261D', sw: 2.5, role: 'alert', ms: 9000 },
  info: { icon: 'info', color: '#1D49B5', sw: 2, role: 'status', ms: 6000 },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  /**
   * @param {'success'|'warn'|'error'|'info'} kind
   * @param {string} title 굵은 한 줄
   * @param {string} [message] 설명
   * @param {{ icon?: string, action?: { label: string, onClick: Function }, sticky?: boolean }} [opts]
   */
  const show = useCallback((kind, title, message, opts = {}) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { id, kind, title, message, ...opts }]);
    if (!opts.sticky) setTimeout(() => dismiss(id), KINDS[kind].ms);
    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    show,
    dismiss,
    success: (title, message, opts) => show('success', title, message, opts),
    warn: (title, message, opts) => show('warn', title, message, opts),
    error: (title, message, opts) => show('error', title, message, opts),
    info: (title, message, opts) => show('info', title, message, opts),
  }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts">
        {toasts.map((t) => {
          const kind = KINDS[t.kind];
          return (
            <div key={t.id} role={kind.role} className={`toast toast--${t.kind}`}>
              <Icon name={t.icon || kind.icon} size={20} color={kind.color} sw={kind.sw} style={{ flex: 'none', marginTop: 1 }} />
              <div className="toast__body">
                <div className="toast__title">{t.title}</div>
                {t.message && <p className="toast__msg">{t.message}</p>}
                {t.action && (
                  <button
                    type="button" className="btn btn--sm toast__action"
                    onClick={() => { t.action.onClick(); dismiss(t.id); }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button type="button" className="icon-btn icon-btn--plain" aria-label="알림 닫기" onClick={() => dismiss(t.id)}>
                <Icon name="close" size={16} sw={2.5} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
