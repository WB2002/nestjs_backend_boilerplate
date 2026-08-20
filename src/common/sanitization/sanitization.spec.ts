import { sanitizeHtmlString } from './utils/sanitize-html.utils';
import { looksLikeSqlInjection } from './utils/sql-injection.utils';
import { assertPublicHttpUrl, UnsafeUrlError } from './utils/ssrf.utils';
import { walkAndSanitize } from './utils/sanitization.utils';
import { BadRequestException } from '@nestjs/common';
import {
  SafeUrl,
  SkipSanitization,
  SkipSqlInjectionCheck,
} from './decorators';

describe('sanitizeHtmlString', () => {
  it('strips script and tags by default', () => {
    expect(sanitizeHtmlString('<script>alert(1)</script>hi')).toBe('hi');
    expect(sanitizeHtmlString('<b>bold</b>')).toBe('bold');
  });

  it('allows configured tags when provided', () => {
    expect(
      sanitizeHtmlString('<b>bold</b>', {
        allowedTags: ['b'],
        allowedAttributes: {},
      }),
    ).toBe('<b>bold</b>');
  });
});

describe('looksLikeSqlInjection', () => {
  it('flags classic injection payloads', () => {
    expect(looksLikeSqlInjection("' OR 1=1 --")).toBe(true);
    expect(looksLikeSqlInjection('1; DROP TABLE users')).toBe(true);
    expect(looksLikeSqlInjection('UNION SELECT password FROM users')).toBe(
      true,
    );
  });

  it('allows normal text', () => {
    expect(looksLikeSqlInjection('hello world')).toBe(false);
    expect(looksLikeSqlInjection('user@example.com')).toBe(false);
    expect(looksLikeSqlInjection("it's fine")).toBe(false);
  });
});

describe('assertPublicHttpUrl', () => {
  it('accepts public https URLs', () => {
    const url = assertPublicHttpUrl('https://example.com/path');
    expect(url.hostname).toBe('example.com');
  });

  it('rejects localhost and private IPs', () => {
    expect(() => assertPublicHttpUrl('http://127.0.0.1/')).toThrow(
      UnsafeUrlError,
    );
    expect(() => assertPublicHttpUrl('http://10.0.0.5/x')).toThrow(
      UnsafeUrlError,
    );
    expect(() => assertPublicHttpUrl('http://192.168.1.1/')).toThrow(
      UnsafeUrlError,
    );
    expect(() => assertPublicHttpUrl('http://169.254.169.254/latest')).toThrow(
      UnsafeUrlError,
    );
  });

  it('rejects IPv4-mapped IPv6 loopback and private forms', () => {
    expect(() => assertPublicHttpUrl('http://[::ffff:127.0.0.1]/')).toThrow(
      UnsafeUrlError,
    );
    expect(() => assertPublicHttpUrl('http://[::ffff:7f00:1]/')).toThrow(
      UnsafeUrlError,
    );
    expect(() => assertPublicHttpUrl('http://[::ffff:10.0.0.1]/')).toThrow(
      UnsafeUrlError,
    );
    expect(() => assertPublicHttpUrl('http://[::ffff:0a00:1]/')).toThrow(
      UnsafeUrlError,
    );
  });

  it('rejects localhost FQDN, IPv4-compatible IPv6, multicast, and 6to4', () => {
    expect(() => assertPublicHttpUrl('http://localhost./')).toThrow(
      UnsafeUrlError,
    );
    expect(() => assertPublicHttpUrl('http://[::127.0.0.1]/')).toThrow(
      UnsafeUrlError,
    );
    expect(() => assertPublicHttpUrl('http://[::7f00:1]/')).toThrow(
      UnsafeUrlError,
    );
    expect(() => assertPublicHttpUrl('http://[ff02::1]/')).toThrow(
      UnsafeUrlError,
    );
    expect(() => assertPublicHttpUrl('http://[2002:7f00:1::]/')).toThrow(
      UnsafeUrlError,
    );
  });

  it('rejects credentials and non-http schemes', () => {
    expect(() =>
      assertPublicHttpUrl('https://user:pass@example.com/'),
    ).toThrow(UnsafeUrlError);
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow(
      UnsafeUrlError,
    );
  });
});

describe('walkAndSanitize', () => {
  it('sanitizes nested strings and skips password', async () => {
    const result = (await walkAndSanitize({
      name: '<b>Ada</b>',
      password: '<script>x</script>',
      nested: { bio: '<img src=x onerror=alert(1)>' },
    })) as Record<string, unknown>;

    expect(result.name).toBe('Ada');
    expect(result.password).toBe('<script>x</script>');
    expect((result.nested as { bio: string }).bio).toBe('');
  });

  it('rejects SQL injection in strings', async () => {
    await expect(walkAndSanitize({ q: "' OR 1=1 --" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('honors nested DTO metadata for SkipSanitization and SafeUrl', async () => {
    class NestedDto {
      @SkipSanitization()
      declare secret: string;

      @SafeUrl()
      declare link: string;
    }

    class ParentDto {
      declare nested: NestedDto;
    }

    const nested = Object.assign(new NestedDto(), {
      secret: '<script>keep</script>',
      link: 'https://8.8.8.8/path',
    });
    const parent = Object.assign(new ParentDto(), { nested });

    const result = (await walkAndSanitize(parent, {
      metadataTarget: ParentDto.prototype,
    })) as ParentDto;

    expect(result.nested.secret).toBe('<script>keep</script>');
    expect(result.nested.link).toBe('https://8.8.8.8/path');

    await expect(
      walkAndSanitize(
        Object.assign(new ParentDto(), {
          nested: Object.assign(new NestedDto(), {
            secret: 'x',
            link: 'http://127.0.0.1/',
          }),
        }),
        { metadataTarget: ParentDto.prototype },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('skips only SQLi when SkipSqlInjectionCheck is set', async () => {
    class DocDto {
      @SkipSqlInjectionCheck()
      declare notes: string;
    }

    const dto = Object.assign(new DocDto(), {
      notes: '<b>union</b> of sets -- chapter',
    });
    const result = (await walkAndSanitize(dto, {
      metadataTarget: DocDto.prototype,
    })) as DocDto;
    // HTML stripped, SQLi not rejected
    expect(result.notes).toBe('union of sets -- chapter');
  });
});
