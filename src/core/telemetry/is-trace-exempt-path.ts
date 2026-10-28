import { isPressureExemptPath } from '@/core/overload/is-pressure-exempt-path';

/** ALB / Terminus probes — no X-Ray or OTel SERVER spans (see Global Constraints). */
export function isTraceExemptPath(url: string): boolean {
  return isPressureExemptPath(url);
}
