export type CsrfModuleOptions = {
  enabled?: boolean;
  cookieName?: string;
  headerName?: string;
  exemptPaths?: readonly string[];
};
