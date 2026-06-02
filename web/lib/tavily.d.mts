export function tavilySearch(
  book: string,
  query: string
): Promise<{ context: string; configured: boolean }>;

export function isBookBackgroundRequest(text: string): boolean;
