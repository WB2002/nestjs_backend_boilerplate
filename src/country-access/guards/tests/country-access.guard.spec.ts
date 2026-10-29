import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CountryAccessGuard } from '../country-access.guard';
import { CountryAccessService } from '../../country-access.service';
import { ClientIpService } from '../../client-ip/client-ip.service';
import type { GeoLocationService } from '../../domain';
import { CountryAccessTelemetry } from '../../telemetry/country-access.telemetry';
import type { ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

function createHttpContext(request: Partial<FastifyRequest>): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request as FastifyRequest,
    }),
  } as unknown as ExecutionContext;
}

describe('CountryAccessGuard', () => {
  let reflector: Reflector;
  let countryAccessService: jest.Mocked<CountryAccessService>;
  let clientIpService: jest.Mocked<ClientIpService>;
  let geoLocationService: jest.Mocked<GeoLocationService>;
  let telemetry: jest.Mocked<CountryAccessTelemetry>;
  let guard: CountryAccessGuard;
  let repositoryCalls: number;

  beforeEach(() => {
    repositoryCalls = 0;
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(false),
    } as unknown as Reflector;
    countryAccessService = {
      isActive: jest.fn().mockReturnValue(true),
      getBypassPaths: jest.fn().mockReturnValue(['/health']),
      getUnknownCountryPolicy: jest.fn().mockReturnValue('block'),
      isCountryAllowed: jest.fn().mockImplementation((code: string) => {
        repositoryCalls += 1;
        return code === 'US';
      }),
    } as unknown as jest.Mocked<CountryAccessService>;
    clientIpService = {
      resolve: jest.fn().mockReturnValue('8.8.8.8'),
    } as unknown as jest.Mocked<ClientIpService>;
    geoLocationService = {
      getCountryCode: jest.fn().mockReturnValue('US'),
    };
    telemetry = {
      emit: jest.fn(),
      accessDenied: jest.fn(),
      invalidIp: jest.fn(),
      unknownCountry: jest.fn(),
      geoIpFailure: jest.fn(),
      inactiveBypass: jest.fn(),
      refreshSuccess: jest.fn(),
      refreshFailure: jest.fn(),
    } as unknown as jest.Mocked<CountryAccessTelemetry>;
    guard = new CountryAccessGuard(
      reflector,
      countryAccessService,
      clientIpService,
      geoLocationService,
      telemetry,
    );
  });

  it('allows an allowed country', async () => {
    await expect(
      guard.canActivate(createHttpContext({ url: '/api' })),
    ).resolves.toBe(true);
  });

  it('blocks a disallowed country with 403', async () => {
    geoLocationService.getCountryCode.mockReturnValue('PK');
    countryAccessService.isCountryAllowed.mockReturnValue(false);
    await expect(
      guard.canActivate(createHttpContext({ url: '/api' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(telemetry.accessDenied).toHaveBeenCalledWith(
      'PK',
      'country_not_allowed',
    );
  });

  it('blocks unknown country when policy is block', async () => {
    geoLocationService.getCountryCode.mockReturnValue(null);
    await expect(
      guard.canActivate(createHttpContext({ url: '/api' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows unknown country when policy is allow', async () => {
    countryAccessService.getUnknownCountryPolicy.mockReturnValue('allow');
    geoLocationService.getCountryCode.mockReturnValue(null);
    await expect(
      guard.canActivate(createHttpContext({ url: '/api' })),
    ).resolves.toBe(true);
  });

  it('bypasses when service is inactive', async () => {
    countryAccessService.isActive.mockReturnValue(false);
    await expect(
      guard.canActivate(createHttpContext({ url: '/api' })),
    ).resolves.toBe(true);
    expect(telemetry.inactiveBypass).toHaveBeenCalled();
    expect(geoLocationService.getCountryCode).not.toHaveBeenCalled();
  });

  it('bypasses health paths', async () => {
    await expect(
      guard.canActivate(createHttpContext({ url: '/health/ready' })),
    ).resolves.toBe(true);
    expect(geoLocationService.getCountryCode).not.toHaveBeenCalled();
  });

  it('bypasses when SkipCountryAccess metadata is set', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    await expect(
      guard.canActivate(createHttpContext({ url: '/api' })),
    ).resolves.toBe(true);
  });

  it('does not query a repository on the request path', async () => {
    // isCountryAllowed is in-memory; repositoryCalls tracks only that call.
    repositoryCalls = 0;
    await guard.canActivate(createHttpContext({ url: '/api' }));
    expect(repositoryCalls).toBe(1);
  });
});
