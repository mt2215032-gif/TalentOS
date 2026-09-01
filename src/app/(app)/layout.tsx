import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getProvider } from '@/lib/ai';
import { AppShell } from '@/components/app/shell';

export const dynamic = 'force-dynamic';

/**
 * Authenticated area.
 *
 * The guard lives in the layout so every page beneath it is protected by
 * construction. An unauthenticated visitor is redirected before any page
 * component runs, so no data fetch is ever attempted without a session.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const provider = getProvider();

  return (
    <AppShell
      user={{
        email: session.user.email,
        role: session.user.role,
        plan: session.user.plan,
      }}
      engine={{ provider: provider.name, isLlm: provider.isLlm }}
    >
      {children}
    </AppShell>
  );
}
