import { useState } from 'react';
import { cn } from '../../lib/utils';

interface NumpadProps {
  length?: number;
  onSubmit: (pin: string) => void;
  error?: string;
  loading?: boolean;
}

export function Numpad({
  length = 4,
  onSubmit,
  error,
  loading = false,
}: NumpadProps) {
  const [pin, setPin] = useState('');

  const handleDigit = (digit: string) => {
    if (pin.length < length) {
      const next = pin + digit;
      setPin(next);
      if (next.length === length) {
        onSubmit(next);
      }
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setPin('');
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="flex flex-col items-center gap-6">
      {/* PIN display */}
      <div className="flex items-center gap-3">
        {Array.from({ length }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'w-4 h-4 rounded-full transition-colors duration-150',
              i < pin.length
                ? 'bg-primary'
                : 'bg-outline-variant'
            )}
          />
        ))}
      </div>

      {/* Number grid */}
      <div className="grid grid-cols-3 gap-3">
        {digits.map((digit) => (
          <button
            key={digit}
            onClick={() => handleDigit(digit)}
            disabled={loading || pin.length >= length}
            className={cn(
              'w-16 h-16 rounded-full flex items-center justify-center',
              'bg-surface-container hover:bg-primary-container',
              'text-title-lg font-medium text-on-surface',
              'transition-colors duration-150',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'min-w-[44px] min-h-[44px]'
            )}
          >
            {digit}
          </button>
        ))}

        {/* Backspace */}
        <button
          onClick={handleBackspace}
          disabled={loading || pin.length === 0}
          className={cn(
            'w-16 h-16 rounded-full flex items-center justify-center',
            'bg-surface-container hover:bg-primary-container',
            'text-on-surface transition-colors duration-150',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'min-w-[44px] min-h-[44px]'
          )}
        >
          <span className="material-symbols-outlined text-[24px]">
            backspace
          </span>
        </button>

        {/* 0 */}
        <button
          onClick={() => handleDigit('0')}
          disabled={loading || pin.length >= length}
          className={cn(
            'w-16 h-16 rounded-full flex items-center justify-center',
            'bg-surface-container hover:bg-primary-container',
            'text-title-lg font-medium text-on-surface',
            'transition-colors duration-150',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'min-w-[44px] min-h-[44px]'
          )}
        >
          0
        </button>

        {/* Enter/Check */}
        <button
          onClick={handleClear}
          disabled={loading || pin.length === 0}
          className={cn(
            'w-16 h-16 rounded-full flex items-center justify-center',
            'bg-primary text-on-primary',
            'transition-colors duration-150',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'min-w-[44px] min-h-[44px]'
          )}
        >
          {loading ? (
            <span className="material-symbols-outlined animate-spin text-[24px]">
              progress_activity
            </span>
          ) : (
            <span className="material-symbols-outlined text-[24px]">
              check
            </span>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <span className="text-[14px] text-error text-center">{error}</span>
      )}
    </div>
  );
}
