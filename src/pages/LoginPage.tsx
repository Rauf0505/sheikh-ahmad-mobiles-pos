import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/utils';
import logoUrl from '../assets/logo.png';

export function LoginPage() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef('');

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const submitPin = async (value: string) => {
    setLoading(true);
    pinRef.current = '';
    try {
      const result = await login(value);
      if (result.success) {
        navigate('/', { replace: true });
      } else {
        setError(result.error || 'Invalid PIN');
        setTimeout(() => {
          setPin('');
          pinRef.current = '';
        }, 800);
      }
    } catch (err: any) {
      setError(err?.message || 'Login failed');
      setTimeout(() => {
        setPin('');
        pinRef.current = '';
      }, 800);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = useCallback(
    (digit: string) => {
      if (loading) return;
      setError('');
      const next = pinRef.current + digit;
      if (next.length > 6) return;
      pinRef.current = next;
      setPin(next);
      if (next.length === 6) {
        submitPin(next);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading]
  );

  const handleDelete = useCallback(() => {
    if (loading) return;
    setError('');
    const next = pinRef.current.slice(0, -1);
    pinRef.current = next;
    setPin(next);
  }, [loading]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (loading) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleDelete();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [loading, handleKeyPress, handleDelete]);

  const numpadKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  return (
    <div ref={containerRef} tabIndex={-1} className="h-screen w-full flex items-center justify-center bg-surface outline-none">
      <div className="flex flex-col items-center gap-8 w-full max-w-sm px-6">
        <div className="flex flex-col items-center gap-2">
          <img
            src={logoUrl}
            alt="Sheikh Ahmad Mobiles"
            className="w-20 h-20 object-contain"
            draggable={false}
          />
          <h1 className="text-[28px] leading-[36px] font-bold text-on-surface">
            Sheikh Ahmad Mobiles
          </h1>
          <p className="text-[14px] text-on-surface-variant font-medium">
            Terminal 01
          </p>
        </div>

        <div className="flex flex-col items-center gap-4">
          <div className="flex gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  'w-12 h-12 rounded-full border-2 flex items-center justify-center transition-all duration-200',
                  i < pin.length
                    ? 'bg-primary border-primary scale-110'
                    : 'border-outline-variant bg-surface',
                  error && 'border-error bg-error-container/30'
                )}
              >
                {i < pin.length && (
                  <div className="w-4 h-4 rounded-full bg-on-primary" />
                )}
              </div>
            ))}
          </div>

          {error && (
            <p className="text-[14px] text-error font-medium animate-pulse">
              {error}
            </p>
          )}

          {loading && (
            <span className="material-symbols-outlined animate-spin text-primary text-[24px]">
              progress_activity
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 w-full">
          {numpadKeys.map((key) => {
            if (key === '') {
              return <div key="empty" />;
            }
            if (key === 'del') {
              return (
                <button
                  key="del"
                  onClick={handleDelete}
                  disabled={loading}
                  className="h-16 rounded-xl bg-surface-container hover:bg-surface-container-high active:scale-95 transition-all flex items-center justify-center disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-on-surface-variant text-[28px]">
                    backspace
                  </span>
                </button>
              );
            }
            return (
              <button
                key={key}
                onClick={() => handleKeyPress(key)}
                disabled={loading || pinRef.current.length >= 6}
                className={cn(
                  'h-16 rounded-xl text-[24px] font-semibold transition-all active:scale-95',
                  'bg-surface-container-low hover:bg-surface-container',
                  'text-on-surface disabled:opacity-50',
                  'flex items-center justify-center'
                )}
              >
                {key}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
