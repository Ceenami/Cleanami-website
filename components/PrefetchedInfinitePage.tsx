import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from '@tanstack/react-query';

export async function PrefetchedInfinitePage<TData = any>({
  queryKey,
  queryFn,
  getNextPageParam = (lastPage: any) => lastPage.nextPage,
  initialPageParam = 1,
  children,
}: {
  
  queryKey: unknown[];
  queryFn: () => Promise<TData>;
  getNextPageParam?: (lastPage: TData) => number | undefined | null;
  initialPageParam?: number;
  children: React.ReactNode;
}) {
  const queryClient = new QueryClient();

  await queryClient.prefetchInfiniteQuery({
    queryKey,
    queryFn,
    initialPageParam,
    getNextPageParam,
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {children}
    </HydrationBoundary>
  );
}