'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/marketing/nav';
import { ThemeToggle } from '@/components/ui/theme';
import { Badge, buttonClass } from '@/components/ui/primitives';
import { api } from '@/lib/api-client';

type Route =
  | '/dashboard'
  | '/interviews'
  | '/interviews/new'
  | '/jobs'
  | '/profile'
  | '/analytics'
  | '/admin';

interface NavItem {
  href: Route;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

export function AppShell({
  children,
  user,
  engine,
}: {
  children: React.ReactNode;
  user: { email: string; role: string; plan: string };
  engine: { provider: string; isLlm: boolean };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const items: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: <IconGrid /> },
    { href: '/interviews', label: 'Interviews', icon: <IconChat /> },
    { href: '/jobs', label: 'Jobs', icon: <IconBriefcase /> },
    { href: '/profile', label: 'CV & profile', icon: <IconUser /> },
    { href: '/analytics', label: 'Analytics', icon: <IconChart /> },
    { href: '/admin', label: 'Admin', icon: <IconShield />, adminOnly: true },
  ];

  const visible = items.filter((item) => !item.adminOnly || user.role === 'admin');

  async function signOut(): Promise<void> {
    setSigningOut(true);
    try {
      await api.post('/api/auth/logout');
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  const isActive = (href: string): boolean =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[236px_1fr]">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="hidden border-r border-[var(--border)] bg-[var(--bg-subtle)] lg:flex lg:h-screen lg:flex-col lg:sticky lg:top-0">
        <div className="flex h-16 shrink-0 items-center gap-2 px-5">
          <Logo size={24} />
          <span className="text-[15px] font-semibold tracking-tight">TalentOS</span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {visible.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-[13px] font-medium transition ${
                isActive(item.href)
                  ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
              }`}
            >
              <span className={isActive(item.href) ? 'text-[var(--accent)]' : ''}>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="shrink-0 space-y-3 border-t border-[var(--border)] p-3">
          {!engine.isLlm ? <OfflineNotice /> : null}
          <div className="rounded-[var(--radius-control)] bg-[var(--surface)] px-3 py-2.5">
            <p className="truncate text-[12px] font-medium text-[var(--text)]" title={user.email}>
              {user.email}
            </p>
            <div className="mt-1.5 flex items-center justify-between">
              <Badge tone={user.plan === 'free' ? 'neutral' : 'accent'}>
                {user.plan[0]?.toUpperCase()}
                {user.plan.slice(1)}
              </Badge>
              <button
                type="button"
                onClick={signOut}
                disabled={signingOut}
                className="text-[12px] text-[var(--text-subtle)] transition hover:text-[var(--text)] disabled:opacity-50"
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg)]/90 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border)] text-[var(--text-muted)]"
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={menuOpen}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {menuOpen ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
              </svg>
            </button>
            <Logo size={22} />
            <span className="text-sm font-semibold tracking-tight">TalentOS</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link href="/interviews/new" className={buttonClass('primary', 'sm')}>
              New interview
            </Link>
          </div>
        </header>

        {menuOpen ? (
          <div className="border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2 lg:hidden">
            {visible.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2.5 text-sm font-medium ${
                  isActive(item.href)
                    ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                    : 'text-[var(--text-muted)]'
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
            <button
              type="button"
              onClick={signOut}
              className="mt-1 flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2.5 text-left text-sm font-medium text-[var(--text-muted)]"
            >
              Sign out
            </button>
          </div>
        ) : null}

        {!engine.isLlm ? (
          <div className="border-b border-[var(--border)] bg-[var(--warning-soft)] px-4 py-2 text-[12px] leading-relaxed text-[var(--warning)] sm:px-6 lg:hidden">
            Offline heuristic mode — no AI provider is configured.
          </div>
        ) : null}

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </div>
    </div>
  );
}

/**
 * Offline-mode banner.
 *
 * Shown whenever no LLM provider is configured. The product does not pretend to
 * be running a language model when it is not.
 */
function OfflineNotice() {
  return (
    <div className="rounded-[var(--radius-control)] border border-transparent bg-[var(--warning-soft)] px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--warning)]">
        Offline heuristic mode
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--warning)]">
        No AI provider is configured. Interviews run on the deterministic engine, which scores the
        shape of an answer rather than its truth.
      </p>
    </div>
  );
}

/* Icons kept inline: six small glyphs are not worth an icon dependency. */
const iconProps = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const IconGrid = () => (
  <svg {...iconProps}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
);
const IconChat = () => (
  <svg {...iconProps}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z" /></svg>
);
const IconBriefcase = () => (
  <svg {...iconProps}><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /></svg>
);
const IconUser = () => (
  <svg {...iconProps}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
);
const IconChart = () => (
  <svg {...iconProps}><path d="M3 3v18h18" /><path d="m7 15 4-5 3 3 5-7" /></svg>
);
const IconShield = () => (
  <svg {...iconProps}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /></svg>
);
