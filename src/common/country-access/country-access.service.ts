import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { COUNTRY_ACCESS_OPTIONS, COUNTRY_ACCESS_REPOSITORY } from './constants';
import type { CountryAccessModuleOptions } from './config/country-access.config';
import {
  assertCountryCode,
  type CountryAccessRepository,
  type CountryAccessServiceStatus,
  type UnknownCountryPolicy,
} from './domain';
import { CountryAccessTelemetry } from './telemetry/country-access.telemetry';

@Injectable()
export class CountryAccessService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(CountryAccessService.name);
  private allowedCountries: ReadonlySet<string> = new Set();
  private status: CountryAccessServiceStatus = 'inactive';
  private snapshotVersion = 0;
  private lastSuccessfulRefreshAt: Date | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshInFlight: Promise<void> | null = null;

  constructor(
    @Inject(COUNTRY_ACCESS_REPOSITORY)
    private readonly repository: CountryAccessRepository,
    @Inject(COUNTRY_ACCESS_OPTIONS)
    private readonly options: CountryAccessModuleOptions,
    private readonly telemetry: CountryAccessTelemetry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.refreshSnapshot();
    this.startPeriodicRefresh();
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  getStatus(): CountryAccessServiceStatus {
    return this.status;
  }

  isActive(): boolean {
    return this.status === 'active';
  }

  getUnknownCountryPolicy(): UnknownCountryPolicy {
    return this.options.unknownCountryPolicy;
  }

  getBypassPaths(): readonly string[] {
    return this.options.bypassPaths;
  }

  getSnapshotVersion(): number {
    return this.snapshotVersion;
  }

  getLastSuccessfulRefreshAt(): Date | null {
    return this.lastSuccessfulRefreshAt;
  }

  getPersistenceProvider(): CountryAccessModuleOptions['persistenceProvider'] {
    return this.options.persistenceProvider;
  }

  isCountryAllowed(countryCode: string): boolean {
    if (this.status !== 'active') {
      return true;
    }
    let normalized: string;
    try {
      normalized = assertCountryCode(countryCode);
    } catch {
      return this.options.unknownCountryPolicy === 'allow';
    }
    return this.allowedCountries.has(normalized);
  }

  getAllowedCountries(): ReadonlySet<string> {
    return this.allowedCountries;
  }

  async refreshSnapshot(): Promise<void> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.doRefresh();
    try {
      await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  private startPeriodicRefresh(): void {
    this.refreshTimer = setInterval(() => {
      void this.refreshSnapshot().catch((err) => {
        this.logger.error(
          `Unhandled country-access refresh error: ${err instanceof Error ? err.message : err}`,
        );
      });
    }, this.options.refreshIntervalMs);
    this.refreshTimer.unref?.();
  }

  private async doRefresh(): Promise<void> {
    try {
      const configs = await this.repository.getAll();
      const enabledCountryCodes = new Set<string>();
      for (const config of configs) {
        const code = assertCountryCode(config.countryCode);
        if (config.enabled) {
          enabledCountryCodes.add(code);
        }
      }

      const newSnapshot: ReadonlySet<string> = enabledCountryCodes;
      this.allowedCountries = newSnapshot;
      this.snapshotVersion += 1;
      this.lastSuccessfulRefreshAt = new Date();
      this.status = 'active';

      await this.telemetry.refreshSuccess({
        provider: this.options.persistenceProvider,
        snapshotVersion: this.snapshotVersion,
        allowedCount: newSnapshot.size,
        lastSuccessfulRefreshAt: this.lastSuccessfulRefreshAt.toISOString(),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Country-access refresh failed; retaining previous snapshot (status=${this.status}): ${reason}`,
      );
      await this.telemetry.refreshFailure(
        this.options.persistenceProvider,
        reason,
      );
      // Keep inactive on first failure; keep last-known-good when already active.
    }
  }
}
