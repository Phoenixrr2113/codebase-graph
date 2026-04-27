import { describe, it, expect } from 'vitest';
import { typeNodeId, resolveTypeIdentity, isPrimitiveType } from '../types';

describe('typeNodeId', () => {
  it('returns prim:: for primitives across languages, ignoring defining file', () => {
    expect(typeNodeId({ language: 'typescript', name: 'string' })).toBe('prim::typescript::string');
    expect(typeNodeId({ language: 'typescript', name: 'string', definingFile: 'a.ts' })).toBe('prim::typescript::string');
    expect(typeNodeId({ language: 'go', name: 'int' })).toBe('prim::go::int');
    expect(typeNodeId({ language: 'rust', name: 'i32' })).toBe('prim::rust::i32');
    expect(typeNodeId({ language: 'rust', name: 'String' })).toBe('prim::rust::String');
    expect(typeNodeId({ language: 'python', name: 'int' })).toBe('prim::python::int');
  });

  it('uses defining file for user types', () => {
    expect(typeNodeId({ language: 'typescript', name: 'User', definingFile: 'src/models/user.ts' }))
      .toBe('type::typescript::src/models/user.ts::User');
  });

  it('uses unresolved namespace when defining file unknown', () => {
    expect(typeNodeId({ language: 'typescript', name: 'User' }))
      .toBe('type::typescript::__unresolved__::User');
  });

  it('treats generics as single type names', () => {
    expect(typeNodeId({ language: 'typescript', name: 'Promise<Token>', definingFile: 'a.ts' }))
      .toBe('type::typescript::a.ts::Promise<Token>');
    expect(typeNodeId({ language: 'rust', name: 'Vec<u32>', definingFile: 'a.rs' }))
      .toBe('type::rust::a.rs::Vec<u32>');
  });
});

describe('isPrimitiveType', () => {
  it('returns true for known primitives, false otherwise', () => {
    expect(isPrimitiveType('typescript', 'string')).toBe(true);
    expect(isPrimitiveType('typescript', 'User')).toBe(false);
    expect(isPrimitiveType('go', 'error')).toBe(true);
    expect(isPrimitiveType('rust', 'String')).toBe(true);
    expect(isPrimitiveType('python', 'list')).toBe(true);
  });
});

describe('resolveTypeIdentity', () => {
  it('returns full record', () => {
    const id = resolveTypeIdentity({ language: 'typescript', name: 'User', definingFile: 'a.ts' });
    expect(id.id).toBe('type::typescript::a.ts::User');
    expect(id.name).toBe('User');
    expect(id.isPrimitive).toBe(false);
    expect(id.definingFile).toBe('a.ts');
  });

  it('omits definingFile for primitives', () => {
    const id = resolveTypeIdentity({ language: 'typescript', name: 'string', definingFile: 'a.ts' });
    expect(id.isPrimitive).toBe(true);
    expect(id.definingFile).toBeUndefined();
  });
});
