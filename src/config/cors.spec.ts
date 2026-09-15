import { originMatcher, parseAllowedOrigins } from './cors';

describe('parseAllowedOrigins', () => {
  it('splits on commas and drops blanks', () => {
    expect(
      parseAllowedOrigins(' https://a.example ,, https://b.example '),
    ).toEqual(['https://a.example', 'https://b.example']);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});

describe('originMatcher', () => {
  const allow = originMatcher([
    'https://memory.dave.com.et',
    'https://planner-web-*.vercel.app',
    'http://localhost:3000',
  ]);

  it('matches exact origins only exactly', () => {
    expect(allow('https://memory.dave.com.et')).toBe(true);
    expect(allow('http://memory.dave.com.et')).toBe(false);
    expect(allow('https://memory.dave.com.et.evil.example')).toBe(false);
    expect(allow('http://localhost:3000')).toBe(true);
    expect(allow('http://localhost:3001')).toBe(false);
  });

  it('lets * stand for one or more labels within the host', () => {
    expect(allow('https://planner-web-git-main-dave.vercel.app')).toBe(true);
    expect(allow('https://planner-web-abc123-dave.vercel.app')).toBe(true);
    expect(allow('https://planner-web-.vercel.app')).toBe(false);
  });

  it('never lets * cross a scheme, port or path boundary', () => {
    expect(allow('http://planner-web-x.vercel.app')).toBe(false);
    expect(allow('https://planner-web-x.vercel.app:8443')).toBe(false);
    expect(allow('https://planner-web-x.vercel.app.evil.example')).toBe(false);
    expect(allow('https://evil.example/planner-web-x.vercel.app')).toBe(false);
  });

  it('passes requests with no Origin header through', () => {
    expect(allow(undefined)).toBe(true);
  });

  it('escapes regex metacharacters in the literal parts', () => {
    const dots = originMatcher(['https://*.dave.com.et']);
    expect(dots('https://memory.dave.com.et')).toBe(true);
    expect(dots('https://memoryXdaveXcomXet')).toBe(false);
  });
});
