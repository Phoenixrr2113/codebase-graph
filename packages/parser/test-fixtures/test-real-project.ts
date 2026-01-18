/**
 * Test script to verify Python extraction on a real project
 * Run with: npx tsx packages/parser/test-fixtures/test-real-project.ts
 */

import { parseFile } from '../src/parser';
import {
  extractFunctions,
  extractClasses,
  extractVariables,
  extractImports,
} from '@codegraph/plugin-python';
import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';

const PROJECT_PATH = '/path/to/user/Downloads/code-graph-backend-main';

// Find all Python files recursively
async function findPythonFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '__pycache__' && entry.name !== 'node_modules') {
      files.push(...await findPythonFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.py')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

async function testRealProject() {
  console.log('🐍 Testing Python extraction on real project...\n');
  console.log(`Project: ${PROJECT_PATH}\n`);
  
  try {
    const pythonFiles = await findPythonFiles(PROJECT_PATH);
    console.log(`Found ${pythonFiles.length} Python files\n`);
    
    let totalFunctions = 0;
    let totalClasses = 0;
    let totalImports = 0;
    let totalVariables = 0;
    let filesProcessed = 0;
    let errors = 0;
    
    for (const filePath of pythonFiles) {
      try {
        const relativePath = path.relative(PROJECT_PATH, filePath);
        const syntaxTree = await parseFile(filePath);
        const root = syntaxTree.rootNode as any;
        
        const functions = extractFunctions(root, filePath);
        const classes = extractClasses(root, filePath);
        const imports = extractImports(root, filePath);
        const variables = extractVariables(root, filePath);
        
        totalFunctions += functions.length;
        totalClasses += classes.length;
        totalImports += imports.length;
        totalVariables += variables.length;
        filesProcessed++;
        
        // Show some details for each file
        const entityCount = functions.length + classes.length + imports.length + variables.length;
        if (entityCount > 0) {
          console.log(`📄 ${relativePath}: ${functions.length} fn, ${classes.length} cls, ${imports.length} imp, ${variables.length} var`);
        }
        
      } catch (err) {
        console.error(`❌ Error parsing ${path.basename(filePath)}: ${(err as Error).message}`);
        errors++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📈 SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Files processed: ${filesProcessed}`);
    if (errors > 0) console.log(`❌ Errors: ${errors}`);
    console.log();
    console.log(`📦 Functions:  ${totalFunctions}`);
    console.log(`🏛️  Classes:    ${totalClasses}`);
    console.log(`📥 Imports:    ${totalImports}`);
    console.log(`📊 Variables:  ${totalVariables}`);
    console.log();
    console.log(`🎯 TOTAL ENTITIES: ${totalFunctions + totalClasses + totalImports + totalVariables}`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

testRealProject();
