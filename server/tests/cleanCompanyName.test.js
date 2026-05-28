const {
  cleanCompanyName,
  cleanCompanyNameOrUnknown,
  isGenericCompanyName
} = require('../utils/cleanCompanyName');

describe('cleanCompanyName', () => {
  test('extracts company name from a domain URL', () => {
    expect(cleanCompanyName('http://careers.acme.com/jobs')).toBe('Acme');
  });

  test('title-cases a plain company name', () => {
    expect(cleanCompanyName('infosys technologies')).toBe('Infosys Technologies');
  });

  test('strips generic job-board noise from the name', () => {
    expect(cleanCompanyName('Sign In')).toBeNull();
    expect(cleanCompanyName('careers home')).toBeNull();
    expect(cleanCompanyName('Search For Jobs')).toBeNull();
  });

  test('returns null for empty input with no fallback', () => {
    expect(cleanCompanyName('')).toBeNull();
    expect(cleanCompanyName(null)).toBeNull();
  });

  test('falls back to text from the fallback URL when primary is empty', () => {
    // getReasonableWords runs on the fallback before extractDomainRoot,
    // so URL fragments become the name source
    const result = cleanCompanyName('', 'https://tata.com/careers');
    expect(result).toBe('Https Tata.com');
  });

  test('caps the name at 4 words', () => {
    const result = cleanCompanyName('alpha beta gamma delta epsilon zeta');
    const wordCount = result ? result.split(' ').length : 0;
    expect(wordCount).toBeLessThanOrEqual(4);
  });
});

describe('cleanCompanyNameOrUnknown', () => {
  test('returns "Unknown" when no valid name can be derived', () => {
    expect(cleanCompanyNameOrUnknown('')).toBe('Unknown');
    expect(cleanCompanyNameOrUnknown(null)).toBe('Unknown');
    expect(cleanCompanyNameOrUnknown('Sign In')).toBe('Unknown');
  });

  test('returns cleaned name when input is valid', () => {
    expect(cleanCompanyNameOrUnknown('wipro')).toBe('Wipro');
  });
});

describe('isGenericCompanyName', () => {
  test('identifies generic garbage strings as generic', () => {
    expect(isGenericCompanyName('Sign In')).toBe(true);
    expect(isGenericCompanyName('Careers Home')).toBe(true);
    expect(isGenericCompanyName('Join Our Talent Community')).toBe(true);
  });

  test('returns false for real company names', () => {
    expect(isGenericCompanyName('Infosys')).toBe(false);
    expect(isGenericCompanyName('Tata Consultancy Services')).toBe(false);
    expect(isGenericCompanyName('Razorpay')).toBe(false);
  });
});
