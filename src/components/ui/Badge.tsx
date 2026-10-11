import { cn } from '../../lib/utils';

interface BadgeProps {
  variant: 'success' | 'error' | 'warning' | 'info' | 'neutral' | 'secondary';
  children: React.ReactNode;
  size?: 'sm' | 'md';
}

const variantStyles = {
  success: 'bg-primary-container/20 text-primary',
  error: 'bg-error-container text-on-error-container',
  warning: 'bg-tertiary-fixed/30 text-tertiary',
  info: 'bg-secondary-container text-on-secondary-container',
  secondary: 'bg-secondary-container text-on-secondary-container',
  neutral: 'bg-surface-container-highest text-on-surface',
};

const sizeStyles = {
  sm: 'text-[11px] px-2 py-0.5',
  md: 'text-[12px] px-2.5 py-0.5',
};

export function Badge({ variant, children, size = 'md' }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-full font-semibold whitespace-nowrap',
        variantStyles[variant],
        sizeStyles[size]
      )}
    >
      {children}
    </span>
  );
}
