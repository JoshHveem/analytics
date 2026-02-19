export default function Sidebar() {
  const categories = [
    {
      title: 'Administrative',
      links: [
        { href: '/reports/admin/users', label: 'User Management' },
        { href: '/reports/admin/settings', label: 'Settings' },
      ],
    },
    {
      title: 'Program',
      links: [
        { href: '/reports/program/yearly-graduates', label: 'Yearly Graduates' },
        { href: '/reports/program/yearly-completers', label: 'Yearly Completers' },
        { href: '/reports/program/outcomes', label: 'Outcomes' },
        { href: '/reports/program/enrollment', label: 'Enrollment' },
      ],
    },
    {
      title: 'Student',
      links: [
        { href: '/reports/student/progress', label: 'Progress' },
        { href: '/reports/student/engagement', label: 'Engagement' },
      ],
    },
    {
      title: 'Favorites',
      links: [
        { href: '/reports/favorites', label: 'Saved Reports' },
      ],
    },
  ];

  return (
    <nav className="fixed left-0 top-0 z-20 h-screen w-64 overflow-auto border-r border-zinc-200 bg-white/90 p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <div>
        <h4 className="text-sm font-semibold">Reports</h4>
        <p className="mt-1 mb-4 text-xs text-zinc-500">Browse report categories</p>

        <div className="flex flex-col gap-6">
          {categories.map((cat) => (
            <div key={cat.title}>
              <div className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">{cat.title}</div>
              <ul className="flex flex-col gap-1">
                {cat.links.map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      className="block rounded px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </nav>
  );
}
