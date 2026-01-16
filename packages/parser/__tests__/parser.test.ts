/**
 * Parser Unit Tests
 * Tests for Tree-sitter parser initialization and code parsing
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initParser,
  parseCode,
  parseFile,
  disposeParser,
  isInitialized,
  getLanguageForExtension,
} from '../src/parser.js';
import { writeFile, unlink, mkdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Parser', () => {
  beforeAll(async () => {
    await initParser();
  });

  afterAll(() => {
    disposeParser();
  });

  describe('initParser', () => {
    it('should initialize successfully', () => {
      expect(isInitialized()).toBe(true);
    });

    it('should be idempotent (calling multiple times is safe)', async () => {
      await initParser();
      await initParser();
      expect(isInitialized()).toBe(true);
    });
  });

  describe('getLanguageForExtension', () => {
    it('should return typescript for .ts files', () => {
      expect(getLanguageForExtension('.ts')).toBe('typescript');
    });

    it('should return tsx for .tsx files', () => {
      expect(getLanguageForExtension('.tsx')).toBe('tsx');
    });

    it('should return javascript for .js files', () => {
      expect(getLanguageForExtension('.js')).toBe('javascript');
    });

    it('should return jsx for .jsx files', () => {
      expect(getLanguageForExtension('.jsx')).toBe('jsx');
    });

    it('should return typescript for .mts and .cts files', () => {
      expect(getLanguageForExtension('.mts')).toBe('typescript');
      expect(getLanguageForExtension('.cts')).toBe('typescript');
    });

    it('should return undefined for unsupported extensions', () => {
      expect(getLanguageForExtension('.py')).toBeUndefined();
      expect(getLanguageForExtension('.go')).toBeUndefined();
    });
  });

  describe('parseCode', () => {
    it('should parse TypeScript code', () => {
      const code = `
        function greet(name: string): string {
          return \`Hello, \${name}!\`;
        }
      `;
      
      const result = parseCode(code, 'typescript');
      
      expect(result.rootNode.type).toBe('program');
      expect(result.language).toBe('typescript');
      expect(result.sourceCode).toBe(code);
    });

    it('should parse TSX code with JSX', () => {
      const code = `
        const Button: React.FC<{ label: string }> = ({ label }) => {
          return <button className="btn">{label}</button>;
        };
      `;
      
      const result = parseCode(code, 'tsx');
      
      expect(result.rootNode.type).toBe('program');
      expect(result.language).toBe('tsx');
    });

    it('should parse JavaScript code', () => {
      const code = `
        function add(a, b) {
          return a + b;
        }
      `;
      
      const result = parseCode(code, 'javascript');
      
      expect(result.rootNode.type).toBe('program');
      expect(result.language).toBe('javascript');
    });

    it('should parse code with imports', () => {
      const code = `
        import { useState, useEffect } from 'react';
        import axios from 'axios';
        import * as utils from './utils';
      `;
      
      const result = parseCode(code, 'typescript');
      
      expect(result.rootNode.type).toBe('program');
      expect(result.rootNode.childCount).toBeGreaterThan(0);
    });

    it('should parse class declarations', () => {
      const code = `
        class Animal {
          name: string;
          constructor(name: string) {
            this.name = name;
          }
          speak(): void {
            console.log(this.name);
          }
        }
        
        class Dog extends Animal {
          bark(): void {
            console.log('Woof!');
          }
        }
      `;
      
      const result = parseCode(code, 'typescript');
      
      expect(result.rootNode.type).toBe('program');
    });

    it('should handle syntax errors gracefully', () => {
      const code = `
        function broken( {
          // missing closing paren
        }
      `;
      
      // Should not throw, tree-sitter creates error nodes
      const result = parseCode(code, 'typescript');
      
      expect(result.rootNode.type).toBe('program');
      expect(result.rootNode.hasError).toBe(true);
    });

    it('should work without explicit initialization (auto-initializes)', async () => {
      disposeParser();
      
      // Should auto-initialize and work
      const result = parseCode('const x = 1;', 'typescript');
      expect(result.rootNode.type).toBe('program');
      
      // Re-initialize for other tests
      await initParser();
    });
  });

  describe('parseFile', () => {
    const testDir = join(tmpdir(), 'codegraph-parser-tests');
    
    beforeAll(async () => {
      await mkdir(testDir, { recursive: true });
    });

    afterAll(async () => {
      try {
        await rmdir(testDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should parse a TypeScript file', async () => {
      await initParser();
      
      const filePath = join(testDir, 'test.ts');
      const code = 'export const greeting = "Hello";';
      
      await writeFile(filePath, code, 'utf-8');
      
      try {
        const result = await parseFile(filePath);
        
        expect(result.rootNode.type).toBe('program');
        expect(result.language).toBe('typescript');
        expect(result.filePath).toBe(filePath);
        expect(result.sourceCode).toBe(code);
      } finally {
        await unlink(filePath);
      }
    });

    it('should parse a TSX file', async () => {
      await initParser();
      
      const filePath = join(testDir, 'component.tsx');
      const code = 'export const App = () => <div>Hello</div>;';
      
      await writeFile(filePath, code, 'utf-8');
      
      try {
        const result = await parseFile(filePath);
        
        expect(result.language).toBe('tsx');
        expect(result.filePath).toBe(filePath);
      } finally {
        await unlink(filePath);
      }
    });

    it('should throw for unsupported file extensions', async () => {
      await initParser();
      
      const filePath = join(testDir, 'script.py');
      await writeFile(filePath, 'print("hello")', 'utf-8');
      
      try {
        await expect(parseFile(filePath)).rejects.toThrow('Unsupported file extension');
      } finally {
        await unlink(filePath);
      }
    });

    it('should throw for non-existent files', async () => {
      await initParser();
      
      await expect(parseFile('/nonexistent/path/file.ts'))
        .rejects.toThrow();
    });
  });
});
