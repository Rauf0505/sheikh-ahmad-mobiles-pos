import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'amber';
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  loading?: boolean;
}

const variantStyles = {
  primary:
    'bg-primary text-on-primary hover:bg-on-primary-fixed-variant active:bg-on-primary-fixed',
  secondary:
    'bg-secondary-container text-on-secondary-container hover:bg-secondary hover:text-on-secondary',
  ghost: 'bg-transparent hover:bg-surface-container',
  danger: 'bg-error text-on-error hover:opacity-90 active:opacity-80',
  amber:
    'bg-tertiary-fixed-dim text-on-tertiary-fixed hover:opacity-90 active:opacity-80',
};

const sizeStyles = {
  sm: 'h-8 px-3 text-[12px]',
  md: 'h-10 px-4 text-[14px]',
  lg: 'h-12 px-6 text-[14px]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold',
        'min-h-[44px] transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="material-symbols-outlined animate-spin text-[18px]">
          progress_activity
        </span>
      ) : icon ? (
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
      ) : null}
      {children && <span>{children}</span>}
    </button>
  );
}
