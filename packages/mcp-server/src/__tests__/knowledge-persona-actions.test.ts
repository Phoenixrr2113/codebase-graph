/**
 * Knowledge Persona - Direct Action Wiring Tests
 *
 * CLAUDE.md documents 8 actions for the `knowledge` persona tool: store, add,
 * recall, query_knowledge, ingest_conversation, resolve_entities,
 * decay_and_prune, get_knowledge_stats. Only `store` and `recall` were wired
 * into the persona's action enum/handler; the other six had working
 * backends in `../tools/knowledge` but were unreachable through the persona,
 * which rejected them with "Unknown knowledge action".
 *
 * These are wiring tests: they mock the `knowledgeHandlers` map (the
 * persona's actual call boundary into `../tools/knowledge`) to verify that
 * each newly-wired action routes to its matching handler with the right
 * arguments forwarded, without touching a live database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock the tools/knowledge handler map ---------------------------------

vi.mock('../tools/knowledge', () => ({
  knowledgeHandlers: {
    store_entity: vi.fn(),
    store_relationship: vi.fn(),
    store_fact: vi.fn(),
    add: vi.fn(),
    ingest_conversation: vi.fn(),
    query_knowledge: vi.fn(),
    recall: vi.fn(),
    resolve_entities: vi.fn(),
    decay_and_prune: vi.fn(),
    get_knowledge_stats: vi.fn(),
  },
}));

import { handleKnowledge, knowledgePersonaDefinition } from '../personas/knowledge';
import { knowledgeHandlers } from '../tools/knowledge';

const mockHandlers = knowledgeHandlers as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(mockHandlers)) {
    fn.mockResolvedValue({ ok: true });
  }
});

// --- Currently unreachable (pre-fix) behavior -----------------------------

describe('knowledge persona - previously unreachable actions', () => {
  const missingActions = [
    'add',
    'query_knowledge',
    'ingest_conversation',
    'resolve_entities',
    'decay_and_prune',
    'get_knowledge_stats',
  ];

  for (const action of missingActions) {
    it(`routes action=${action} to the ${action} handler (not rejected as unknown)`, async () => {
      const result = (await handleKnowledge({ action })) as Record<string, unknown>;

      if (typeof result.error === 'string') {
        expect(result.error).not.toMatch(/Unknown knowledge action/);
      }
      expect(mockHandlers[action]).toHaveBeenCalledTimes(1);
    });
  }
});

// --- add --------------------------------------------------------------------

describe('knowledge persona - add', () => {
  it('passes input, source, inputType, maxTokens, and model through to the add handler', async () => {
    await handleKnowledge({
      action: 'add',
      input: '/path/to/spec.pdf',
      inputType: 'file',
      source: 'product-spec-v2',
      maxTokens: 256,
      model: 'some-model',
    });

    expect(mockHandlers.add).toHaveBeenCalledWith(
      expect.objectContaining({
        input: '/path/to/spec.pdf',
        inputType: 'file',
        source: 'product-spec-v2',
        maxTokens: 256,
        model: 'some-model',
      }),
    );
  });
});

// --- query_knowledge ----------------------------------------------------------

describe('knowledge persona - query_knowledge', () => {
  it('passes searchFacts through to the query_knowledge handler', async () => {
    await handleKnowledge({ action: 'query_knowledge', searchFacts: 'who decided to use JWT?' });

    expect(mockHandlers.query_knowledge).toHaveBeenCalledWith(
      expect.objectContaining({ searchFacts: 'who decided to use JWT?' }),
    );
  });

  it('passes source through to the query_knowledge handler', async () => {
    await handleKnowledge({ action: 'query_knowledge', source: 'meeting-2024-01-15' });

    expect(mockHandlers.query_knowledge).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'meeting-2024-01-15' }),
    );
  });

  it('passes at through to the query_knowledge handler', async () => {
    await handleKnowledge({ action: 'query_knowledge', semanticQuery: 'auth decisions', at: '2026-01-15T00:00:00Z' });

    expect(mockHandlers.query_knowledge).toHaveBeenCalledWith(
      expect.objectContaining({ semanticQuery: 'auth decisions', at: '2026-01-15T00:00:00Z' }),
    );
  });

  it('does not route query_knowledge through the store/recall auto-detectors', async () => {
    await handleKnowledge({ action: 'query_knowledge', textContains: 'CodeGraph' });

    expect(mockHandlers.query_knowledge).toHaveBeenCalledTimes(1);
    expect(mockHandlers.recall).not.toHaveBeenCalled();
  });
});

// --- ingest_conversation --------------------------------------------------------

describe('knowledge persona - ingest_conversation', () => {
  it('passes text, format, source, and model through to the ingest_conversation handler', async () => {
    await handleKnowledge({
      action: 'ingest_conversation',
      text: "Alice: let's use Redis\nBob: agreed",
      format: 'chat',
      source: 'standup',
      model: 'some-model',
    });

    expect(mockHandlers.ingest_conversation).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Alice: let's use Redis\nBob: agreed",
        format: 'chat',
        source: 'standup',
        model: 'some-model',
      }),
    );
  });
});

// --- resolve_entities -------------------------------------------------------------

describe('knowledge persona - resolve_entities', () => {
  it('calls resolve_entities handler with no required params', async () => {
    await handleKnowledge({ action: 'resolve_entities' });

    expect(mockHandlers.resolve_entities).toHaveBeenCalledTimes(1);
  });

  it('passes autoMergeThreshold and candidateThreshold through', async () => {
    await handleKnowledge({
      action: 'resolve_entities',
      autoMergeThreshold: 0.97,
      candidateThreshold: 0.8,
    });

    expect(mockHandlers.resolve_entities).toHaveBeenCalledWith(
      expect.objectContaining({ autoMergeThreshold: 0.97, candidateThreshold: 0.8 }),
    );
  });
});

// --- decay_and_prune ---------------------------------------------------------------

describe('knowledge persona - decay_and_prune', () => {
  it('calls decay_and_prune handler with no required params', async () => {
    await handleKnowledge({ action: 'decay_and_prune' });

    expect(mockHandlers.decay_and_prune).toHaveBeenCalledTimes(1);
  });

  it('passes prune, decayRate, minAge, and minRelevance through', async () => {
    await handleKnowledge({
      action: 'decay_and_prune',
      prune: true,
      decayRate: 0.02,
      minAge: 1000,
      minRelevance: 0.1,
    });

    expect(mockHandlers.decay_and_prune).toHaveBeenCalledWith(
      expect.objectContaining({ prune: true, decayRate: 0.02, minAge: 1000, minRelevance: 0.1 }),
    );
  });
});

// --- get_knowledge_stats -----------------------------------------------------------

describe('knowledge persona - get_knowledge_stats', () => {
  it('calls get_knowledge_stats handler with no params', async () => {
    await handleKnowledge({ action: 'get_knowledge_stats' });

    expect(mockHandlers.get_knowledge_stats).toHaveBeenCalledTimes(1);
  });
});

// --- recall: temporal / speaker / includeExpired passthrough -----------------------

describe('knowledge persona - recall temporal and speaker params', () => {
  it('passes at, from, to, timeline, speaker, and includeExpired through to the recall handler', async () => {
    await handleKnowledge({
      action: 'recall',
      text: 'CodeGraph',
      at: '2026-01-15T00:00:00Z',
      from: '2026-01-01T00:00:00Z',
      to: '2026-01-31T00:00:00Z',
      timeline: true,
      speaker: 'Alice',
      includeExpired: true,
    });

    expect(mockHandlers.recall).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'CodeGraph',
        at: '2026-01-15T00:00:00Z',
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T00:00:00Z',
        timeline: true,
        speaker: 'Alice',
        includeExpired: true,
      }),
    );
  });
});

// --- schema declares the recall temporal/speaker params -----------------------------

describe('knowledge persona - input schema', () => {
  it('declares at, from, to, timeline, speaker, and includeExpired as recognized properties', () => {
    const properties = knowledgePersonaDefinition.inputSchema.properties;

    for (const prop of ['at', 'from', 'to', 'timeline', 'speaker', 'includeExpired']) {
      expect(properties).toHaveProperty(prop);
    }
  });
});

// --- recall: semanticQuery routes to query_knowledge (semantic search) --------------

describe('knowledge persona - recall semanticQuery routing', () => {
  it('routes { action: "recall", semanticQuery: ... } to the query_knowledge handler, not literal recall', async () => {
    await handleKnowledge({ action: 'recall', semanticQuery: 'authentication decisions' });

    expect(mockHandlers.query_knowledge).toHaveBeenCalledWith(
      expect.objectContaining({ semanticQuery: 'authentication decisions' }),
    );
    expect(mockHandlers.recall).not.toHaveBeenCalled();
  });
});

// --- description examples must only reference declared schema properties (doc consistency) --

describe('knowledge persona - description examples match schema', () => {
  it('every key: name used in a description example object is a declared schema property', () => {
    const { description, inputSchema } = knowledgePersonaDefinition;
    const declaredProps = new Set(Object.keys(inputSchema.properties));

    // Pull every `{ ... }` example object out of the description text.
    const exampleBlocks = description.match(/\{[^}]*\}/g) ?? [];
    expect(exampleBlocks.length).toBeGreaterThan(0);

    const usedKeys = new Set<string>();
    for (const block of exampleBlocks) {
      // Strip quoted string contents first, so values like ISO timestamps
      // ("2026-01-15T00:00:00Z") or URLs ("https://docs.example.com/api")
      // can't be mistaken for `key:` syntax by the extractor below.
      const withoutStrings = block.replace(/"[^"]*"/g, '""');
      const keyMatches = withoutStrings.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g);
      for (const match of keyMatches) {
        usedKeys.add(match[1]);
      }
    }

    const deadKeys = [...usedKeys].filter((key) => !declaredProps.has(key));
    expect(deadKeys).toEqual([]);
  });
});

// --- existing store/recall behavior must still work --------------------------------

describe('knowledge persona - store/recall unaffected', () => {
  it('still routes store to store_entity by default', async () => {
    await handleKnowledge({ action: 'store', text: 'Use FalkorDB', type: 'Decision' });

    expect(mockHandlers.store_entity).toHaveBeenCalledTimes(1);
  });

  it('still routes recall to recall by default', async () => {
    await handleKnowledge({ action: 'recall', text: 'CodeGraph' });

    expect(mockHandlers.recall).toHaveBeenCalledTimes(1);
  });

  it('still rejects a truly unknown action', async () => {
    const result = (await handleKnowledge({ action: 'not_a_real_action' })) as Record<string, unknown>;

    expect(result.error).toMatch(/Unknown knowledge action/);
  });
});
