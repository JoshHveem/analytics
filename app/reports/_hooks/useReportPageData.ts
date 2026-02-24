import { useCallback, useEffect, useRef, useState } from "react";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { getAnonymizeEnabled, type TemplateReportConfigResponse } from "../report-template";
import {
  readReportFiltersReady,
  REPORT_FILTERS_READY_EVENT,
} from "../filter-readiness";

type UseReportPageDataArgs<TRow> = {
  route: string;
  searchParams: ReadonlyURLSearchParams;
  initialTitle: string;
  initialDescription?: string | null;
  initialRows: TRow[] | null;
  resetRowsBeforeFetch?: TRow[] | null;
  rowsOnFetchError?: TRow[] | null;
  fetchRows: (args: {
    searchParams: URLSearchParams | ReadonlyURLSearchParams;
    anonymize: boolean;
  }) => Promise<TRow[]>;
};

export function useReportPageData<TRow>({
  route,
  searchParams,
  initialTitle,
  initialDescription = null,
  initialRows,
  resetRowsBeforeFetch,
  rowsOnFetchError,
  fetchRows,
}: UseReportPageDataArgs<TRow>) {
  const searchParamsKey = searchParams.toString();
  const [reportTitle, setReportTitle] = useState(initialTitle);
  const [reportDescription, setReportDescription] = useState<string | null>(initialDescription);
  const [rows, setRows] = useState<TRow[] | null>(initialRows);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersReady, setFiltersReady] = useState(false);
  const refreshRequestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!filtersReady) {
      return;
    }
    const requestId = ++refreshRequestIdRef.current;
    setError(null);
    setLoading(true);

    if (resetRowsBeforeFetch !== undefined) {
      setRows(resetRowsBeforeFetch);
    }

    try {
      const data = await fetchRows({
        searchParams: new URLSearchParams(searchParamsKey),
        anonymize: getAnonymizeEnabled(),
      });
      if (refreshRequestIdRef.current !== requestId) {
        return;
      }
      setRows(data);
    } catch (e: unknown) {
      if (refreshRequestIdRef.current !== requestId) {
        return;
      }
      setRows(rowsOnFetchError ?? initialRows);
      setError(String(e));
    } finally {
      if (refreshRequestIdRef.current !== requestId) {
        return;
      }
      setLoading(false);
    }
  }, [fetchRows, filtersReady, initialRows, resetRowsBeforeFetch, rowsOnFetchError, searchParamsKey]);

  useEffect(() => {
    refreshRequestIdRef.current += 1;
    setFiltersReady(false);
    setRows(resetRowsBeforeFetch ?? initialRows);
    setLoading(false);
  }, [initialRows, resetRowsBeforeFetch, route, searchParamsKey]);

  useEffect(() => {
    function applyReadyState() {
      if (readReportFiltersReady(route, searchParamsKey)) {
        setFiltersReady(true);
      }
    }

    applyReadyState();

    function onReadyStateChange(event: Event) {
      const customEvent = event as CustomEvent<{
        reportRoute?: string | null;
        queryKey?: string | null;
        ready?: boolean;
      }>;
      const eventRoute = String(customEvent.detail?.reportRoute ?? "").trim();
      const eventQueryKey = String(customEvent.detail?.queryKey ?? "");
      if (eventRoute !== route) {
        return;
      }
      if (eventQueryKey !== searchParamsKey) {
        return;
      }
      if (customEvent.detail?.ready) {
        setFiltersReady(true);
      } else {
        setFiltersReady(false);
      }
    }

    window.addEventListener(REPORT_FILTERS_READY_EVENT, onReadyStateChange as EventListener);
    return () => {
      window.removeEventListener(REPORT_FILTERS_READY_EVENT, onReadyStateChange as EventListener);
    };
  }, [route, searchParamsKey]);

  useEffect(() => {
    async function fetchReportConfig() {
      try {
        const res = await fetch(`/api/reports/config?route=${route}`);
        const json = (await res.json()) as TemplateReportConfigResponse;
        if (!res.ok) {
          throw new Error(json.error || "Request failed");
        }
        if (json.config) {
          setReportTitle(String(json.config.title ?? initialTitle));
          setReportDescription(json.config.description ?? null);
        }
      } catch {
        // Keep local fallback title/description if metadata fails.
      }
    }

    void fetchReportConfig();
  }, [initialTitle, route]);

  useEffect(() => {
    if (!filtersReady) {
      return;
    }
    void refresh();
  }, [filtersReady, refresh]);

  useEffect(() => {
    function onAnonymizeChange() {
      void refresh();
    }

    window.addEventListener("analytics:anonymize-change", onAnonymizeChange);
    return () => {
      window.removeEventListener("analytics:anonymize-change", onAnonymizeChange);
    };
  }, [refresh]);

  return {
    reportTitle,
    reportDescription,
    rows,
    loading: loading || !filtersReady,
    error,
    refresh,
    setRows,
  };
}
