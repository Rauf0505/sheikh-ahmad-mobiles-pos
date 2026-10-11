import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  show: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  show: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message: string, type: ToastType = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => dismiss(id), 3500);
  }, [dismiss]);

  const success = useCallback((m: string) => show(m, 'success'), [show]);
  const error = useCallback((m: string) => show(m, 'error'), [show]);
  const info = useCallback((m: string) => show(m, 'info'), [show]);

  return (
    <ToastContext.Provider value={{ show, success, error, info }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] space-y-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={[
              'flex items-start justify-between gap-3 px-4 py-3 rounded-xl shadow-lg border animate-toast-in',
              t.type === 'success' && 'bg-success text-success dark:bg-surface border-outline-variant',
              t.type === 'error' && 'bg-error text-white border-error',
              t.type === 'info' && 'bg-surface border-outline-variant',
            ].filter(Boolean).join(' ')}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-[18px] shrink-0">
                {t.type === 'success' ? 'check_circle' : t.type === 'error' ? 'error' : 'info'}
              </span>
              <span className="text-[13px] font-medium leading-snug">{t.message}</span>
            </div>
            <button onClick={() => dismiss(t.id)} className="shrink-0 text-current opacity-60 hover:opacity-100">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
