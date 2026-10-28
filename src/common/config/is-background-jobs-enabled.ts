export function isBackgroundJobsEnabled(): boolean {
  return process.env.BACKGROUND_JOBS_ENABLED === 'true';
}
