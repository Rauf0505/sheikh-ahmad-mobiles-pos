import { cn } from '../../lib/utils';

interface SelectOption {
  value: string | number;
  label: string;
}

interface SelectProps {
  label?: string;
  value: string | number;
  onChange: (value: string | number) => void;
  options: SelectOption[];
  placeholder?: string;
  error?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

export function Select({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select an option',
  error,
  id,
  disabled = false,
  className,
}: SelectProps) {
  const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const numericVal = Number(val);
    onChange(numericVal || val === '0' ? (options.some((o) => typeof o.value === 'number') ? numericVal : val) : val);
  };

  return (
    <div className="flex flex-col">
      {label && (
        <label
          htmlFor={selectId}
          className="text-[14px] font-semibold text-on-surface-variant mb-1"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className={cn(
            'w-full h-[44px] appearance-none rounded-lg border border-outline-variant bg-surface',
            'pl-4 pr-10 py-2 text-[14px] text-on-surface',
            'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
            'transition-colors duration-150',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            error && 'border-error focus:ring-error focus:border-error',
            value === '' && 'text-outline',
            className
          )}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-outline pointer-events-none">
          expand_more
        </span>
      </div>
      {error && (
        <span className="text-[12px] text-error mt-1">{error}</span>
      )}
    </div>
  );
}
