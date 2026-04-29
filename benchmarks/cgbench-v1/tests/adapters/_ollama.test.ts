import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCypher, extractCypher } from '../../src/adapters/_ollama';

describe('extractCypher', () => {
  it('extracts content between ```cypher fences', () => {
    const response = "Sure, here is the query:\n```cypher\nMATCH (n) RETURN n\n```\nLet me know if...";
    expect(extractCypher(response)).toBe('MATCH (n) RETURN n');
  });

  it('extracts content between bare ``` fences (no language tag)', () => {
    const response = '```\nMATCH (n) RETURN n\n```';
    expect(extractCypher(response)).toBe('MATCH (n) RETURN n');
  });

  it('returns the raw string trimmed if no fence is found', () => {
    const response = '   MATCH (n) RETURN n  \n';
    expect(extractCypher(response)).toBe('MATCH (n) RETURN n');
  });
});

describe('generateCypher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns Cypher when Ollama generates a valid read-only query', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '```cypher\nMATCH (n:Function {name: "foo"}) RETURN n\n```' } }],
      }),
    } as Response);

    const result = await generateCypher({
      question: 'find function foo',
      taskHint: 'B',
    });

    expect(result.cypher).toBe('MATCH (n:Function {name: "foo"}) RETURN n');
    expect(result.attempts).toBe(1);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('retries once if first response contains forbidden clause', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '```cypher\nCREATE (n:Foo) RETURN n\n```' } }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '```cypher\nMATCH (n:Foo) RETURN n\n```' } }],
        }),
      } as Response);

    const result = await generateCypher({ question: 'find foo', taskHint: 'B' });

    expect(result.cypher).toBe('MATCH (n:Foo) RETURN n');
    expect(result.attempts).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns null cypher after two failed generations', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '```cypher\nDELETE (n) RETURN n\n```' } }],
      }),
    } as Response);

    const result = await generateCypher({ question: 'destroy', taskHint: 'B' });

    expect(result.cypher).toBeNull();
    expect(result.attempts).toBe(2);
  });
});
