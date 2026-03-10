/**
 * Embedding Text Construction Helpers
 *
 * Builds natural language strings from graph node properties for embedding.
 * One function per node type. These determine search quality — the richer
 * and more descriptive the text, the better the semantic search results.
 *
 * All builders gracefully handle missing/optional fields (no 'undefined' in output).
 */

import type {
  FunctionEntity,
  FunctionParam,
  ClassEntity,
  InterfaceEntity,
  ComponentEntity,
  ComponentProp,
  TypeEntity,
  VariableEntity,
  FileEntity,
} from '@codegraph/types';
import type { KnowledgeEntity } from '@codegraph/graph';

// ============================================================================
// Helpers
// ============================================================================

/** Join non-empty strings with a separator */
function joinParts(parts: (string | undefined | null | false)[], sep = ' '): string {
  return parts.filter(Boolean).join(sep);
}

/** Format a list of modifiers (async, exported, abstract, etc.) */
function modifiers(mods: (string | false | undefined | null)[]): string {
  const active = mods.filter(Boolean) as string[];
  return active.length > 0 ? active.join(', ') : '';
}

/** Format function parameters as a signature string */
function formatParams(params: FunctionParam[]): string {
  return params
    .map((p) => {
      const rest = p.isRest ? '...' : '';
      const opt = p.optional ? '?' : '';
      const type = p.type ? `: ${p.type}` : '';
      return `${rest}${p.name}${opt}${type}`;
    })
    .join(', ');
}

/** Format component props as a condensed string */
function formatProps(props: ComponentProp[]): string {
  return props
    .map((p) => {
      const req = p.required ? '' : '?';
      const type = p.type ? `: ${p.type}` : '';
      return `${p.name}${req}${type}`;
    })
    .join(', ');
}

/** Extract a short relative-ish path from a full file path */
function shortPath(filePath: string): string {
  // Take last 2-3 segments for context without overwhelming the embedding
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.slice(-3).join('/');
}

// ============================================================================
// Text Builders
// ============================================================================

/**
 * Build embedding text for a FunctionEntity.
 *
 * Example output:
 *   "processPayment(amount: number, currency: string): Promise<PaymentResult>
 *    async, exported. Processes a payment using Stripe's API.
 *    in src/payments/stripe.ts"
 */
export function buildFunctionEmbeddingText(node: FunctionEntity): string {
  // Signature line: name(params): returnType
  const sig = `${node.name}(${formatParams(node.params)})${node.returnType ? `: ${node.returnType}` : ''}`;

  // Modifiers line
  const mods = modifiers([
    node.isAsync && 'async',
    node.isExported && 'exported',
    node.isArrow && 'arrow function',
    node.isGenerator && 'generator',
  ]);

  // Docstring (first ~200 chars to keep embedding focused)
  const doc = node.docstring?.slice(0, 200)?.trim();

  // Location context
  const loc = `in ${shortPath(node.filePath)}`;

  return joinParts([sig, mods ? `${mods}.` : undefined, doc ? `${doc}` : undefined, loc]);
}

/**
 * Build embedding text for a ClassEntity.
 *
 * Example output:
 *   "StripeService extends BasePaymentProvider implements PaymentGateway
 *    abstract, exported. Handles all Stripe payment integration.
 *    in src/payments/stripe.ts"
 */
export function buildClassEmbeddingText(node: ClassEntity): string {
  // Declaration line
  let decl = `class ${node.name}`;
  if (node.extends) decl += ` extends ${node.extends}`;
  if (node.implements && node.implements.length > 0) {
    decl += ` implements ${node.implements.join(', ')}`;
  }

  const mods = modifiers([
    node.isAbstract && 'abstract',
    node.isExported && 'exported',
  ]);

  const doc = node.docstring?.slice(0, 200)?.trim();
  const loc = `in ${shortPath(node.filePath)}`;

  return joinParts([decl, mods ? `${mods}.` : undefined, doc, loc]);
}

/**
 * Build embedding text for an InterfaceEntity.
 *
 * Example output:
 *   "interface PaymentGateway extends BaseGateway, Serializable
 *    exported. Defines the contract for payment gateways.
 *    in src/types/payment.ts"
 */
export function buildInterfaceEmbeddingText(node: InterfaceEntity): string {
  let decl = `interface ${node.name}`;
  if (node.extends && node.extends.length > 0) {
    decl += ` extends ${node.extends.join(', ')}`;
  }

  const mods = modifiers([node.isExported && 'exported']);
  const doc = node.docstring?.slice(0, 200)?.trim();
  const loc = `in ${shortPath(node.filePath)}`;

  return joinParts([decl, mods ? `${mods}.` : undefined, doc, loc]);
}

