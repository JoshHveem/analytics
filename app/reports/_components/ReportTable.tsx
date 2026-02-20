"use client";

import { useEffect, useMemo, useState } from "react";
import { Pill, type PillTone } from "./Pill";
import { ThresholdMetricValue } from "./ThresholdMetricValue";

type CellValue = string | number | boolean | null | undefined;

type ThresholdColumnConfig = {
  cutoff: number;
  comparison?: "gte" | "lte";
  format?: "number" | "percent";
  fractionDigits?: number;
};

type PillColumnConfig<T> = {
  getLabel: (value: unknown, row: T) => string;
  getTone?: (value: unknown, row: T) => PillTone;
};

export type ReportTableColumn<T> = {
  id: string;
  header: string;
  accessor?: keyof T;
  columnType?: "text" | "number" | "percent" | "threshold" | "pill" | "custom";
  fractionDigits?: number;
  threshold?: ThresholdColumnConfig;
  pill?: PillColumnConfig<T>;
  render?: (row: T, index: number) => React.ReactNode;
  sortValue?: (row: T, index: number) => unknown;
  sortable?: boolean;
  headerClassName?: string;
  cellClassName?: string;
};

type ReportTableProps<T> = {
  rows: T[];
  columns: ReportTableColumn<T>[];
  defaultSort: {
    columnId: string;
    direction?: SortDirection;
  };
  rowKey: (row: T, index: number) => string;
  emptyText?: string;
  rowClassName?: (row: T, index: number) => string;
};

type SortDirection = "asc" | "desc";

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value: unknown, fractionDigits: number): string {
  const number = toNumber(value);
  if (!Number.isFinite(number)) {
    return "-";
  }
  return Number(number).toLocaleString(undefined, {
    maximumFractionDigits: fractionDigits,
  });
}

function formatPercent(value: unknown, fractionDigits: number): string {
  const number = toNumber(value);
  if (!Number.isFinite(number)) {
    return "-";
  }
  return `${((number as number) * 100).toFixed(fractionDigits)}%`;
}

function formatText(value: CellValue): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

function getRawValue<T>(row: T, column: ReportTableColumn<T>): unknown {
  if (!column.accessor) {
    return undefined;
  }
  return row[column.accessor];
}

function getSortValue<T>(row: T, index: number, column: ReportTableColumn<T>): unknown {
  if (column.sortValue) {
    return column.sortValue(row, index);
  }
  return getRawValue(row, column);
}

function isSortableColumn<T>(column: ReportTableColumn<T>): boolean {
  if (typeof column.sortable === "boolean") {
    return column.sortable;
  }
  return Boolean(column.accessor || column.sortValue);
}

function defaultSortDirection(direction: SortDirection | undefined): SortDirection {
  return direction === "desc" ? "desc" : "asc";
}

function toComparableValue<T>(value: unknown, column: ReportTableColumn<T>): number | string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (column.columnType === "number" || column.columnType === "percent" || column.columnType === "threshold") {
    return toNumber(value);
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }
    return trimmed.toLocaleLowerCase();
  }

  return String(value).toLocaleLowerCase();
}

function compareValues(a: number | string | null, b: number | string | null): number {
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }

  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function isSensitiveColumn(columnId: string): boolean {
  const normalized = columnId.trim().toLowerCase();
  return normalized === "name" || normalized === "instructor" || normalized === "sis_user_id" || normalized.includes("user");
}

function renderCell<T>(row: T, index: number, column: ReportTableColumn<T>, anonymize: boolean): React.ReactNode {
  const shouldMask = anonymize && isSensitiveColumn(column.id);
  if (shouldMask) {
    return "Hidden";
  }

  if (column.columnType === "custom") {
    return column.render ? column.render(row, index) : "-";
  }

  const raw = getRawValue(row, column);
  const fractionDigits = column.fractionDigits ?? 2;

  if (column.columnType === "number") {
    return formatNumber(raw, fractionDigits);
  }

  if (column.columnType === "percent") {
    return formatPercent(raw, fractionDigits);
  }

  if (column.columnType === "threshold") {
    const config = column.threshold;
    if (!config) {
      return "-";
    }
    return (
      <ThresholdMetricValue
        value={toNumber(raw)}
        cutoff={config.cutoff}
        comparison={config.comparison ?? "gte"}
        format={config.format ?? "number"}
        fractionDigits={config.fractionDigits ?? fractionDigits}
      />
    );
  }

  if (column.columnType === "pill") {
    if (!column.pill) {
      return "-";
    }
    const label = column.pill.getLabel(raw, row);
    const tone = column.pill.getTone ? column.pill.getTone(raw, row) : "neutral";
    return <Pill label={label} tone={tone} />;
  }

  return formatText(raw as CellValue);
}

