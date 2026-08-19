import { describe, expect, it } from 'vitest';
import {
  acknowledgedAdvisories,
  advisoryIdFromUrl,
  extractAdvisories,
  partitionAdvisories,
} from '../audit-consumer-tree.mjs';

/** Shape mirrors a real `npm audit --json` report for the published tree. */
const sharpReport = {
  auditReportVersion: 2,
  vulnerabilities: {
    '@huggingface/transformers': {
      name: '@huggingface/transformers',
      severity: 'high',
      isDirect: true,
      // String via entries point at the culprit; they are not separate advisories.
      via: ['sharp'],
      effects: [],
      range: '*',
      fixAvailable: false,
    },
    sharp: {
      name: 'sharp',
      severity: 'high',
      isDirect: false,
      via: [
        {
          source: 1124066,
          name: 'sharp',
          dependency: 'sharp',
          title: 'sharp inherited vulnerabilities in libvips',
          url: 'https://github.com/advisories/GHSA-f88m-g3jw-g9cj',
          severity: 'high',
          range: '<0.35.0',
        },
      ],
      effects: ['@huggingface/transformers'],
      range: '<0.35.0',
      fixAvailable: false,
    },
  },
};

describe('advisoryIdFromUrl', () => {
  it('pulls the GHSA identifier out of an advisory URL', () => {
    expect(advisoryIdFromUrl('https://github.com/advisories/GHSA-f88m-g3jw-g9cj')).toBe(
      'GHSA-f88m-g3jw-g9cj',
    );
  });

  it('returns undefined when there is no identifier', () => {
    expect(advisoryIdFromUrl('https://example.com/nope')).toBeUndefined();
    expect(advisoryIdFromUrl(undefined)).toBeUndefined();
  });
});

describe('extractAdvisories', () => {
  it('collapses a report to one record per distinct advisory', () => {
    const advisories = extractAdvisories(sharpReport);
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toMatchObject({
      advisory: 'GHSA-f88m-g3jw-g9cj',
      package: 'sharp',
      severity: 'high',
    });
  });

  it('returns nothing for a clean report', () => {
    expect(extractAdvisories({ vulnerabilities: {} })).toEqual([]);
    expect(extractAdvisories(null)).toEqual([]);
  });
});

describe('partitionAdvisories', () => {
  it('treats the reviewed sharp advisory as acknowledged, not blocking', () => {
    const { blocking, stale } = partitionAdvisories(
      extractAdvisories(sharpReport),
      acknowledgedAdvisories,
    );
    expect(blocking).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('blocks an unacknowledged high advisory', () => {
    const advisories = [
      { advisory: 'GHSA-aaaa-bbbb-cccc', package: 'left-pad', severity: 'high', url: '' },
    ];
    const { blocking } = partitionAdvisories(advisories, []);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].package).toBe('left-pad');
  });

  it('ignores advisories below the threshold', () => {
    const advisories = [
      { advisory: 'GHSA-aaaa-bbbb-cccc', package: 'left-pad', severity: 'low', url: '' },
    ];
    expect(partitionAdvisories(advisories, []).blocking).toEqual([]);
  });

  it('does not let one package acknowledge another package advisory id', () => {
    const advisories = [
      { advisory: 'GHSA-f88m-g3jw-g9cj', package: 'not-sharp', severity: 'high', url: '' },
    ];
    const { blocking } = partitionAdvisories(advisories, acknowledgedAdvisories);
    expect(blocking).toHaveLength(1);
  });

  it('reports an acknowledgement that no longer matches anything as stale', () => {
    const { stale } = partitionAdvisories([], acknowledgedAdvisories);
    expect(stale.map((item) => item.advisory)).toContain('GHSA-f88m-g3jw-g9cj');
  });
});

describe('acknowledgedAdvisories', () => {
  it('documents a reason and review date for every entry', () => {
    for (const entry of acknowledgedAdvisories) {
      expect(entry.advisory).toMatch(/^GHSA-/);
      expect(entry.package.length).toBeGreaterThan(0);
      expect(entry.reason.length).toBeGreaterThan(40);
      expect(entry.reviewedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