/**
 * Build embedding text for a ComponentEntity (React).
 *
 * Example output:
 *   "PaymentForm component props: amount: number, currency?: string
 *    exported. in src/components/PaymentForm.tsx"
 */
export function buildComponentEmbeddingText(node: ComponentEntity): string {
  let decl = `${node.name} component`;
  if (node.propsType) {
    decl += ` (${node.propsType})`;
  }

  // Props detail
  const propsText =
    node.props && node.props.length > 0 ? `props: ${formatProps(node.props)}` : undefined;

  const mods = modifiers([node.isExported && 'exported']);
  const loc = `in ${shortPath(node.filePath)}`;

  return joinParts([decl, propsText, mods ? `${mods}.` : undefined, loc]);
}

/**
 * Build embedding text for a TypeEntity.
 *
 * Example output:
 *   "type PaymentStatus = 'pending' | 'completed' | 'failed'
 *    exported. Represents the state of a payment transaction.
 *    in src/types/payment.ts"
 */
export function buildTypeEmbeddingText(node: TypeEntity): string {
  const decl = `${node.kind} ${node.name}`;
  const mods = modifiers([node.isExported && 'exported']);
  const doc = node.docstring?.slice(0, 200)?.trim();
  const loc = `in ${shortPath(node.filePath)}`;

  return joinParts([decl, mods ? `${mods}.` : undefined, doc, loc]);
}

/**
 * Build embedding text for a VariableEntity.
 *
 * Example output:
 *   "const MAX_RETRIES: number exported in src/config/constants.ts"
 */
export function buildVariableEmbeddingText(node: VariableEntity): string {
  let decl = `${node.kind} ${node.name}`;
  if (node.type) decl += `: ${node.type}`;

  const mods = modifiers([node.isExported && 'exported']);
  const loc = `in ${shortPath(node.filePath)}`;

  return joinParts([decl, mods, loc]);
}

/**
 * Build embedding text for a FileEntity.
 *
 * Example output:
 *   "stripe.ts TypeScript file in src/payments 247 lines"
 */
export function buildFileEmbeddingText(node: FileEntity): string {
  const extMap: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript React',
    js: 'JavaScript',
    jsx: 'JavaScript React',
    mts: 'TypeScript',
    mjs: 'JavaScript',
    cts: 'TypeScript',
    cjs: 'JavaScript',
  };
  const lang = extMap[node.extension] ?? node.extension;
  const dir = shortPath(node.path).split('/').slice(0, -1).join('/');
  const dirPart = dir ? `in ${dir}` : undefined;

  return joinParts([node.name, `${lang} file`, dirPart, `${node.loc} lines`]);
}

/**
 * Build embedding text for a KnowledgeEntity.
 * Passthrough — entity.text is already natural language.
 */
export function buildEntityEmbeddingText(entity: KnowledgeEntity): string {
  // Knowledge entities already contain natural language text.
  // Include the type for extra context if available.
  if (entity.type) {
    return `[${entity.type}] ${entity.text}`;
  }
  return entity.text;
}

// ============================================================================
// Unified dispatcher
// ============================================================================

/** Node type label → text builder mapping */
export type EmbeddableNodeType =
  | 'Function'
  | 'Class'
  | 'Interface'
  | 'Component'
  | 'Type'
  | 'Variable'
  | 'File'
  | 'Entity';

/**
 * Build embedding text for any supported node type.
 * Dispatches to the appropriate type-specific builder.
 */
export function buildEmbeddingText(
  nodeType: EmbeddableNodeType,
  node: unknown,
): string {
  switch (nodeType) {
    case 'Function':
      return buildFunctionEmbeddingText(node as FunctionEntity);
    case 'Class':
      return buildClassEmbeddingText(node as ClassEntity);
    case 'Interface':
      return buildInterfaceEmbeddingText(node as InterfaceEntity);
    case 'Component':
      return buildComponentEmbeddingText(node as ComponentEntity);
    case 'Type':
      return buildTypeEmbeddingText(node as TypeEntity);
    case 'Variable':
      return buildVariableEmbeddingText(node as VariableEntity);
    case 'File':
      return buildFileEmbeddingText(node as FileEntity);
    case 'Entity':
      return buildEntityEmbeddingText(node as KnowledgeEntity);
    default:
      throw new Error(`Unknown embeddable node type: ${nodeType as string}`);
  }
}
