"use client";

import { ReportComponentTable, type ReportComponentTableColumn } from "./ReportComponentTable";

type GenericReportRow = Record<string, unknown>;

export default function ReportComponentTableRuntime(args: {
  rows: GenericReportRow[];
  columns: ReportComponentTableColumn<GenericReportRow>[];
  defaultSortColumnId: string;
  rowKey: (row: GenericReportRow, index: number) => string;
}) {
  const { rows, columns, defaultSortColumnId, rowKey } = args;
  return (
    <ReportComponentTable
      rows={rows}
      columns={columns}
      defaultSort={{ columnId: defaultSortColumnId, direction: "asc" }}
      rowKey={rowKey}
      emptyText="No data found for the selected filters."
    />
  );
}

