import { Injectable, Logger } from '@nestjs/common';
import { createMetricsLogger, Unit } from 'aws-embedded-metrics';
import type { CountryAccessPersistenceProvider } from '../domain';

@Injectable()
export class CountryAccessTelemetry {
  private readonly logger = new Logger(CountryAccessTelemetry.name);

  async emit(
    event: string,
    properties: Record<string, string | number | boolean>,
  ): Promise<void> {
    this.logger.log({
      event,
      ...properties,
    });

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
