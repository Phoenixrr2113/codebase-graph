/**
 * Type node identity helpers.
 *
 * A "Type" in CodeGraph is a node that represents a programming-language type
 * (e.g., `User`, `Promise<Token>`, `string`, `Map<K, V>`). Functions HAS_PARAM,
 * RETURNS, USES_TYPE these. We need stable, deterministic IDs so the same
 * type referenced from multiple files becomes ONE node, not many.
 *
 * Identity rule:
 *   1. Primitives (string, number, bool, ...): id = `prim::<lang>::<name>`
 *   2. User types defined in a file: id = `type::<lang>::<filePath>::<name>`
 *      Cross-file references resolve to the defining file's id.
 *   3. Generic instantiations: stored as a single Type node with the full
 *      printed name (e.g., `Map<string, User>`). Structural decomposition is
 *      a v2 feature.
 */

export type SupportedLanguage = 'typescript' | 'python' | 'go' | 'rust';

const PRIMITIVES: Record<SupportedLanguage, ReadonlySet<string>> = {
  typescript: new Set([
    'string', 'number', 'boolean', 'bigint', 'symbol', 'undefined', 'null',
    'void', 'any', 'unknown', 'never', 'object',
  ]),
  python: new Set([
    'int', 'float', 'bool', 'str', 'bytes', 'None', 'NoneType',
    'list', 'tuple', 'dict', 'set', 'frozenset',
  ]),
  go: new Set([
    'string', 'int', 'int8', 'int16', 'int32', 'int64',
    'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
    'byte', 'rune', 'float32', 'float64', 'complex64', 'complex128',
    'bool', 'error',
  ]),
  rust: new Set([
    'i8', 'i16', 'i32', 'i64', 'i128', 'isize',
    'u8', 'u16', 'u32', 'u64', 'u128', 'usize',
    'f32', 'f64', 'bool', 'char', 'str', 'String', '()',
  ]),
};

export interface TypeIdentity {
  id: string;
  name: string;
  language: SupportedLanguage;
  isPrimitive: boolean;
  /** Defining file path for non-primitive user types. */
  definingFile?: string;
}

/**
 * Returns the deterministic Type node id for a language + name + optional
 * defining file path. Primitives ignore the file (they're shared globally per
 * language).
 */
export function typeNodeId(opts: {
  language: SupportedLanguage;
  name: string;
  definingFile?: string;
}): string {
  const { language, name, definingFile } = opts;
  if (PRIMITIVES[language].has(name)) {
    return `prim::${language}::${name}`;
  }
  if (definingFile) {
    return `type::${language}::${definingFile}::${name}`;
  }
  return `type::${language}::__unresolved__::${name}`;
}

export function resolveTypeIdentity(opts: {
  language: SupportedLanguage;
  name: string;
  definingFile?: string;
}): TypeIdentity {
  const { language, name, definingFile } = opts;
  const isPrimitive = PRIMITIVES[language].has(name);
  return {
    id: typeNodeId(opts),
    name,
    language,
    isPrimitive,
    ...(isPrimitive ? {} : (definingFile ? { definingFile } : {})),
  };
}

export function isPrimitiveType(language: SupportedLanguage, name: string): boolean {
  return PRIMITIVES[language].has(name);
}
