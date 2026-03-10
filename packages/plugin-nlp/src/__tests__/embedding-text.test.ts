/**
 * Embedding Text Construction — Unit Tests
 *
 * Verifies that each text builder produces readable, searchable strings
 * without any 'undefined' leaking into the output.
 */

import { describe, it, expect } from 'vitest';
import {
  buildFunctionEmbeddingText,
  buildClassEmbeddingText,
  buildInterfaceEmbeddingText,
  buildComponentEmbeddingText,
  buildTypeEmbeddingText,
  buildVariableEmbeddingText,
  buildFileEmbeddingText,
  buildEntityEmbeddingText,
  buildEmbeddingText,
} from '../embedding-text';
import type {
  FunctionEntity,
  ClassEntity,
  InterfaceEntity,
  ComponentEntity,
  TypeEntity,
  VariableEntity,
  FileEntity,
} from '@codegraph/types';

// ============================================================================
// Shared assertion: no 'undefined' string in output
// ============================================================================

function assertNoUndefined(text: string): void {
  expect(text).not.toContain('undefined');
  expect(text).not.toContain('null');
  expect(text.trim()).toBe(text); // no leading/trailing whitespace
  expect(text.length).toBeGreaterThan(0);
}

// ============================================================================
// FunctionEntity
// ============================================================================

describe('buildFunctionEmbeddingText', () => {
  it('builds full signature with all fields', () => {
    const fn: FunctionEntity = {
      name: 'processPayment',
      filePath: '/src/payments/stripe.ts',
      startLine: 10,
      endLine: 30,
      isExported: true,
      isAsync: true,
      isArrow: false,
      params: [
        { name: 'amount', type: 'number' },
        { name: 'currency', type: 'string' },
      ],
      returnType: 'Promise<PaymentResult>',
      docstring: 'Processes a payment using Stripe API.',
    };

    const text = buildFunctionEmbeddingText(fn);
    assertNoUndefined(text);
    expect(text).toContain('processPayment(amount: number, currency: string): Promise<PaymentResult>');
    expect(text).toContain('async');
    expect(text).toContain('exported');
    expect(text).toContain('Processes a payment');
    expect(text).toContain('stripe.ts');
  });

  it('handles minimal function (no params, no return type, no docstring)', () => {
    const fn: FunctionEntity = {
      name: 'init',
      filePath: '/app.ts',
      startLine: 1,
      endLine: 3,
      isExported: false,
      isAsync: false,
      isArrow: false,
      params: [],
    };

    const text = buildFunctionEmbeddingText(fn);
    assertNoUndefined(text);
    expect(text).toContain('init()');
    expect(text).not.toContain('async');
    expect(text).not.toContain('exported');
  });

  it('formats optional and rest params correctly', () => {
    const fn: FunctionEntity = {
      name: 'merge',
      filePath: '/utils/merge.ts',
      startLine: 1,
      endLine: 5,
      isExported: true,
      isAsync: false,
      isArrow: true,
      params: [
        { name: 'target', type: 'object' },
        { name: 'options', type: 'MergeOptions', optional: true },
        { name: 'sources', type: 'object[]', isRest: true },
      ],
    };

    const text = buildFunctionEmbeddingText(fn);
    assertNoUndefined(text);
    expect(text).toContain('target: object');
    expect(text).toContain('options?: MergeOptions');
    expect(text).toContain('...sources: object[]');
    expect(text).toContain('arrow function');
  });

  it('includes generator modifier', () => {
    const fn: FunctionEntity = {
      name: 'range',
      filePath: '/utils/iter.ts',
      startLine: 1,
      endLine: 5,
      isExported: false,
      isAsync: false,
      isArrow: false,
      isGenerator: true,
      params: [{ name: 'n', type: 'number' }],
    };

    const text = buildFunctionEmbeddingText(fn);
    assertNoUndefined(text);
    expect(text).toContain('generator');
  });
});

// ============================================================================
// ClassEntity
// ============================================================================

