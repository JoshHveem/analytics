export default function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>;
}
