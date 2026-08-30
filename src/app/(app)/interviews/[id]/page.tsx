import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getInterviewView } from '@/lib/interview/history';
import { InterviewRoom } from '@/components/interview/room';

export const metadata: Metadata = { title: 'Interview room' };
export const dynamic = 'force-dynamic';

export default async function InterviewRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  const view = await getInterviewView(session.user.id, id);
  // getInterviewView is user-scoped, so an interview belonging to someone else
  // is indistinguishable from one that does not exist.
  if (!view) notFound();

  // A finished interview belongs on its report, not in the room.
  if (view.interview.status === 'completed') {
    redirect(`/interviews/${id}/report`);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <InterviewRoom
        interview={view.interview}
        currentQuestion={view.currentQuestion}
        history={view.history}
      />
    </div>
  );
}
