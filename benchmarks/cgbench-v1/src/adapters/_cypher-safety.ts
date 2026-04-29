/**
 * Read-only Cypher validator.
 *
 * Tokenize on non-word characters, case-fold each token, reject if any token
 * matches a mutation keyword. Tokenization avoids false positives where a
 * forbidden word appears inside a string literal or as a substring of an
 * identifier (e.g., `creator` won't trigger on `create`).
 *
 * NOTE: this is a tokenization heuristic, not a full Cypher parser. A
 * sufficiently adversarial input could bypass it. The Ollama-generated
 * Cypher we validate is constrained by the system prompt, so a heuristic
 * defense is acceptable here.
 */

const FORBIDDEN_TOKENS = new Set([
  'create',
  'merge',
  'delete',
  'set',
  'remove',
  'drop',
]);

/**
 * Validate that a Cypher query is read-only.
 *
 * @param cypher - the Cypher query string
 * @returns true if no mutation keywords appear outside string literals or comments
 */
export function isReadOnlyCypher(cypher: string): boolean {
  // Strip comments first — both line (//) and block (/* */).
  // Comments may contain quotes, so they must be stripped before string literals.
  const withoutComments = cypher
    .replace(/\/\/[^\n]*/g, '')      // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ''); // block comments

  // Then strip string literals — anything in 'single' or "double" quotes
  // is a value, not Cypher syntax. This handles the create-inside-string case.
  const withoutStrings = withoutComments
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');

  // Tokenize on non-word characters
  const tokens = withoutStrings.split(/\W+/);

  // Case-fold and check each token
  for (const token of tokens) {
    if (token.length === 0) continue;
    if (FORBIDDEN_TOKENS.has(token.toLowerCase())) {
      return false;
    }
  }
  return true;
}
