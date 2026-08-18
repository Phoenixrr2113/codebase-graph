import { MockLanguageModelV3 } from 'ai/test';

type ExtractionToolName = 'emit_extraction' | 'emit_batch';

export function makeToolCallResult(
  response: object,
  toolName: ExtractionToolName = 'emit_extraction',
) {
  return {
    content: [
      {
        type: 'tool-call' as const,
        toolCallId: 'test-tool-call-1',
        toolName,
        input: JSON.stringify(response),
      },
    ],
    finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 10, text: 0, reasoning: 0 },
    },
    warnings: [],
  };
}

export function makeToolCallModel(
  response: object,
  toolName: ExtractionToolName = 'emit_extraction',
): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    provider: 'test',
    modelId: 'test-model',
    doGenerate: makeToolCallResult(response, toolName),
  });
}
