import { describe, expect, it } from 'vitest';
import {
  buildSymbolIdentity,
  normalizeDeclarationSignature,
  normalizeSymbolFilePath,
  signatureDisambiguator,
} from '../symbolIdentity';

describe('buildSymbolIdentity', () => {
  it('hashes the canonical length-prefixed identity tuple', () => {
    const identity = buildSymbolIdentity({
      label: 'Function',
      filePath: 'src/a:b.ts',
      scopeKey: 'Class:Outer',
      declaredName: 'run:fast',
      disambiguator: 'sig:abc',
    });

    expect(identity).toEqual({
      id: 'sym:v1:6d2aeedb5996fddf1aae415c4bc89f7e76d11cc4d3695febe86192e378b3616a',
      scopeKey: 'Class:Outer',
      disambiguator: 'sig:abc',
    });
  });

  it('normalizes path separators and dot segments before hashing', () => {
    expect(normalizeSymbolFilePath('src\\feature\\..\\model.ts')).toBe('src/model.ts');

    const windowsStyle = buildSymbolIdentity({
      label: 'Class',
      filePath: 'src\\feature\\..\\model.ts',
      scopeKey: '',
      declaredName: 'Model',
      disambiguator: '',
    });
    const posixStyle = buildSymbolIdentity({
      label: 'Class',
      filePath: 'src/model.ts',
      scopeKey: '',
      declaredName: 'Model',
      disambiguator: '',
    });

    expect(windowsStyle.id).toBe(posixStyle.id);
  });

  it('does not collide when tuple values contain separators', () => {
    const left = buildSymbolIdentity({
      label: 'Function',
      filePath: 'src/a:b.ts',
      scopeKey: 'Class:A',
      declaredName: 'b:c',
      disambiguator: '',
    });
    const right = buildSymbolIdentity({
      label: 'Function',
      filePath: 'src/a',
      scopeKey: 'b.ts:Class:A',
      declaredName: 'b:c',
      disambiguator: '',
    });

    expect(left.id).not.toBe(right.id);
  });
});

describe('signatureDisambiguator', () => {
  it('normalizes signature whitespace before hashing', () => {
    const compact = signatureDisambiguator('(value:string,count?:number):boolean');
    const spaced = signatureDisambiguator('( value: string, count?: number ) : boolean');

    expect(spaced).toBe(compact);
    expect(compact).toMatch(/^sig:[a-f0-9]{16}$/);
    expect(normalizeDeclarationSignature(' ( value: string ) : void ')).toBe('(value:string):void');
  });
});
