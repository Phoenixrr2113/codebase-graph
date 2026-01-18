/**
 * Test script to verify Python extraction
 * Run with: npx tsx packages/parser/test-fixtures/test-python.ts
 */

import { parseFile } from '../src/parser';
import {
  extractFunctions,
  extractClasses,
  extractVariables,
  extractImports,
} from '@codegraph/plugin-python';
import path from 'node:path';

async function testPythonExtraction() {
  const samplePath = path.join(import.meta.dirname, 'sample.py');
  
  console.log('🐍 Testing Python extraction...\n');
  console.log(`File: ${samplePath}\n`);
  
  try {
    // Parse the file
    const syntaxTree = await parseFile(samplePath);
    console.log(`✅ Parsed successfully (language: ${syntaxTree.language})`);
    console.log(`   Root node type: ${syntaxTree.rootNode.type}`);
    console.log(`   Source length: ${syntaxTree.sourceCode.length} chars\n`);
    
    // Extract entities
    const root = syntaxTree.rootNode as any;
    
    // Functions
    const functions = extractFunctions(root, samplePath);
    console.log(`📦 Functions (${functions.length}):`);
    for (const fn of functions) {
      const asyncBadge = fn.isAsync ? ' [async]' : '';
      const exportBadge = fn.isExported ? '' : ' [private]';
      console.log(`   - ${fn.name}${asyncBadge}${exportBadge} (line ${fn.startLine}-${fn.endLine})`);
      if (fn.params.length > 0) {
        console.log(`     params: ${fn.params.map(p => p.name + (p.type ? `: ${p.type}` : '')).join(', ')}`);
      }
    }
    console.log();
    
    // Classes
    const classes = extractClasses(root, samplePath);
    console.log(`🏛️  Classes (${classes.length}):`);
    for (const cls of classes) {
      const extendsBadge = cls.extends ? ` extends ${cls.extends}` : '';
      const exportBadge = cls.isExported ? '' : ' [private]';
      console.log(`   - ${cls.name}${extendsBadge}${exportBadge} (line ${cls.startLine}-${cls.endLine})`);
      if (cls.docstring) {
        console.log(`     "${cls.docstring.slice(0, 50)}..."`);
      }
    }
    console.log();
    
    // Imports
    const imports = extractImports(root, samplePath);
    console.log(`📥 Imports (${imports.length}):`);
    for (const imp of imports) {
      const specifiers = imp.specifiers.length > 0 
        ? ` (${imp.specifiers.map(s => s.name).join(', ')})`
        : '';
      console.log(`   - ${imp.source}${specifiers}`);
    }
    console.log();
    
    // Variables
    const variables = extractVariables(root, samplePath);
    console.log(`📊 Variables (${variables.length}):`);
    for (const v of variables) {
      const kindBadge = v.kind === 'const' ? '[const]' : '[let]';
      const exportBadge = v.isExported ? '' : ' [private]';
      console.log(`   - ${v.name} ${kindBadge}${exportBadge} (line ${v.line})`);
    }
    console.log();
    
    // Summary
    console.log('📈 Summary:');
    console.log(`   Functions: ${functions.length}`);
    console.log(`   Classes: ${classes.length}`);
    console.log(`   Imports: ${imports.length}`);
    console.log(`   Variables: ${variables.length}`);
    console.log(`   Total entities: ${functions.length + classes.length + imports.length + variables.length}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testPythonExtraction();
