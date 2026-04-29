import { describe, it, expect } from 'vitest';
import { isReadOnlyCypher } from '../../src/adapters/_cypher-safety';

describe('isReadOnlyCypher', () => {
  it('accepts MATCH ... RETURN', () => {
    expect(isReadOnlyCypher('MATCH (n:Function) RETURN n LIMIT 10')).toBe(true);
  });

  it('accepts mixed case MATCH', () => {
    expect(isReadOnlyCypher('match (n) return n')).toBe(true);
  });

  it('rejects CREATE', () => {
    expect(isReadOnlyCypher('CREATE (n:Foo {name: "bar"}) RETURN n')).toBe(false);
  });

  it('rejects MERGE', () => {
    expect(isReadOnlyCypher('MERGE (n:Foo) RETURN n')).toBe(false);
  });

  it('rejects DELETE', () => {
    expect(isReadOnlyCypher('MATCH (n) DETACH DELETE n')).toBe(false);
  });

  it('rejects SET', () => {
    expect(isReadOnlyCypher('MATCH (n) SET n.foo = "bar" RETURN n')).toBe(false);
  });

  it('rejects REMOVE', () => {
    expect(isReadOnlyCypher('MATCH (n) REMOVE n.foo RETURN n')).toBe(false);
  });

  it('rejects DROP', () => {
    expect(isReadOnlyCypher('DROP INDEX foo')).toBe(false);
  });

  it('does NOT reject the word "create" inside a string literal', () => {
    expect(isReadOnlyCypher(`MATCH (n {name: 'create'}) RETURN n`)).toBe(true);
  });

  it('does NOT reject "create" as a substring of a node label', () => {
    expect(isReadOnlyCypher(`MATCH (creator:Function) RETURN creator`)).toBe(true);
  });
});
