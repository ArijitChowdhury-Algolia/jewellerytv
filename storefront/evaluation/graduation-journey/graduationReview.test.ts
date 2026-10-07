import { describe, expect, it } from 'vitest';
import { evaluateGraduationReview } from './graduationReview';

const summary = {
  firstFailure: null,
  notRun: [],
  turns: Array.from({ length: 13 }, (_, index) => ({ beat: `G${index + 1}` })),
  assertions: [
    { beat: 'G1', id: 'reply', status: 'pass' },
    { beat: 'G1', id: 'semantic', status: 'unknown' },
    { beat: 'G8', id: 'blog-grounding', status: 'unknown' },
  ],
};

describe('graduation independent review gate', () => {
  it('refuses acceptance when unknown judgments or runtime identity proof are missing', () => {
    expect(
      evaluateGraduationReview(summary, { reviewer: 'Reviewer', judgments: {} }).accepted,
    ).toBe(false);
  });

  it('accepts only a complete 13-beat run with every unknown independently evidenced', () => {
    const result = evaluateGraduationReview(summary, {
      reviewer: 'Independent reviewer',
      runtimeAgentIdentityVerified: true,
      judgments: {
        'G1:semantic': {
          status: 'pass',
          evidence: 'G1 screenshot and transcript reviewed for warmth and useful personal question',
        },
        'G8:blog-grounding': {
          status: 'pass',
          evidence: 'G8 exact blog tool passage and canonical link matched the answer',
        },
      },
    });
    expect(result.accepted).toBe(true);
  });

  it('keeps any failed, missing or unrun beat closed', () => {
    const review = {
      reviewer: 'Independent reviewer',
      runtimeAgentIdentityVerified: true,
      judgments: {
        'G1:semantic': { status: 'pass' as const, evidence: 'Reviewed transcript and screenshot' },
        'G8:blog-grounding': { status: 'fail' as const, evidence: 'No applicable blog passage' },
      },
    };
    expect(evaluateGraduationReview(summary, review).accepted).toBe(false);
    expect(evaluateGraduationReview({ ...summary, notRun: ['G13'] }, review).accepted).toBe(false);
    expect(
      evaluateGraduationReview({ ...summary, firstFailure: 'G4:material' }, review).accepted,
    ).toBe(false);
  });

  it('requires separate evidence for repeated per-product unknowns', () => {
    const repeated = {
      ...summary,
      assertions: [
        { beat: 'G4', id: 'motif-evidence', status: 'unknown' },
        { beat: 'G4', id: 'motif-evidence', status: 'unknown' },
      ],
    };
    const result = evaluateGraduationReview(repeated, {
      reviewer: 'Independent reviewer',
      runtimeAgentIdentityVerified: true,
      judgments: {
        'G4:motif-evidence': {
          status: 'pass',
          evidence: 'Reviewed the first exact product record and image',
        },
      },
    });
    expect(result.accepted).toBe(false);
    expect(result.remaining).toContain('G4:motif-evidence#2');
  });
});
