import { afterEach, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  readFileSync: () => 'ALGOLIA_APP_ID=fixture-app\nALGOLIA_SEARCH_API_KEY=fixture-key\n',
}));

import { assertAgentIdentityBoundary, loadConfig } from '../server/config.js';

afterEach(() => vi.unstubAllEnvs());

it('allows catalogue startup without Agent Studio identities', () => {
  vi.stubEnv('NODE_ENV', 'development');
  const config = loadConfig();
  expect(config.developmentAgentId).toBeUndefined();
  expect(config.productionAgentId).toBeUndefined();
});

it('does not substitute the development identity in production', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('JTV_CONCIERGE_DEVELOPMENT_AGENT_ID', 'development-agent');
  const config = loadConfig();
  expect(config.productionAgentId).toBeUndefined();
});

it('rejects malformed identities while allowing the same published agent in both environments', () => {
  expect(() =>
    assertAgentIdentityBoundary({
      developmentAgentId: 'invalid id',
      productionAgentId: undefined,
      environment: 'development',
    }),
  ).toThrow('valid Agent Studio identity');
  expect(() =>
    assertAgentIdentityBoundary({
      developmentAgentId: 'same-agent',
      productionAgentId: 'same-agent',
      environment: 'development',
    }),
  ).not.toThrow();
});
