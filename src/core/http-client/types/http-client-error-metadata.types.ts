export interface HttpClientErrorMetadata {
    serviceName?: string;
    kind?: 'internal' | 'external';
    method?: string;
    url?: string;
    status?: number;
    attempt?: number;
    attempts?: number;
    requestId?: string;
    headers?: Record<string, string>;
    [key: string]: unknown;
  }