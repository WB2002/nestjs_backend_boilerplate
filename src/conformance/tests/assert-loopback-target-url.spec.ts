import { BadRequestException } from '@nestjs/common';
import { assertLoopbackTargetUrl } from '../assert-loopback-target-url';

describe('assertLoopbackTargetUrl', () => {
  it('accepts loopback 127.0.0.1 url with port and path', () => {
    const parsedUrl = assertLoopbackTargetUrl('http://127.0.0.1:4010/x');
    expect(parsedUrl).toBeInstanceOf(URL);
    expect(parsedUrl.href).toBe('http://127.0.0.1:4010/x');
  });

  it('accepts loopback localhost url with port and path', () => {
    const parsedUrl = assertLoopbackTargetUrl('http://localhost:4010/x');
    expect(parsedUrl).toBeInstanceOf(URL);
    expect(parsedUrl.href).toBe('http://localhost:4010/x');
  });

  it('rejects https protocol on localhost', () => {
    expect(() => assertLoopbackTargetUrl('https://localhost/x')).toThrow(
      BadRequestException,
    );
    expect(() => assertLoopbackTargetUrl('https://localhost/x')).toThrow(
      'targetUrl must be http://127.0.0.1 or http://localhost',
    );
  });

  it('rejects domain suffix bypass attempt', () => {
    expect(() =>
      assertLoopbackTargetUrl('http://127.0.0.1.evil.test/x'),
    ).toThrow(BadRequestException);
  });

  it('rejects IPv6 loopback [::1]', () => {
    expect(() => assertLoopbackTargetUrl('http://[::1]:4010/x')).toThrow(
      BadRequestException,
    );
  });

  it('rejects url with userinfo credentials', () => {
    expect(() => assertLoopbackTargetUrl('http://user@127.0.0.1/x')).toThrow(
      BadRequestException,
    );
  });

  it('rejects AWS metadata ip 169.254.169.254', () => {
    expect(() => assertLoopbackTargetUrl('http://169.254.169.254/')).toThrow(
      BadRequestException,
    );
  });

  it('rejects file protocol scheme', () => {
    expect(() => assertLoopbackTargetUrl('file:///etc/passwd')).toThrow(
      BadRequestException,
    );
  });

  it('rejects unparseable non-url string', () => {
    expect(() => assertLoopbackTargetUrl('not a url')).toThrow(
      BadRequestException,
    );
  });
});
