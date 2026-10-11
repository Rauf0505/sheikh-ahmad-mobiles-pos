import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function useIpcQuery<T>(key: string, channel: string, ...args: unknown[]) {
  return useQuery({
    queryKey: [key, ...args],
    queryFn: async () => {
      const result = await window.electronAPI.invoke(channel, ...args) as { success: boolean; data?: T; error?: string };
      if (!result.success) throw new Error(result.error);
      return result.data as T;
    },
  });
}

export function useIpcMutation<TData, TVariables>(
  channel: string,
  invalidateKey?: string | string[]
) {
  const queryClient = useQueryClient();

  return useMutation<TData, Error, TVariables>({
    mutationFn: async (variables: TVariables) => {
      const result = await window.electronAPI.invoke(channel, variables) as { success: boolean; data?: TData; error?: string };
      if (!result.success) throw new Error(result.error);
      return result.data as TData;
    },
    onSuccess: () => {
      if (invalidateKey) {
        const keys = Array.isArray(invalidateKey) ? invalidateKey : [invalidateKey];
        for (const key of keys) {
          queryClient.invalidateQueries({ queryKey: [key] });
        }
      }
    },
  });
}

export function useAuthMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pin: string) => {
      const result = await window.electronAPI.invoke('auth:login', pin) as {
        success: boolean;
        user?: { id: number; name: string; roleName: string };
        permissions?: Record<string, boolean>;
        error?: string;
      };
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
}
