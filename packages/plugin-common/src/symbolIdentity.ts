import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { SyntaxNode } from '@codegraph/types';

export type SourceSymbolLabel =
  | 'Function'
  | 'Class'
  | 'Interface'
  | 'Variable'
  | 'Type'
  | 'Component';

export interface SymbolIdentityInput {
  label: SourceSymbolLabel;
  filePath: string;
  scopeKey: string;
  declaredName: string;
  disambiguator: string;
}

export interface SymbolIdentity {
  id: string;
  scopeKey: string;
  disambiguator: string;
}

const NAMED_SCOPE_TYPES: Readonly<Record<string, SourceSymbolLabel | 'Impl'>> = {
  class: 'Class',
  class_declaration: 'Class',
  abstract_class_declaration: 'Class',
  class_definition: 'Class',
  struct_item: 'Class',
  enum_item: 'Class',
  interface_declaration: 'Interface',
  interface_definition: 'Interface',
  trait_item: 'Interface',
  function_declaration: 'Function',
  function_definition: 'Function',
  function_item: 'Function',
  generator_function_declaration: 'Function',
  method_definition: 'Function',
  method_declaration: 'Function',
  local_function_statement: 'Function',
  impl_item: 'Impl',
};

const FUNCTION_EXPRESSION_TYPES = new Set([
  'arrow_function',
  'function_expression',
  'generator_function',
  'lambda',
]);

const BLOCK_TYPES = new Set([
  'statement_block',
  'block',
  'block_expression',
  'declaration_list',
]);

const BLOCK_OWNER_TYPES = new Set([
  'if_statement',
  'else_clause',
  'for_statement',
  'for_in_statement',
  'for_of_statement',
  'while_statement',
  'do_statement',
  'switch_case',
  'switch_default',
  'catch_clause',
  'try_statement',
]);

const FIELD_NAMES = [
  'body',
  'consequence',
  'alternative',
  'handler',
  'finalizer',
] as const;

export function normalizeSymbolFilePath(filePath: string): string {
  const normalizedSeparators = filePath.replace(/\\/g, '/').normalize('NFC');
  const normalized = posix.normalize(normalizedSeparators);
  return normalized === '.' && normalizedSeparators !== '.' ? '' : normalized;
}

export function buildSymbolIdentity(input: SymbolIdentityInput): SymbolIdentity {
  const scopeKey = input.scopeKey.normalize('NFC');
  const disambiguator = input.disambiguator.normalize('NFC');
  const fields = [
    input.label,
    normalizeSymbolFilePath(input.filePath),
    scopeKey,
    input.declaredName.normalize('NFC'),
    disambiguator,
  ];
  const hash = createHash('sha256');

  for (const field of fields) {
    const encoded = Buffer.from(field, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(encoded.byteLength, 0);
    hash.update(length);
    hash.update(encoded);
  }

  return {
    id: `sym:v1:${hash.digest('hex')}`,
    scopeKey,
    disambiguator,
  };
}

export function normalizeDeclarationSignature(signature: string): string {
  let normalized = '';
  let quote: string | null = null;
  let escaped = false;
  let pendingSpace = false;

  for (const character of signature.trim().normalize('NFC')) {
    if (quote) {
      normalized += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === '`') {
      if (pendingSpace && normalized && !isSignaturePunctuation(normalized.at(-1)!)) {
        normalized += ' ';
      }
      pendingSpace = false;
      quote = character;
      normalized += character;
      continue;
    }

    if (/\s/.test(character)) {
      pendingSpace = true;
      continue;
    }

    if (isSignaturePunctuation(character)) {
      normalized = normalized.trimEnd();
      normalized += character;
      pendingSpace = false;
      continue;
    }

    if (pendingSpace && normalized && !isSignaturePunctuation(normalized.at(-1)!)) {
      normalized += ' ';
    }
    pendingSpace = false;
    normalized += character;
  }

  return normalized;
}

export function signatureDisambiguator(signature: string): string {
  const normalized = normalizeDeclarationSignature(signature);
  const digest = createHash('sha256').update(normalized, 'utf8').digest('hex');
  return `sig:${digest.slice(0, 16)}`;
}

export function occurrenceDisambiguator(ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new RangeError('Occurrence ordinal must be a positive safe integer');
  }
  return `occ:${ordinal}`;
}

export function buildLexicalScopeKey(
  node: SyntaxNode,
  options: { includeBlockScopes?: boolean } = {},
): string {
  const segments: string[] = [];
  let current = node.parent;

  while (current) {
    const namedSegment = namedScopeSegment(current);
    if (namedSegment) {
      segments.push(namedSegment);
    } else if (options.includeBlockScopes && BLOCK_TYPES.has(current.type)) {
      const blockSegment = blockScopeSegment(current);
      if (blockSegment) segments.push(blockSegment);
    }
    current = current.parent;
  }

  return segments.reverse().join('/');
}

function namedScopeSegment(node: SyntaxNode): string | null {
  const label = NAMED_SCOPE_TYPES[node.type];
  if (label) {
    const name = label === 'Impl'
      ? node.childForFieldName('type')?.text ?? node.childForFieldName('trait')?.text
      : node.childForFieldName('name')?.text;
    return name ? `${label}:${name.normalize('NFC')}` : null;
  }

  if (FUNCTION_EXPRESSION_TYPES.has(node.type)) {
    const directName = node.childForFieldName('name')?.text;
    const declaratorName = node.parent?.type === 'variable_declarator'
      ? node.parent.childForFieldName('name')?.text
      : undefined;
    const name = directName ?? declaratorName;
    return name ? `Function:${name.normalize('NFC')}` : null;
  }

  return null;
}

function blockScopeSegment(block: SyntaxNode): string | null {
  const parent = block.parent;
  if (!parent) return null;
  if (namedScopeSegment(parent)) return null;

  if (BLOCK_OWNER_TYPES.has(parent.type)) {
    const role = fieldNameForChild(parent, block);
    const ordinal = siblingOrdinal(parent);
    return `Block:${parent.type}${role ? `:${role}` : ''}#${ordinal}`;
  }

  const ordinal = siblingOrdinal(block);
  return `Block:${block.type}#${ordinal}`;
}

function fieldNameForChild(parent: SyntaxNode, child: SyntaxNode): string | null {
  for (const fieldName of FIELD_NAMES) {
    const candidate = parent.childForFieldName(fieldName);
    if (candidate && sameNode(candidate, child)) return fieldName;
  }
  return null;
}

function siblingOrdinal(node: SyntaxNode): number {
  const siblings = node.parent?.namedChildren ?? [];
  let ordinal = 0;
  for (const sibling of siblings) {
    if (sibling.type !== node.type) continue;
    if (sameNode(sibling, node)) return ordinal;
    ordinal++;
  }
  return ordinal;
}

function sameNode(left: SyntaxNode, right: SyntaxNode): boolean {
  return left.type === right.type &&
    left.startIndex === right.startIndex &&
    left.endIndex === right.endIndex;
}

function isSignaturePunctuation(character: string): boolean {
  return /[<>()\[\]{},:;?=|&]/.test(character);
}
