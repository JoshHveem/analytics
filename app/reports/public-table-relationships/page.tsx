"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReportHeader } from "../_components/ReportHeader";
import { ReportContainer } from "../_components/ReportContainer";
import { MetaChip } from "../_components/MetaChip";
import { ReportErrorBanner } from "../_components/ReportErrorBanner";
import { ReportPageSuspense } from "../_components/ReportPageSuspense";
import { useReportPageData } from "../_hooks/useReportPageData";
import { APP_COLORS, withAlpha } from "@/lib/color-palette";

type TableSummaryRow = {
  table_schema: string;
  table_name: string;
  qualified_table: string;
  all_columns: string[];
  shared_fields: string[];
  shared_field_count: number;
};

type TableRelationshipRow = {
  table_a: string;
  table_b: string;
  shared_fields: string[];
  shared_field_count: number;
};

type TableRelationshipResponse = {
  ok: boolean;
  count: number;
  data: TableRelationshipRow[];
  meta?: {
    key_fields?: string[];
    schemas?: string[];
    table_count?: number;
    relationship_count?: number;
    tables?: TableSummaryRow[];
  };
  error?: string;
};

const EMPTY_RELATIONSHIP_ROWS: TableRelationshipRow[] = [];
const EMPTY_TABLE_ROWS: TableSummaryRow[] = [];
const SHARED_FIELD_COLOR_MAP: Record<string, string> = {
  sis_user_id: APP_COLORS.red,
  course_code: APP_COLORS.blue,
  program_code: APP_COLORS.purple,
  department_code: APP_COLORS.orange,
  academic_year: APP_COLORS.green,
  campus_code: APP_COLORS.yellowDark,
};

function commaSeparated(values: string[] | null | undefined): string {
  if (!Array.isArray(values) || values.length === 0) {
    return "-";
  }
  return values.join(", ");
}

function unique(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(new Set(values));
}

function sharedFieldColor(field: string): string {
  return SHARED_FIELD_COLOR_MAP[field] ?? APP_COLORS.darkGray;
}

function SharedFieldPills({ fields }: { fields: string[] }) {
  const normalized = unique(fields);
  if (normalized.length === 0) {
    return <span style={{ color: "var(--app-text-muted)" }}>-</span>;
  }

  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {normalized.map((field) => {
        const color = sharedFieldColor(field);
        return (
          <span
            key={field}
            className="rounded-full border px-2 py-0.5 text-[11px] font-medium"
            style={{
              borderColor: withAlpha(color, 0.6),
              backgroundColor: withAlpha(color, 0.14),
              color: "var(--app-text-strong)",
            }}
            title={`Field color mapping: ${field}`}
          >
            {field}
          </span>
        );
      })}
    </span>
  );
}

