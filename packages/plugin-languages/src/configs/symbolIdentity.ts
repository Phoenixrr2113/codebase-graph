import type { SyntaxNode } from '@codegraph/types';
import {
  buildLexicalScopeKey,
  buildSymbolIdentity,
  occurrenceDisambiguator,
  signatureDisambiguator,
  type SourceSymbolLabel,
  type SymbolIdentity,
} from '@codegraph/plugin-common';

export interface SignatureParam {
  type?: string;
  optional?: boolean;
}

export function identityForNode(options: {
  node: SyntaxNode;
  filePath: string;
  label: SourceSymbolLabel;
  declaredName: string;
  disambiguator?: string;
  includeBlockScopes?: boolean;
  scopeKeyOverride?: string;
}): SymbolIdentity {
  return buildSymbolIdentity({
    label: options.label,
    filePath: options.filePath,
    scopeKey: options.scopeKeyOverride ?? buildLexicalScopeKey(options.node, {
      includeBlockScopes: options.includeBlockScopes ?? false,
    }),
    declaredName: options.declaredName,
    disambiguator: options.disambiguator ?? '',
  });
}

export function functionDisambiguator(options: {
  node: SyntaxNode;
  nodes: SyntaxNode[];
  name: string;
  signatureFor(node: SyntaxNode): string;
}): string {
  const scopeKey = buildLexicalScopeKey(options.node);
  const peers = options.nodes.filter((candidate) =>
    candidate.childForFieldName('name')?.text === options.name &&
    buildLexicalScopeKey(candidate) === scopeKey
  );
  if (peers.length <= 1) return '';

  const signature = signatureDisambiguator(options.signatureFor(options.node));
  const signaturePeers = peers.filter((candidate) =>
    signatureDisambiguator(options.signatureFor(candidate)) === signature
  );
  const occurrence = signaturePeers.findIndex(
    (candidate) => candidate.startIndex === options.node.startIndex,
  ) + 1;
  return signaturePeers.length > 1
    ? `${signature}/${occurrenceDisambiguator(occurrence)}`
    : signature;
}

export function normalizedFunctionSignature(
  params: SignatureParam[],
  returnType: string | undefined,
): string {
  return `(${params.map((param) => `${param.type ?? '_'}${param.optional ? '?' : ''}`).join(',')})=>${returnType ?? '_'}`;
}
