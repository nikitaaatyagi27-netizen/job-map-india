const { analyseSkillGap, extractSkillsFromText } = require('../services/skillGapService');

describe('extractSkillsFromText', () => {
  test('extracts React and TypeScript from plain text', () => {
    const skills = extractSkillsFromText('We use React and TypeScript in our stack');
    expect(skills.has('React')).toBe(true);
    expect(skills.has('TypeScript')).toBe(true);
  });

  test('extracts Node.js from alias "node"', () => {
    const skills = extractSkillsFromText('backend built with node and express');
    expect(skills.has('Node.js')).toBe(true);
  });

  test('does not match "go" inside "google"', () => {
    const skills = extractSkillsFromText('search powered by google for fast results');
    expect(skills.has('Go')).toBe(false);
  });

  test('returns empty set for empty input', () => {
    expect(extractSkillsFromText('').size).toBe(0);
    expect(extractSkillsFromText(null).size).toBe(0);
  });

  test('matches multiple skills in a job description', () => {
    const skills = extractSkillsFromText(
      'Looking for a backend engineer with PostgreSQL, Redis, and Docker experience'
    );
    expect(skills.has('PostgreSQL')).toBe(true);
    expect(skills.has('Redis')).toBe(true);
    expect(skills.has('Docker')).toBe(true);
  });
});

describe('analyseSkillGap', () => {
  test('returns 100% match when user has all required skills', () => {
    const result = analyseSkillGap({
      primarySkills:   ['React', 'Node.js'],
      secondarySkills: ['JavaScript'],
      jobTitle:        'React Node Developer',
      jobDescription:  'Requires React and nodejs experience'
    });
    expect(result.hasAnalysis).toBe(true);
    expect(result.matched).toContain('React');
    expect(result.matched).toContain('Node.js');
    expect(result.matchScore).toBe(100);
    expect(result.missing).toHaveLength(0);
  });

  test('reports missing skills the user does not have', () => {
    const result = analyseSkillGap({
      primarySkills:   ['React'],
      secondarySkills: [],
      jobTitle:        'Full Stack Developer',
      jobDescription:  'Must know React, PostgreSQL, and Docker'
    });
    expect(result.hasAnalysis).toBe(true);
    expect(result.matched).toContain('React');
    expect(result.missing).toContain('PostgreSQL');
    expect(result.missing).toContain('Docker');
    expect(result.matchScore).toBeLessThan(100);
  });

  test('returns hasAnalysis false when job text has no recognisable skills', () => {
    const result = analyseSkillGap({
      primarySkills:   ['React'],
      secondarySkills: [],
      jobTitle:        'Regional Sales Manager',
      jobDescription:  'Lead our sales team across the region'
    });
    expect(result.hasAnalysis).toBe(false);
    expect(result.matchScore).toBeNull();
    expect(result.matched).toHaveLength(0);
    expect(result.missing).toHaveLength(0);
  });

  test('handles empty skill arrays without throwing', () => {
    expect(() => analyseSkillGap({
      primarySkills:   [],
      secondarySkills: [],
      jobTitle:        'Engineer',
      jobDescription:  'React and Node.js required'
    })).not.toThrow();
  });

  test('works with title only (no description)', () => {
    const result = analyseSkillGap({
      primarySkills:   ['Python'],
      secondarySkills: [],
      jobTitle:        'Python Machine Learning Engineer',
      jobDescription:  null
    });
    expect(result.hasAnalysis).toBe(true);
    expect(result.matched.length + result.missing.length).toBeGreaterThan(0);
  });

  test('matchScore is between 0 and 100', () => {
    const result = analyseSkillGap({
      primarySkills:   ['React'],
      secondarySkills: ['JavaScript'],
      jobTitle:        'React Developer with AWS and Kubernetes',
      jobDescription:  'Must have React, aws, kubernetes'
    });
    if (result.matchScore !== null) {
      expect(result.matchScore).toBeGreaterThanOrEqual(0);
      expect(result.matchScore).toBeLessThanOrEqual(100);
    }
  });
});