describe('buildClassEmbeddingText', () => {
  it('builds full class declaration', () => {
    const cls: ClassEntity = {
      name: 'StripeService',
      filePath: '/src/payments/stripe.ts',
      startLine: 5,
      endLine: 100,
      isExported: true,
      isAbstract: false,
      extends: 'BasePaymentProvider',
      implements: ['PaymentGateway', 'Serializable'],
      docstring: 'Handles all Stripe payment integration.',
    };

    const text = buildClassEmbeddingText(cls);
    assertNoUndefined(text);
    expect(text).toContain('class StripeService extends BasePaymentProvider');
    expect(text).toContain('implements PaymentGateway, Serializable');
    expect(text).toContain('exported');
    expect(text).toContain('Handles all Stripe');
  });

  it('handles abstract class with no extends/implements', () => {
    const cls: ClassEntity = {
      name: 'BaseHandler',
      filePath: '/src/handlers/base.ts',
      startLine: 1,
      endLine: 20,
      isExported: true,
      isAbstract: true,
    };

    const text = buildClassEmbeddingText(cls);
    assertNoUndefined(text);
    expect(text).toContain('class BaseHandler');
    expect(text).toContain('abstract');
    expect(text).not.toContain('extends');
    expect(text).not.toContain('implements');
  });
});

// ============================================================================
// InterfaceEntity
// ============================================================================

describe('buildInterfaceEmbeddingText', () => {
  it('builds interface with extends', () => {
    const iface: InterfaceEntity = {
      name: 'PaymentGateway',
      filePath: '/src/types/payment.ts',
      startLine: 1,
      endLine: 15,
      isExported: true,
      extends: ['BaseGateway', 'Serializable'],
      docstring: 'Contract for payment gateways.',
    };

    const text = buildInterfaceEmbeddingText(iface);
    assertNoUndefined(text);
    expect(text).toContain('interface PaymentGateway extends BaseGateway, Serializable');
    expect(text).toContain('exported');
    expect(text).toContain('Contract for payment');
  });

  it('handles minimal interface', () => {
    const iface: InterfaceEntity = {
      name: 'Config',
      filePath: '/config.ts',
      startLine: 1,
      endLine: 5,
      isExported: false,
    };

    const text = buildInterfaceEmbeddingText(iface);
    assertNoUndefined(text);
    expect(text).toContain('interface Config');
    expect(text).not.toContain('extends');
    expect(text).not.toContain('exported');
  });
});

// ============================================================================
// ComponentEntity
// ============================================================================

describe('buildComponentEmbeddingText', () => {
  it('builds component with props', () => {
    const comp: ComponentEntity = {
      name: 'PaymentForm',
      filePath: '/src/components/PaymentForm.tsx',
      startLine: 10,
      endLine: 80,
      isExported: true,
      propsType: 'PaymentFormProps',
      props: [
        { name: 'amount', type: 'number', required: true },
        { name: 'currency', type: 'string', required: false },
        { name: 'onSubmit', type: '() => void', required: true },
      ],
    };

    const text = buildComponentEmbeddingText(comp);
    assertNoUndefined(text);
    expect(text).toContain('PaymentForm component');
    expect(text).toContain('PaymentFormProps');
    expect(text).toContain('amount: number');
    expect(text).toContain('currency?: string');
    expect(text).toContain('exported');
  });

  it('handles component with no props', () => {
    const comp: ComponentEntity = {
      name: 'Logo',
      filePath: '/src/components/Logo.tsx',
      startLine: 1,
      endLine: 10,
      isExported: true,
    };

    const text = buildComponentEmbeddingText(comp);
    assertNoUndefined(text);
    expect(text).toContain('Logo component');
    expect(text).not.toContain('props:');
  });
});

// ============================================================================
// TypeEntity
// ============================================================================

