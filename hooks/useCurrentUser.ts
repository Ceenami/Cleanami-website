import { createClient } from '@/lib/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';

export function useCurrentUser() {
  const queryClient = useQueryClient();

  React.useEffect(() => {
    const setupAuthListener = async () => {
      const supabase = await createClient();
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          queryClient.setQueryData(['user'], null);
        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          queryClient.invalidateQueries({ queryKey: ['user'] });
        }
      });

      return () => subscription.unsubscribe();
    };

    const unsubscribe = setupAuthListener();
    return () => {
      unsubscribe.then(cleanup => cleanup?.());
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ['user'],
    queryFn: async () => {
      const supabase = await createClient();
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      
      if (!user) return null;

      const { data: userData } = await supabase
        .from('users')
        .select('*')
        .eq('supabase_user_id', user.id)
        .maybeSingle();

      return {
        ...user,
        profile: userData ?? null,
      };
    },
    staleTime: 1000 * 60 * 5,
  });
}