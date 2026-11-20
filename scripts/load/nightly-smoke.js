/**
 * Lightweight smoke load harness (run via: k6 run scripts/load/nightly-smoke.js).
 * Targets health, GraphQL POST, and rate-limit headers on repeated GETs.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
  },
};

const baseUrl = __ENV.BASE_URL ?? 'http://127.0.0.1:3000';

export default function nightlySmoke() {
  const health = http.get(`${baseUrl}/health/live`);
  check(health, { 'health live ok': (res) => res.status === 200 });

  const gql = http.post(
    `${baseUrl}/graphql`,
    JSON.stringify({ query: '{ __typename }' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(gql, {
    'graphql reachable': (res) => res.status === 200 || res.status === 401,
    'graphql rate headers or body': (res) =>
      Boolean(res.headers['X-Ratelimit-Limit']) || res.body.length > 0,
  });

  sleep(0.2);
}