import { Button } from './Button';

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <span className="material-symbols-outlined text-[64px] text-outline-variant mb-4">
        {icon}
      </span>
      <h3 className="text-headline-md font-semibold text-on-surface mb-2">
        {title}
      </h3>
      <p className="text-body-md text-on-surface-variant max-w-sm mb-6">
        {description}
      </p>
      {action && (
        <Button variant="primary" size="md" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