export function ReportTable<T>({
  rows,
  columns,
  defaultSort,
  rowKey,
  emptyText = "No rows found.",
  rowClassName,
}: ReportTableProps<T>) {
  const [anonymize, setAnonymize] = useState(false);

  useEffect(() => {
    const root = document.documentElement;

    function syncAnonymizeState() {
      setAnonymize(root.getAttribute("data-anonymize") === "1");
    }

    syncAnonymizeState();
    const observer = new MutationObserver(syncAnonymizeState);
    observer.observe(root, { attributes: true, attributeFilter: ["data-anonymize"] });

    return () => {
      observer.disconnect();
    };
  }, []);

  const sortableColumnIds = useMemo(() => {
    return columns.filter((column) => isSortableColumn(column)).map((column) => column.id);
  }, [columns]);

  const fallbackColumnId = sortableColumnIds[0] ?? columns[0]?.id;
  const defaultSortColumnId = sortableColumnIds.includes(defaultSort.columnId)
    ? defaultSort.columnId
    : fallbackColumnId;

  const [sortState, setSortState] = useState<{ columnId: string; direction: SortDirection }>({
    columnId: defaultSortColumnId,
    direction: defaultSortDirection(defaultSort.direction),
  });

  const activeSortState = useMemo(() => {
    const currentSortIsValid = sortableColumnIds.includes(sortState.columnId);
    if (currentSortIsValid) {
      return sortState;
    }
    return {
      columnId: defaultSortColumnId,
      direction: defaultSortDirection(defaultSort.direction),
    };
  }, [defaultSort.columnId, defaultSort.direction, defaultSortColumnId, sortState, sortableColumnIds]);

  const sortedRows = useMemo(() => {
    const indexedRows = rows.map((row, index) => ({ row, index }));
    const column = columns.find((item) => item.id === activeSortState.columnId);
    if (!column || !isSortableColumn(column)) {
      return indexedRows;
    }

    const directionFactor = activeSortState.direction === "asc" ? 1 : -1;

    return [...indexedRows].sort((left, right) => {
      const leftComparable = toComparableValue(getSortValue(left.row, left.index, column), column);
      const rightComparable = toComparableValue(getSortValue(right.row, right.index, column), column);
      const compared = compareValues(leftComparable, rightComparable);
      if (compared !== 0) {
        return compared * directionFactor;
      }
      return left.index - right.index;
    });
  }, [activeSortState, columns, rows]);

  function toggleSort(column: ReportTableColumn<T>) {
    if (!isSortableColumn(column)) {
      return;
    }

    setSortState((previous) => {
      if (previous.columnId !== column.id) {
        return { columnId: column.id, direction: "asc" };
      }
      if (previous.direction === "asc") {
        return { columnId: column.id, direction: "desc" };
      }
      return { columnId: column.id, direction: "asc" };
    });
  }

  if (rows.length === 0) {
    return (
      <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
        {emptyText}
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left" style={{ color: "var(--app-text-strong)" }}>
            {columns.map((column) => (
              <th
                key={column.id}
                className={`border-b p-2 ${column.headerClassName ?? ""}`}
                style={{ borderColor: "var(--app-border)" }}
              >
                {isSortableColumn(column) ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-left"
                    style={{ color: "var(--app-text-strong)" }}
                    onClick={() => toggleSort(column)}
                    aria-label={`Sort by ${column.header}`}
                  >
                    <span>{column.header}</span>
                    <span className="text-[10px] leading-none" style={{ color: "var(--app-text-muted)" }}>
                      {activeSortState.columnId === column.id ? (activeSortState.direction === "asc" ? "^" : "v") : ""}
                    </span>
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(({ row, index: originalIndex }, rowIndex) => (
            <tr
              key={rowKey(row, originalIndex)}
              className={rowClassName ? rowClassName(row, rowIndex) : ""}
              style={{
                backgroundColor: rowIndex % 2 === 0 ? "var(--app-surface)" : "var(--app-surface-muted)",
                color: "var(--app-text-strong)",
              }}
            >
              {columns.map((column) => (
                <td key={column.id} className={`p-2 ${column.cellClassName ?? ""}`}>
                  {renderCell(row, originalIndex, column, anonymize)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
