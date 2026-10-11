import { cn } from '../../lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: string;
  prefix?: string;
}

export function Input({
  label,
  error,
  icon,
  prefix,
  className,
  id,
  ...props
}: InputProps) {
  const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="flex flex-col">
      {label && (
        <label
          htmlFor={inputId}
          className="text-[14px] font-semibold text-on-surface-variant mb-1"
        >
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-outline pointer-events-none">
            {icon}
          </span>
        )}
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-outline font-medium pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          id={inputId}
          className={cn(
            'w-full h-[44px] rounded-lg border border-outline-variant bg-surface px-4 py-2',
            'text-[14px] text-on-surface placeholder:text-outline',
            'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
            'transition-colors duration-150',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            icon && 'pl-10',
            prefix && 'pl-10',
            error && 'border-error focus:ring-error focus:border-error',
            className
          )}
          {...props}
        />
      </div>
      {error && (
        <span className="text-[12px] text-error mt-1">{error}</span>
      )}
    </div>
  );
}
