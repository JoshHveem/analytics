import { getActiveReportCategories } from "@/lib/report-catalog";
import SidebarClient from "./SidebarClient";

export default async function Sidebar() {
  const categories = await getActiveReportCategories();

  return (
    <SidebarClient categories={categories} />
  );
}
