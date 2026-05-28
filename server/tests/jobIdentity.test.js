const { normalizeApplyLink, buildJobIdentity, normalizeJobText } = require('../utils/jobIdentity');

describe('normalizeApplyLink', () => {
  test('strips query params and hash', () => {
    expect(normalizeApplyLink('https://example.com/jobs/123?ref=google#apply'))
      .toBe('https://example.com/jobs/123');
  });

  test('lowercases the full URL', () => {
    expect(normalizeApplyLink('https://Example.COM/Jobs/123'))
      .toBe('https://example.com/jobs/123');
  });

  test('removes www prefix from hostname', () => {
    expect(normalizeApplyLink('https://www.example.com/jobs/123'))
      .toBe('https://example.com/jobs/123');
  });

  test('removes trailing slash from path', () => {
    expect(normalizeApplyLink('https://example.com/jobs/123/'))
      .toBe('https://example.com/jobs/123');
  });

  test('returns null for empty or null input', () => {
    expect(normalizeApplyLink('')).toBeNull();
    expect(normalizeApplyLink(null)).toBeNull();
  });

  test('handles malformed URLs gracefully without throwing', () => {
    expect(() => normalizeApplyLink('not-a-url')).not.toThrow();
  });

  test('two URLs that differ only by query param produce the same canonical link', () => {
    const a = normalizeApplyLink('https://lever.co/company/job-123?lever-origin=applied');
    const b = normalizeApplyLink('https://lever.co/company/job-123');
    expect(a).toBe(b);
  });
});

describe('normalizeJobText', () => {
  test('lowercases text', () => {
    expect(normalizeJobText('Senior React Developer')).toBe('senior react developer');
  });

  test('replaces special characters with spaces and collapses whitespace', () => {
    expect(normalizeJobText('C++ / Rust Engineer')).toBe('c rust engineer');
  });

  test('collapses multiple spaces into one', () => {
    expect(normalizeJobText('Bangalore,  India')).toBe('bangalore india');
  });

  test('returns empty string for null/undefined', () => {
    expect(normalizeJobText(null)).toBe('');
    expect(normalizeJobText(undefined)).toBe('');
  });
});

describe('buildJobIdentity', () => {
  test('normalizes title and location', () => {
    const identity = buildJobIdentity({
      title:    'Senior React Developer',
      location: 'Bangalore, India',
      applyLink: 'https://example.com/jobs/1'
    });
    expect(identity.normalizedTitle).toBe('senior react developer');
    expect(identity.normalizedLocation).toBe('bangalore india');
    expect(identity.canonicalApplyLink).toBe('https://example.com/jobs/1');
  });

  test('defaults location to "india" when null', () => {
    const identity = buildJobIdentity({ title: 'Engineer', location: null, applyLink: null });
    expect(identity.normalizedLocation).toBe('india');
  });

  test('canonicalApplyLink is null for missing applyLink', () => {
    const identity = buildJobIdentity({ title: 'Engineer', location: 'Mumbai', applyLink: '' });
    expect(identity.canonicalApplyLink).toBeNull();
  });
});
