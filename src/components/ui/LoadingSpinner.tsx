import { cn } from '../../lib/utils';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | number;
  className?: string;
}

const sizeMap = { sm: 20, md: 32, lg: 48 };

export function LoadingSpinner({ size = 'md', className }: LoadingSpinnerProps) {
  const px = typeof size === 'number' ? size : sizeMap[size];
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div
        className="border-2 border-outline-variant border-t-primary rounded-full animate-spin"
        style={{ width: px, height: px }}
      />
    </div>
  );
}
