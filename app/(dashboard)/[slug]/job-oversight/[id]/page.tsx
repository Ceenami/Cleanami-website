import { notFound, redirect } from 'next/navigation';
import { JobDetailsClient } from '@/components/dashbboard/admin/job-oversight/JobDetailPage';
import { PrefetchedPage } from '@/components/PrefetchedPage';
import { getJobDetails } from '@/lib/queries/jobs';
import { getSessionRole } from '@/lib/auth/server-roles';
import { customerOwnsJob, getCustomerAuth } from '@/lib/customer-auth';

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;

  // This page is shared between the admin portal and the customer portal, and
  // it prefetches the FULL job on the server. Without the checks below a
  // customer could open /customer/job-oversight/<any job id> and receive
  // another customer's address, cleaner and signed evidence photos in the SSR
  // payload — the API route guards itself, but an SSR prefetch never goes
  // through it. Authorize here, before the query runs.
  //
  // The role is resolved from `users.role`, never from the URL prefix: a
  // customer who typed the admin slug must still be scoped as a customer.
  const userRole = await getSessionRole();
  const isAdmin = userRole === 'admin' || userRole === 'super_admin';
  const isCustomer = userRole === 'user';

  if (!isAdmin && !isCustomer) {
    redirect('/sign-in');
  }

  if (!isAdmin) {
    const { customerId, error } = await getCustomerAuth();
    if (!customerId) {
      redirect(
        `/?portalBlocked=1&message=${encodeURIComponent(
          error ?? 'Portal unavailable'
        )}`
      );
    }

    // notFound() rather than a 403 — a customer has no business learning
    // whether a job id they do not own exists.
    if (!(await customerOwnsJob(customerId, id))) {
      notFound();
    }
  }

  return (
    <PrefetchedPage
      queryKey={['job-details', id]}
      queryFn={() => getJobDetails(id)}
    >
      <JobDetailsClient jobId={id} isAdmin={isAdmin} />
    </PrefetchedPage>
  );
}
