export const REPORT_FILTERS_READY_EVENT = "analytics:report-filters-ready";
const REPORT_FILTERS_READY_ROUTE_ATTR = "data-report-filters-route";
const REPORT_FILTERS_READY_QUERY_ATTR = "data-report-filters-query";
const REPORT_FILTERS_READY_ATTR = "data-report-filters-ready";

export type ReportFiltersReadyDetail = {
  reportRoute: string | null;
  queryKey: string;
  ready: boolean;
};

function documentRoot(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  return document.documentElement;
}

export function publishReportFiltersReady(
  reportRoute: string | null,
  queryKey: string,
  ready: boolean
): void {
  const root = documentRoot();
  if (root) {
    if (reportRoute) {
      root.setAttribute(REPORT_FILTERS_READY_ROUTE_ATTR, reportRoute);
      root.setAttribute(REPORT_FILTERS_READY_QUERY_ATTR, queryKey);
      root.setAttribute(REPORT_FILTERS_READY_ATTR, ready ? "1" : "0");
    } else {
      root.removeAttribute(REPORT_FILTERS_READY_ROUTE_ATTR);
      root.removeAttribute(REPORT_FILTERS_READY_QUERY_ATTR);
      root.setAttribute(REPORT_FILTERS_READY_ATTR, "1");
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(REPORT_FILTERS_READY_EVENT, {
        detail: <ReportFiltersReadyDetail>{
          reportRoute,
          queryKey,
          ready,
        },
      })
    );
  }
}

export function readReportFiltersReady(reportRoute: string, queryKey: string): boolean {
  const root = documentRoot();
  if (!root) {
    return false;
  }
  const activeRoute = root.getAttribute(REPORT_FILTERS_READY_ROUTE_ATTR);
  const activeQuery = root.getAttribute(REPORT_FILTERS_READY_QUERY_ATTR);
  const readyValue = root.getAttribute(REPORT_FILTERS_READY_ATTR);
  return activeRoute === reportRoute && activeQuery === queryKey && readyValue === "1";
}
