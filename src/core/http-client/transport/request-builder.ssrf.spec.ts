import { buildUrl } from './request-builder';

describe('request-builder SSRF (assertPublicHttpUrl)', () => {
  const previous = process.env.HTTP_CLIENT_ALLOW_PRIVATE_URLS;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.HTTP_CLIENT_ALLOW_PRIVATE_URLS;
    } else {
      process.env.HTTP_CLIENT_ALLOW_PRIVATE_URLS = previous;
    }
  });

  it('rejects private baseUrl when private URLs are not allowed', () => {
    delete process.env.HTTP_CLIENT_ALLOW_PRIVATE_URLS;
    expect(() =>
      buildUrl({
        baseUrl: 'http://127.0.0.1:9/',
        url: '/x',
      }),
    ).toThrow(/private|reserved|not allowed/i);
  });

  it('rejects metadata host baseUrl', () => {
    delete process.env.HTTP_CLIENT_ALLOW_PRIVATE_URLS;
    expect(() =>
      buildUrl({
        baseUrl: 'http://169.254.169.254/',
        url: '/latest/meta-data',
      }),
    ).toThrow(/not allowed|private|reserved/i);
  });

  it('allows private baseUrl when HTTP_CLIENT_ALLOW_PRIVATE_URLS=true', () => {
    process.env.HTTP_CLIENT_ALLOW_PRIVATE_URLS = 'true';
    expect(
      buildUrl({
        baseUrl: 'http://127.0.0.1:9/',
        url: '/x',
      }),
    ).toBe('http://127.0.0.1:9/x');
  });

  it('allows public https baseUrl without the private flag', () => {
    delete process.env.HTTP_CLIENT_ALLOW_PRIVATE_URLS;
    expect(
      buildUrl({
        baseUrl: 'https://api.example.com/',
        url: '/v1/items',
      }),
    ).toBe('https://api.example.com/v1/items');
  });
});
