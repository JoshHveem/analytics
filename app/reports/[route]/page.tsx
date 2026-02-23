import { ReportPageSuspense } from "../_components/ReportPageSuspense";
import ReportDynamicPageClient from "./ReportDynamicPageClient";
import { requireAuth } from "@/lib/auth";

export default async function DynamicReportPage({
  params,
}: {
  params: Promise<{ route: string }>;
}) {
  const user = await requireAuth();
  const { route } = await params;

  return (
    <ReportPageSuspense title="Report" maxWidthClassName="max-w-6xl">
      <ReportDynamicPageClient route={route} isAdmin={user.is_admin} />
    </ReportPageSuspense>
  );
}
