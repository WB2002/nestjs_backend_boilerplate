import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createMetricsLogger, Unit } from 'aws-embedded-metrics';
import type { CountryAccessPersistenceProvider } from '../domain';

const INACTIVE_BYPASS_COOLDOWN_MS = 60_000;

@Injectable()
export class CountryAccessTelemetry {
  private readonly logger = new Logger(CountryAccessTelemetry.name);
  private lastInactiveBypassEmittedAtMs = 0;

  constructor(@Optional() private readonly configService?: ConfigService) {}

  async emit(
    event: string,
    properties: Record<string, string | number | boolean>,
  ): Promise<void> {
    this.logger.log({
      event,
      ...properties,
    });

    if (!this.isMetricsEnabled()) {
      return;
    }

    // Fire-and-forget so EMF flushing never blocks the HTTP request hot path.
    void this.flushMetric(event, properties);
  }

  private async flushMetric(
    event: string,
    properties: Record<string, string | number | boolean>,
  ): Promise<void> {
    try {
      const metrics = createMetricsLogger();
      metrics.setNamespace('CountryAccess');
      metrics.putDimensions({ Event: event });
      metrics.putMetric(event, 1, Unit.Count);
      for (const [key, value] of Object.entries(properties)) {
        metrics.setProperty(key, value);
      }
      await metrics.flush();
    } catch (err) {
      this.logger.warn(
        `Failed to emit country-access metric ${event}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private isMetricsEnabled(): boolean {
    const raw =
      this.configService?.get<string>('APP_METRICS_ENABLED') ??
      process.env.APP_METRICS_ENABLED;
    if (raw == null || raw === '') {
      return true;
    }
    const normalized = raw.trim().toLowerCase();
    return normalized !== 'false' && normalized !== '0';
  }

  accessDenied(countryCode: string | null, reason: string): Promise<void> {
    return this.emit('country_access_denied', {
      countryCode: countryCode ?? 'unknown',
      reason,
    });
  }

  invalidIp(): Promise<void> {
    return this.emit('country_access_invalid_ip', {});
  }

  unknownCountry(reason: string): Promise<void> {
    return this.emit('country_access_unknown_country', { reason });
  }

  geoIpFailure(reason: string): Promise<void> {
    return this.emit('country_access_geoip_failure', { reason });
  }

  inactiveBypass(): Promise<void> {
    const nowMs = Date.now();
    if (
      this.lastInactiveBypassEmittedAtMs > 0 &&
      nowMs - this.lastInactiveBypassEmittedAtMs < INACTIVE_BYPASS_COOLDOWN_MS
    ) {
      return Promise.resolve();
    }
    this.lastInactiveBypassEmittedAtMs = nowMs;
    return this.emit('country_access_inactive_bypass', {});
  }

  refreshSuccess(input: {
    provider: CountryAccessPersistenceProvider;
    snapshotVersion: number;
    allowedCount: number;
    lastSuccessfulRefreshAt: string;
  }): Promise<void> {
    return this.emit('country_access_refresh_success', input);
  }

  refreshFailure(
    provider: CountryAccessPersistenceProvider,
    reason: string,
  ): Promise<void> {
    return this.emit('country_access_refresh_failure', {
      provider,
      reason,
    });
  }
}
