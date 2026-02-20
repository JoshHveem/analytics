type SelectOption = {
  value: string;
  label: string;
};

type ReportFilterFieldProps = {
  filterCode: string;
  label: string;
  description?: string | null;
  value: string;
  options: SelectOption[];
  disabled?: boolean;
  onChange: (nextValue: string) => void;
};

export function ReportFilterField({
  filterCode,
  label,
  description,
  value,
  options,
  disabled = false,
  onChange,
}: ReportFilterFieldProps) {
  return (
    <label id={`filter-${filterCode}`} className="flex min-w-[12rem] scroll-mt-6 flex-col text-sm">
      <span>{label}</span>
      {description && (
        <span className="mt-0.5 text-xs" style={{ color: "var(--app-text-muted)" }}>
          {description}
        </span>
      )}
      {options.length > 0 ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 rounded border px-2 py-1"
          disabled={disabled}
          data-filter-code={filterCode}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 rounded border px-2 py-1"
          disabled={disabled}
          data-filter-code={filterCode}
        />
      )}
    </label>
  );
}
