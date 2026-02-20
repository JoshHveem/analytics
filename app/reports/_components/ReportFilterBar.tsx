import { ReportContainer } from "./ReportContainer";
import { ReportFilterField } from "./ReportFilterField";

type SelectOption = {
  value: string;
  label: string;
};

export type ReportFilterConfig = {
  filterCode: string;
  label: string;
  description?: string | null;
  value: string;
  options: SelectOption[];
  disabled?: boolean;
  onChange: (nextValue: string) => void;
};

type ReportFilterBarProps = {
  filters: ReportFilterConfig[];
  className?: string;
};

export function ReportFilterBar({ filters, className }: ReportFilterBarProps) {
  if (filters.length === 0) {
    return null;
  }

  return (
    <ReportContainer className={className ?? "mt-5"} tone="muted" padding="sm">
      <div className="flex flex-wrap items-end gap-3">
        {filters.map((filter) => (
          <ReportFilterField
            key={filter.filterCode}
            filterCode={filter.filterCode}
            label={filter.label}
            description={filter.description}
            value={filter.value}
            options={filter.options}
            disabled={filter.disabled}
            onChange={filter.onChange}
          />
        ))}
      </div>
    </ReportContainer>
  );
}
