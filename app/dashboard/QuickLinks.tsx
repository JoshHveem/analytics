export default function QuickLinks() {
  const links = [
    { href: '/reports', label: 'All Reports' },
    { href: '/reports/program/yearly-graduates', label: 'Yearly Graduates' },
    { href: '/reports/program/yearly-completers', label: 'Yearly Completers' },
    { href: '/reports', label: 'Student Progress' },
    { href: '/api/me', label: 'My Profile (API)' },
  ];

  return (
    <nav className="mt-4 flex flex-col gap-3">
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          className="block rounded-md border border-transparent bg-zinc-50 px-3 py-2 text-sm hover:bg-zinc-100"
        >
          {l.label}
        </a>
      ))}
    </nav>
  );
}
