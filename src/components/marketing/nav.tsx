'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ThemeToggle } from '@/components/ui/theme';
import { buttonClass } from '@/components/ui/primitives';

const LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#interview-types', label: 'Interview types' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
] as const;

export function MarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg)]/85 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="TalentOS home">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">TalentOS</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-[var(--radius-control)] px-3 py-2 text-[13px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/login" className={`${buttonClass('ghost', 'sm')} hidden sm:inline-flex`}>
            Sign in
          </Link>
          <Link href="/register" className={buttonClass('primary', 'sm')}>
            Start free
          </Link>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border)] text-[var(--text-muted)] md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {open ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
            </svg>
          </button>
        </div>
      </nav>

      {open ? (
        <div className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 md:hidden">
          <div className="flex flex-col">
            {LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-[var(--radius-control)] px-3 py-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              >
                {link.label}
              </a>
            ))}
            <Link
              href="/login"
              className="rounded-[var(--radius-control)] px-3 py-2.5 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] sm:hidden"
            >
              Sign in
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      {/* Two converging paths: the candidate's answer and the interviewer's follow-up. */}
      <path
        d="M9 21.5C9 16 11.5 12 16 12s7 4 7 9.5"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path d="M16 21.5V12" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="9.5" r="2.4" fill="white" />
    </svg>
  );
}
