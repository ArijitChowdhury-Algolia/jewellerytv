module.exports = {
  forbidden: [
    {
      name: 'no-shared-to-runtime',
      severity: 'error',
      comment: 'Shared contracts stay independent of server and browser runtime modules.',
      from: { path: '^shared' },
      to: { path: '^(server|src|api)' },
    },
    {
      name: 'no-server-to-browser',
      severity: 'error',
      comment: 'Server handlers must not import browser UI modules.',
      from: { path: '^server' },
      to: { path: '^(src)' },
    },
    {
      name: 'no-browser-to-server',
      severity: 'error',
      comment: 'Browser UI calls only declared client tools and transport boundaries.',
      from: { path: '^src' },
      to: { path: '^(server|api)' },
    },
    {
      name: 'no-concierge-runtime-bypass',
      severity: 'error',
      comment:
        'Pure Concierge contracts cannot depend on React, browser, network, model, or runtime layers.',
      from: { path: '^shared/concierge' },
      to: { path: '^(src|server|api|tests|react|react-dom|node:)' },
    },
    {
      name: 'no-generated-or-archived-dependencies',
      severity: 'error',
      comment:
        'Generated data and archived evidence never participate in runtime dependency graphs.',
      from: { path: '^(src|server|shared|tests)' },
      to: { path: '(^|/)(evaluation|archive|archived|runs|evidence)(/|$)' },
    },
  ],
  options: {
    doNotFollow: {
      path: '(^|/)(node_modules|evaluation|archive|archived|runs|evidence)(/|$)',
    },
    exclude: '(^|/)(node_modules|evaluation|archive|archived|runs|evidence)(/|$)',
    tsConfig: { fileName: 'tsconfig.json' },
    includeOnly: '^((server|shared|src|tests/concierge)/)',
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
    },
  },
};
