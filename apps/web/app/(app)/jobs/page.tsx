import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { getJobsData } from '@/lib/queries';

import { JobsDashboard } from './jobs-dashboard';

export const metadata = { title: 'Jobs · VividPages' };

// Pipeline state changes constantly; never serve a stale shelf of jobs.
export const dynamic = 'force-dynamic';

/**
 * The Jobs dashboard — a cross-book operations view: active runs (live),
 * recent run history with durations + token tallies, failed images to retry,
 * and a rough LLM cost summary. The server component loads the initial
 * snapshot directly from the database; the client component layers live
 * polling + retry actions on top.
 */
export default async function JobsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/login');

  const data = await getJobsData(userId);

  return (
    <div className="space-y-10">
      <header>
        <p className="font-display text-xs uppercase tracking-[0.3em] text-ember-400/70">
          Operations
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-parchment">Jobs</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-400">
          Every pipeline run across your library — what&rsquo;s working now, what finished, and
          anything that needs another pass.
        </p>
      </header>

      <JobsDashboard initialData={data} />
    </div>
  );
}