describe('buildTypeEmbeddingText', () => {
  it('builds type alias', () => {
    const type: TypeEntity = {
      name: 'PaymentStatus',
      filePath: '/src/types/payment.ts',
      startLine: 1,
      endLine: 1,
      isExported: true,
      kind: 'type',
      docstring: 'Represents the state of a payment transaction.',
    };

    const text = buildTypeEmbeddingText(type);
    assertNoUndefined(text);
    expect(text).toContain('type PaymentStatus');
    expect(text).toContain('exported');
    expect(text).toContain('Represents the state');
  });

  it('builds enum', () => {
    const type: TypeEntity = {
      name: 'Direction',
      filePath: '/src/types/common.ts',
      startLine: 5,
      endLine: 10,
      isExported: false,
      kind: 'enum',
    };

    const text = buildTypeEmbeddingText(type);
    assertNoUndefined(text);
    expect(text).toContain('enum Direction');
    expect(text).not.toContain('exported');
  });
});

// ============================================================================
// VariableEntity
// ============================================================================

describe('buildVariableEmbeddingText', () => {
  it('builds typed const', () => {
    const v: VariableEntity = {
      name: 'MAX_RETRIES',
      filePath: '/src/config/constants.ts',
      line: 5,
      kind: 'const',
      isExported: true,
      type: 'number',
    };

    const text = buildVariableEmbeddingText(v);
    assertNoUndefined(text);
    expect(text).toContain('const MAX_RETRIES: number');
    expect(text).toContain('exported');
  });

  it('handles untyped let', () => {
    const v: VariableEntity = {
      name: 'counter',
      filePath: '/app.ts',
      line: 1,
      kind: 'let',
      isExported: false,
    };

    const text = buildVariableEmbeddingText(v);
    assertNoUndefined(text);
    expect(text).toContain('let counter');
    expect(text).not.toContain('exported');
    expect(text).not.toContain(':');
  });
});

// ============================================================================
// FileEntity
// ============================================================================

describe('buildFileEmbeddingText', () => {
  it('builds TypeScript file description', () => {
    const file: FileEntity = {
      path: '/src/payments/stripe.ts',
      name: 'stripe.ts',
      extension: 'ts',
      loc: 247,
      lastModified: '2026-01-01T00:00:00Z',
      hash: 'abc123',
    };

    const text = buildFileEmbeddingText(file);
    assertNoUndefined(text);
    expect(text).toContain('stripe.ts');
    expect(text).toContain('TypeScript');
    expect(text).toContain('247 lines');
  });

  it('builds React file description', () => {
    const file: FileEntity = {
      path: '/src/components/App.tsx',
      name: 'App.tsx',
      extension: 'tsx',
      loc: 100,
      lastModified: '2026-01-01T00:00:00Z',
      hash: 'def456',
    };

    const text = buildFileEmbeddingText(file);
    assertNoUndefined(text);
    expect(text).toContain('TypeScript React');
  });
});

// ============================================================================
// KnowledgeEntity (passthrough)
// ============================================================================

describe('buildEntityEmbeddingText', () => {
  it('returns text with type prefix', () => {
    const entity = {
      text: 'The authentication module uses JWT tokens for session management.',
      type: 'concept',
    };

    const text = buildEntityEmbeddingText(entity);
    assertNoUndefined(text);
    expect(text).toBe('[concept] The authentication module uses JWT tokens for session management.');
  });

  it('returns raw text when no type', () => {
    const entity = {
      text: 'Payment processing uses Stripe.',
      type: '',
    };

    const text = buildEntityEmbeddingText(entity);
    expect(text).toBe('Payment processing uses Stripe.');
  });
});

// ============================================================================
// Unified dispatcher
// ============================================================================

describe('buildEmbeddingText', () => {
  it('dispatches to correct builder', () => {
    const fn: FunctionEntity = {
      name: 'test',
      filePath: '/a.ts',
      startLine: 1,
      endLine: 2,
      isExported: false,
      isAsync: false,
      isArrow: false,
      params: [],
    };

    const text = buildEmbeddingText('Function', fn);
    expect(text).toContain('test()');
  });

  it('throws for unknown type', () => {
    expect(() => buildEmbeddingText('Unknown' as never, {})).toThrow('Unknown embeddable node type');
  });
});
