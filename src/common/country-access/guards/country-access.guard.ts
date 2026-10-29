import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { FastifyRequest } from 'fastify';
import { GEO_LOCATION_SERVICE, SKIP_COUNTRY_ACCESS_KEY } from '../constants';
import { ClientIpService } from '../client-ip/client-ip.service';
import { CountryAccessService } from '../country-access.service';
import type { GeoLocationService } from '../domain';
import { CountryAccessTelemetry } from '../telemetry/country-access.telemetry';

@Injectable()
export class CountryAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly countryAccessService: CountryAccessService,
    private readonly clientIpService: ClientIpService,
    @Inject(GEO_LOCATION_SERVICE)
    private readonly geoLocationService: GeoLocationService,
    private readonly telemetry: CountryAccessTelemetry,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const shouldSkip = this.reflector.getAllAndOverride<boolean>(
      SKIP_COUNTRY_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (shouldSkip) {
      return true;
    }

    const request = this.getRequest(context);
    if (this.isBypassPath(request.url ?? request.raw?.url ?? '')) {
      return true;
    }

    if (!this.countryAccessService.isActive()) {
      await this.telemetry.inactiveBypass();
      return true;
    }

    const ip = this.clientIpService.resolve(request);
    if (!ip) {
      await this.telemetry.invalidIp();
      await this.telemetry.accessDenied(null, 'invalid_ip');
      throw new ForbiddenException('Country access denied');
    }

    const countryCode = this.geoLocationService.getCountryCode(ip);
    if (!countryCode) {
      if (this.countryAccessService.getUnknownCountryPolicy() === 'allow') {
        return true;
      }
      await this.telemetry.accessDenied(null, 'unknown_country');
      throw new ForbiddenException('Country access denied');
    }

    if (!this.countryAccessService.isCountryAllowed(countryCode)) {
      await this.telemetry.accessDenied(countryCode, 'country_not_allowed');
      throw new ForbiddenException('Country access denied');
    }

    return true;
  }

  private getRequest(context: ExecutionContext): FastifyRequest {
    if (context.getType<'http' | 'graphql'>() === 'graphql') {
      const gql = GqlExecutionContext.create(context);
      return gql.getContext().req as FastifyRequest;
    }
    return context.switchToHttp().getRequest<FastifyRequest>();
  }

  private isBypassPath(rawUrl: string): boolean {
    const path = rawUrl.split('?')[0] ?? '';
    return this.countryAccessService
      .getBypassPaths()
      .some((bypass) => path === bypass || path.startsWith(`${bypass}/`));
  }
}
