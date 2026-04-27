import { describe, it, expect } from 'vitest';
import { DeltaOpSchema } from '../schemas';

describe('entity resolution delta ops', () => {
  it('validates a MergeOp', () => {
    const op = { op: 'merge', canonical: 'E1', duplicate: 'E2', reason: 'Both refer to the same person.' };
    const r = DeltaOpSchema.safeParse(op);
    expect(r.success).toBe(true);
  });

  it('validates a KeepOp', () => {
    const op = { op: 'keep', reason: 'Different concepts despite similar text.' };
    const r = DeltaOpSchema.safeParse(op);
    expect(r.success).toBe(true);
  });

  it('validates a RenameOp', () => {
    const op = { op: 'rename', entity: 'E1', newText: 'Sarah Chen', reason: 'Full name preferred over nickname.' };
    const r = DeltaOpSchema.safeParse(op);
    expect(r.success).toBe(true);
  });

  it('rejects an invalid op discriminator', () => {
    const op = { op: 'invalid', canonical: 'E1' };
    const r = DeltaOpSchema.safeParse(op);
    expect(r.success).toBe(false);
  });

  it('rejects a MergeOp with reason too short (min 5)', () => {
    const op = { op: 'merge', canonical: 'E1', duplicate: 'E2', reason: 'no' };
    const r = DeltaOpSchema.safeParse(op);
    expect(r.success).toBe(false);
  });

  it('rejects a MergeOp missing duplicate field', () => {
    const op = { op: 'merge', canonical: 'E1', reason: 'Same person.' };
    const r = DeltaOpSchema.safeParse(op);
    expect(r.success).toBe(false);
  });

  it('rejects a KeepOp missing reason', () => {
    const op = { op: 'keep' };
    const r = DeltaOpSchema.safeParse(op);
    expect(r.success).toBe(false);
  });

  it('rejects a KeepOp with reason too long (max 200)', () => {
    const op = { op: 'keep', reason: 'x'.repeat(201) };
    const r = DeltaOpSchema.safeParse(op);
    expect(r.success).toBe(false);
  });

  it('infers correct TypeScript type for a MergeOp', () => {
    const op = DeltaOpSchema.parse({
      op: 'merge',
      canonical: 'Sarah Chen',
      duplicate: 'Sarah',
      reason: 'Both refer to the same person.',
    });
    if (op.op === 'merge') {
      expect(op.canonical).toBe('Sarah Chen');
      expect(op.duplicate).toBe('Sarah');
    }
  });
});