function PublicTableRelationshipsPageInner() {
  const searchParams = useSearchParams();
  const [tableRows, setTableRows] = useState<TableSummaryRow[]>(EMPTY_TABLE_ROWS);
  const [keyFields, setKeyFields] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [collapsedByTable, setCollapsedByTable] = useState<Record<string, boolean>>({});
  const [layoutTick, setLayoutTick] = useState(0);
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const selectedColumnRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const relatedColumnRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const fetchRows = useCallback(
    async ({ anonymize }: { searchParams: URLSearchParams | Readonly<URLSearchParams>; anonymize: boolean }) => {
      const params = new URLSearchParams({
        include_meta: "1",
        include_rows: "1",
        anonymize: anonymize ? "1" : "0",
      });

      const res = await fetch(`/api/reports/public-table-relationships?${params.toString()}`);
      const json = (await res.json()) as TableRelationshipResponse;

      if (!res.ok) {
        throw new Error(json.error || "Request failed");
      }

      const tables = Array.isArray(json.meta?.tables) ? json.meta?.tables : EMPTY_TABLE_ROWS;
      setTableRows(tables);
      setKeyFields(Array.isArray(json.meta?.key_fields) ? json.meta!.key_fields! : []);
      if (tables.length > 0) {
        setSelectedTable((current) => {
          if (current && tables.some((table) => table.qualified_table === current)) {
            return current;
          }
          return tables[0].qualified_table;
        });
      } else {
        setSelectedTable("");
      }

      return Array.isArray(json.data) ? json.data : EMPTY_RELATIONSHIP_ROWS;
    },
    []
  );

  const { reportTitle, reportDescription, loading, error, rows } = useReportPageData<TableRelationshipRow>({
    route: "public-table-relationships",
    searchParams,
    initialTitle: "Data Table Relationships",
    initialDescription:
      "All data schema tables and how they relate via shared key fields.",
    initialRows: EMPTY_RELATIONSHIP_ROWS,
    rowsOnFetchError: EMPTY_RELATIONSHIP_ROWS,
    fetchRows,
  });

  const relationshipRows = rows ?? EMPTY_RELATIONSHIP_ROWS;
  const tableByQualifiedName = useMemo(() => {
    const byName = new Map<string, TableSummaryRow>();
    for (const table of tableRows) {
      byName.set(table.qualified_table, table);
    }
    return byName;
  }, [tableRows]);

  const selectedTableData = tableByQualifiedName.get(selectedTable) ?? null;

  const connectedRows = useMemo(() => {
    if (!selectedTable) {
      return [];
    }
    const connected = relationshipRows
      .filter((row) => row.table_a === selectedTable || row.table_b === selectedTable)
      .map((row) => {
        const otherTable = row.table_a === selectedTable ? row.table_b : row.table_a;
        return {
          otherTable,
          sharedFields: row.shared_fields,
          sharedFieldCount: row.shared_field_count,
          row,
        };
      })
      .sort((a, b) => {
        if (b.sharedFieldCount !== a.sharedFieldCount) {
          return b.sharedFieldCount - a.sharedFieldCount;
        }
        return a.otherTable.localeCompare(b.otherTable);
      });
    return connected;
  }, [relationshipRows, selectedTable]);

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const connection of connectedRows) {
      next[connection.otherTable] = true;
    }
    setCollapsedByTable(next);
  }, [selectedTable, connectedRows]);

  const requestConnectorLayout = useCallback(() => {
    setLayoutTick((value) => value + 1);
  }, []);

  useLayoutEffect(() => {
    requestConnectorLayout();
  }, [requestConnectorLayout, selectedTable, connectedRows.length, loading, collapsedByTable]);

  useEffect(() => {
    function onViewportChange() {
      requestConnectorLayout();
    }
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("resize", onViewportChange);
    };
  }, [requestConnectorLayout]);

  const connectorPaths = useMemo(() => {
    const container = mapCanvasRef.current;
    if (!container || !selectedTableData) {
      return [];
    }

    const containerRect = container.getBoundingClientRect();
    const paths: Array<{ id: string; field: string; color: string; d: string }> = [];

    for (const connection of connectedRows) {
      for (const field of connection.sharedFields) {
        const sourceElement = selectedColumnRefs.current[field] ?? null;
        const targetKey = `${connection.otherTable}::${field}`;
        const targetElement = relatedColumnRefs.current[targetKey] ?? null;
        if (!sourceElement || !targetElement) {
          continue;
        }

        const sourceRect = sourceElement.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();

        const startX = sourceRect.right - containerRect.left;
        const startY = sourceRect.top + sourceRect.height / 2 - containerRect.top;
        const endX = targetRect.left - containerRect.left;
        const endY = targetRect.top + targetRect.height / 2 - containerRect.top;
        const bendX = startX + Math.max(20, (endX - startX) * 0.35);

        const path = [
          `M ${startX} ${startY}`,
          `L ${bendX} ${startY}`,
          `L ${bendX} ${endY}`,
          `L ${endX - 8} ${endY}`,
        ].join(" ");

        paths.push({
          id: `${connection.otherTable}-${field}`,
          field,
          color: sharedFieldColor(field),
          d: path,
        });
      }
    }

    return paths;
  }, [connectedRows, layoutTick, selectedTableData]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <ReportHeader title={reportTitle} description={reportDescription} />

      {error && <ReportErrorBanner className="mt-4" message={error} />}

      <ReportContainer className="mt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Table Selector</h2>
          <MetaChip>Tables: {tableRows.length}</MetaChip>
        </div>

        <label className="block text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--app-text-muted)" }}>
          Table
        </label>
        <select
          className="mt-2 w-full rounded-md border px-3 py-2 text-sm"
          style={{
            borderColor: "var(--app-border)",
            backgroundColor: "var(--app-surface)",
            color: "var(--app-text-strong)",
          }}
          value={selectedTable}
          onChange={(event) => setSelectedTable(event.target.value)}
          disabled={loading || tableRows.length === 0}
        >
          {tableRows.length === 0 && <option value="">No tables available</option>}
          {tableRows.map((table) => (
            <option key={table.qualified_table} value={table.qualified_table}>
              {table.qualified_table}
            </option>
          ))}
        </select>

        {keyFields.length > 0 && (
          <p className="mb-3 text-xs" style={{ color: "var(--app-text-muted)" }}>
            Relationship fields: <SharedFieldPills fields={keyFields} />
          </p>
        )}
      </ReportContainer>

      <ReportContainer className="mt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Relationship Map</h2>
          <MetaChip>Connections: {connectedRows.length}</MetaChip>
        </div>

        {loading && (
          <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
            Loading...
          </div>
        )}

        {!loading && !selectedTableData && (
          <div className="text-sm" style={{ color: "var(--app-text-muted)" }}>
            Select a table to see its relationships.
          </div>
        )}

        {!loading && selectedTableData && (
          <div ref={mapCanvasRef} className="relative grid grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,1fr)_48px_minmax(0,1.6fr)]">
            <svg
              className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block"
              role="img"
              aria-label="Shared field relationship connectors"
            >
              <defs>
                {keyFields.map((field) => {
                  const color = sharedFieldColor(field);
                  return (
                    <marker
                      key={field}
                      id={`rel-arrow-${field}`}
                      markerWidth="8"
                      markerHeight="8"
                      refX="7"
                      refY="4"
                      orient="auto"
                      markerUnits="strokeWidth"
                    >
                      <path d="M 0 0 L 8 4 L 0 8 z" fill={color} />
                    </marker>
                  );
                })}
              </defs>
              {connectorPaths.map((connector) => (
                <path
                  key={connector.id}
                  d={connector.d}
                  fill="none"
                  stroke={withAlpha(connector.color, 0.85)}
                  strokeWidth={2.2}
                  markerEnd={`url(#rel-arrow-${connector.field})`}
                />
              ))}
            </svg>
            <div className="rounded-lg border p-3" style={{ borderColor: "var(--app-border)", backgroundColor: "var(--app-surface)" }}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{selectedTableData.qualified_table}</h3>
                <MetaChip>Columns: {selectedTableData.all_columns.length}</MetaChip>
              </div>
              <div className="mt-2 text-xs" style={{ color: "var(--app-text-muted)" }}>
                Shared fields present: <SharedFieldPills fields={selectedTableData.shared_fields} />
              </div>
              <ul className="mt-3 max-h-[420px] space-y-1 overflow-auto text-xs" onScroll={requestConnectorLayout}>
                {selectedTableData.all_columns.map((column) => {
                  const isSharedKey = selectedTableData.shared_fields.includes(column);
                  const fieldColor = sharedFieldColor(column);
                  return (
                    <li
                      key={column}
                      ref={(el) => {
                        if (isSharedKey) {
                          selectedColumnRefs.current[column] = el;
                          return;
                        }
                        delete selectedColumnRefs.current[column];
                      }}
                      className="rounded px-2 py-1"
                      style={{ backgroundColor: isSharedKey ? withAlpha(fieldColor, 0.16) : "transparent" }}
                    >
                      <span style={{ color: "var(--app-text-strong)" }}>{column}</span>
                      {isSharedKey && (
                        <span className="ml-2" style={{ color: withAlpha(fieldColor, 0.95) }}>
                          {" key"}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="hidden items-center justify-center lg:flex" />

            <div className="space-y-3">
              {connectedRows.length === 0 && (
                <div className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--app-border)", color: "var(--app-text-muted)" }}>
                  No connected tables found using the selected relationship fields.
                </div>
              )}
              {connectedRows.map((connection) => {
                const target = tableByQualifiedName.get(connection.otherTable);
                if (!target) {
                  return null;
                }
                const isCollapsed = collapsedByTable[connection.otherTable] ?? true;
                const collapsedColumns = unique(connection.sharedFields);
                const visibleColumns = isCollapsed ? collapsedColumns : target.all_columns;
                return (
                  <div
                    key={connection.otherTable}
                    className="rounded-lg border p-3"
                    style={{
                      borderColor: "var(--app-border)",
                      backgroundColor: "var(--app-surface)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold">{target.qualified_table}</h4>
                      <div className="flex items-center gap-2">
                        <MetaChip>Columns: {target.all_columns.length}</MetaChip>
                        <button
                          type="button"
                          className="rounded-md border px-2 py-1 text-xs"
                          style={{
                            borderColor: "var(--app-border)",
                            color: "var(--app-text-strong)",
                            backgroundColor: "var(--app-surface-muted)",
                          }}
                          onClick={() =>
                            setCollapsedByTable((prev) => ({
                              ...prev,
                              [connection.otherTable]: !(prev[connection.otherTable] ?? true),
                            }))
                          }
                        >
                          {isCollapsed ? "Expand" : "Collapse"}
                        </button>
                      </div>
                    </div>
                    <p className="mt-2 text-xs" style={{ color: "var(--app-text-muted)" }}>
                      Shared with {selectedTableData.qualified_table}: <SharedFieldPills fields={connection.sharedFields} />
                    </p>
                    <p className="mt-1 text-xs" style={{ color: "var(--app-text-muted)" }}>
                      {isCollapsed
                        ? "Showing shared fields only"
                        : `Relationship strength: ${connection.sharedFieldCount} shared field${connection.sharedFieldCount === 1 ? "" : "s"}`}
                    </p>
                    <ul className="mt-3 max-h-48 space-y-1 overflow-auto text-xs" onScroll={requestConnectorLayout}>
                      {visibleColumns.map((column) => {
                        const isSharedWithSelected = connection.sharedFields.includes(column);
                        const fieldColor = sharedFieldColor(column);
                        return (
                          <li
                            key={`${target.qualified_table}-${column}`}
                            ref={(el) => {
                              const relationKey = `${connection.otherTable}::${column}`;
                              if (isSharedWithSelected) {
                                relatedColumnRefs.current[relationKey] = el;
                                return;
                              }
                              delete relatedColumnRefs.current[relationKey];
                            }}
                            className="rounded px-2 py-1"
                            style={{ backgroundColor: isSharedWithSelected ? withAlpha(fieldColor, 0.16) : "transparent" }}
                          >
                            <span style={{ color: "var(--app-text-strong)" }}>{column}</span>
                            {isSharedWithSelected && (
                              <span className="ml-2" style={{ color: withAlpha(fieldColor, 0.95) }}>
                                {" linked"}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </ReportContainer>
    </div>
  );
}

export default function PublicTableRelationshipsPage() {
  return (
    <ReportPageSuspense title="Data Table Relationships" maxWidthClassName="max-w-6xl">
      <PublicTableRelationshipsPageInner />
    </ReportPageSuspense>
  );
}
