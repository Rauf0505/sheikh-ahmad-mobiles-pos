import { cn } from '../../lib/utils';

interface CardProps {
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}

export function Card({ children, className, onClick, active }: CardProps) {
  const isClickable = !!onClick;

  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-surface border border-outline-variant rounded-xl p-5',
        isClickable &&
          'cursor-pointer hover:bg-surface-container-low transition-colors duration-150',
        active && 'bg-surface-container-low border-primary',
        className
      )}
      {...(isClickable && {
        role: 'button',
        tabIndex: 0,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick?.();
          }
        },
      })}
    >
      {children}
    </div>
  );
}
