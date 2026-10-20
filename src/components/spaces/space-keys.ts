// TanStack Query keys for spaces, courses and offerings (shared by the registry screens).
export const spaceKeys = {
  all: ['spaces'] as const,
  list: (params: Record<string, unknown>) => ['spaces', 'list', params] as const,
  detail: (id: string) => ['spaces', 'detail', id] as const,
};

export const courseKeys = {
  all: ['courses'] as const,
  list: (params: Record<string, unknown>) => ['courses', 'list', params] as const,
  detail: (id: string) => ['courses', 'detail', id] as const,
};

export const offeringKeys = {
  all: ['offerings'] as const,
  list: (params: Record<string, unknown>) => ['offerings', 'list', params] as const,
  detail: (id: string) => ['offerings', 'detail', id] as const,
};
