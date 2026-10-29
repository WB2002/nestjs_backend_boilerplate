import { parseBackgroundJobsConfig } from '../parse-background-jobs-config';

describe('parseBackgroundJobsConfig', () => {
  it('requires Postgres when jobs are enabled', () => {
    expect(() =>
      parseBackgroundJobsConfig({
        BACKGROUND_JOBS_ENABLED: 'true',
        POSTGRES_DB: '',
        POSTGRES_HOST: 'localhost',
        POSTGRES_USER: 'u',
        POSTGRES_PASSWORD: 'p',
        POSTGRES_PORT: '5432',
      }),
    ).toThrow(/POSTGRES_DB/);
  });

  it('defaults worker off and queue name to default', () => {
    const cfg = parseBackgroundJobsConfig({
      BACKGROUND_JOBS_ENABLED: 'false',
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.workerEnabled).toBe(false);
    expect(cfg.defaultQueueName).toBe('default');
    expect(cfg.claimLeaseSec).toBe(300);
    expect(cfg.workerConcurrency).toBe(5);
  });

  it('defaults lease reclaim on with interval and batch size', () => {
    const cfg = parseBackgroundJobsConfig({
      BACKGROUND_JOBS_ENABLED: 'true',
      POSTGRES_DB: 'app',
      POSTGRES_HOST: 'localhost',
      POSTGRES_USER: 'u',
      POSTGRES_PASSWORD: 'p',
      POSTGRES_PORT: '5432',
    });
    expect(cfg.leaseReclaimEnabled).toBe(true);
    expect(cfg.leaseReclaimIntervalMs).toBe(30_000);
    expect(cfg.leaseReclaimBatchSize).toBe(100);
  });

  it('allows disabling lease reclaim explicitly', () => {
    const cfg = parseBackgroundJobsConfig({
      BACKGROUND_JOBS_ENABLED: 'true',
      POSTGRES_DB: 'app',
      BACKGROUND_JOBS_LEASE_RECLAIM_ENABLED: 'false',
    });
    expect(cfg.leaseReclaimEnabled).toBe(false);
  });
});
