import Link from 'next/link';
import { Logo } from '@/components/marketing/nav';
import { ThemeToggle } from '@/components/ui/theme';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="TalentOS home">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">TalentOS</span>
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
