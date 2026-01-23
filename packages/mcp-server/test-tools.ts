/**
 * Manual test script for ALL MCP tools
 * Run with: npx tsx packages/mcp-server/test-tools.ts
 * 
 * Tests all 14 MCP tools against a running FalkorDB instance.
 * Uses codebase-specific symbols from the codebase-graph project.
 */

import { getIndexStatus } from './src/tools/indexStatus';
import { findSymbol } from './src/tools/findSymbol';
import { queryGraph } from './src/tools/queryGraph';
import { analyzeImpact } from './src/tools/analyzeImpact';
import { getComplexityReport } from './src/tools/complexityReport';
import { searchCode } from './src/tools/searchCode';
import { triggerReindex } from './src/tools/reindex';
import { analyzeFileForRefactoring } from './src/tools/analyzeRefactoring';
import { explainCode } from './src/tools/explainCode';
import { findVulnerabilities } from './src/tools/findVulnerabilities';
import { getRepoMap } from './src/tools/repoMap';
import { getSymbolHistory } from './src/tools/symbolHistory';
import { traceDataFlow } from './src/tools/traceDataFlow';
import { handleToolCall } from './src/tools';

const separator = '='.repeat(60);

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function runTest(name: string, testFn: () => Promise<void>): Promise<void> {
  console.log(`\n${separator}`);
  console.log(`TEST: ${name}`);
  console.log(separator);

  const start = Date.now();
  try {
    await testFn();
    const duration = Date.now() - start;
    results.push({ name, passed: true, duration });
    console.log(`✅ PASSED (${duration}ms)`);
  } catch (e) {
    const duration = Date.now() - start;
    const error = e instanceof Error ? e.message : String(e);
    results.push({ name, passed: false, error, duration });
    console.error(`❌ FAILED: ${error}`);
  }
}

async function main() {
  console.log('🧪 Testing ALL MCP Tools Against codebase-graph Project...\n');
  console.log(`Project root: ${process.cwd()}`);
  console.log('');

  // Test 1: Ping
  await runTest('ping', async () => {
    const result = await handleToolCall('ping', {});
    const typed = result as { status: string; message: string };
    console.log('Status:', typed.status);
    console.log('Message:', typed.message);
    if (typed.status !== 'ok') throw new Error('Ping failed');
  });

  // Test 2: Index Status
  await runTest('get_index_status', async () => {
    const status = await getIndexStatus({});
    console.log('Status:', status.status);
    console.log('Total Files:', status.totalFiles);
    console.log('Total Functions:', status.totalFunctions);
    console.log('Total Classes:', status.totalClasses);
    console.log('Total Edges:', status.totalEdges);
    console.log('Projects:', status.projects.length);
    const cgProject = status.projects.find(p => p.name === 'codebase-graph');
    if (cgProject) {
      console.log(`  codebase-graph: ${cgProject.fileCount} files`);
    }
    if (status.error) console.log('Error:', status.error);
  });

  // Test 3: Find Symbol - parseProject function
  await runTest('find_symbol (function: parseProject)', async () => {
    const result = await findSymbol({ name: 'parseProject', kind: 'function' });
    console.log('Found:', result.found);
    if (result.symbol) {
      console.log('Symbol:', result.symbol.name);
      console.log('Kind:', result.symbol.kind);
      console.log('File:', result.symbol.file?.split('/').pop());
      console.log('Line:', result.symbol.line);
    }
    if (result.alternatives && result.alternatives.length > 0) {
      console.log('Alternatives:', result.alternatives.length);
    }
    if (result.error) console.log('Error:', result.error);
  });

  // Test 4: Find Symbol - GraphClientImpl class
  await runTest('find_symbol (class: GraphClientImpl)', async () => {
    const result = await findSymbol({ name: 'GraphClientImpl', kind: 'class' });
    console.log('Found:', result.found);
    if (result.symbol) {
      console.log('Symbol:', result.symbol.name);
      console.log('Kind:', result.symbol.kind);
      console.log('File:', result.symbol.file?.split('/').pop());
      console.log('Line:', result.symbol.line);
    }
    if (result.error) console.log('Error:', result.error);
  });

  // Test 5: Search Code - by name (GraphClient)
  await runTest('search_code (name: GraphClient)', async () => {
    const result = await searchCode({ query: 'GraphClient', type: 'name', scope: 'all' });
    console.log('Total Results:', result.total);
    console.log('First 5 Results:');
    result.results.slice(0, 5).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.name} (${r.kind}) - ${r.file?.split('/').pop()}:${r.line}`);
    });
    if (result.error) console.log('Error:', result.error);
  });

  // Test 6: Query Graph - count files in codebase-graph project
  await runTest('query_graph (count codebase-graph files)', async () => {
    const result = await queryGraph({
      cypher: `MATCH (p:Project)-[:HAS_FILE]->(f:File)
               WHERE p.name = 'codebase-graph'
               RETURN count(f) as fileCount`
    });
    console.log('Success:', result.success);
    console.log('Data:', JSON.stringify(result.data, null, 2));
    if (result.error) console.log('Error:', result.error);
  });

  // Test 7: Query Graph - functions in codebase-graph project
  await runTest('query_graph (codebase-graph functions)', async () => {
    const result = await queryGraph({
      cypher: `MATCH (p:Project)-[:HAS_FILE]->(f:File)-[:CONTAINS]->(fn:Function)
               WHERE p.name = 'codebase-graph'
               RETURN fn.name as name, f.path as file, fn.startLine as line
               LIMIT 10`
    });
    console.log('Success:', result.success);
    console.log('Count:', result.count);
    if (result.data.length > 0) {
      result.data.slice(0, 5).forEach((row: Record<string, unknown>, i: number) => {
        const file = row.file as string | undefined;
        console.log(`  ${i + 1}. ${row.name} (${file?.split('/').pop()}:${row.line})`);
      });
    }
    if (result.error) console.log('Error:', result.error);
  });

  // Test 8: Query Graph - CALLS edges
  await runTest('query_graph (CALLS edges in codebase-graph)', async () => {
    const result = await queryGraph({
      cypher: `MATCH (p:Project)-[:HAS_FILE]->(f:File)-[:CONTAINS]->(caller:Function)-[r:CALLS]->(callee:Function)
               WHERE p.name = 'codebase-graph'
               RETURN caller.name as caller, callee.name as callee, r.line as line
               LIMIT 5`
    });
    console.log('Success:', result.success);
    console.log('CALLS edges found:', result.count);
    result.data.forEach((row: Record<string, unknown>, i: number) => {
      console.log(`  ${i + 1}. ${row.caller} → ${row.callee} (line ${row.line})`);
    });
    if (result.error) console.log('Error:', result.error);
  });

  // Test 9: Analyze Impact - parseProject
  await runTest('analyze_impact (parseProject)', async () => {
    const result = await analyzeImpact({ symbol: 'parseProject', depth: 3 });
    console.log('Direct Callers:', result.directCallers.length);
    result.directCallers.slice(0, 3).forEach(c => {
      console.log(`  - ${c.name} (${c.file?.split('/').pop()})`);
    });
    console.log('Transitive Callers:', result.transitiveCallers.length);
    console.log('Affected Files:', result.affectedFiles.length);
    console.log('Affected Tests:', result.affectedTests.length);
    console.log('Risk Score:', result.riskScore);
    console.log('Risk Level:', result.riskLevel);
    if (result.error) console.log('Error:', result.error);
  });

  // Test 10: Complexity Report
  await runTest('get_complexity_report', async () => {
    const result = await getComplexityReport({ threshold: 5, scope: 'all', sortBy: 'complexity' });
    console.log('Total Functions:', result.summary.totalFunctions);
    console.log('Over Threshold:', result.summary.overThreshold);
    console.log('Max Complexity:', result.summary.maxComplexity);
    console.log('Avg Complexity:', result.summary.avgComplexity);
    console.log('Top 5 Hotspots:');
    result.hotspots.slice(0, 5).forEach((h, i) => {
      console.log(`  ${i + 1}. ${h.name} (complexity: ${h.complexity}, file: ${h.file?.split('/').pop()})`);
    });
    if (result.error) console.log('Error:', result.error);
  });

  // Test 11: Symbol History
  await runTest('get_symbol_history (parseProject)', async () => {
    const result = await getSymbolHistory({ symbol: 'parseProject', limit: 5 });
    console.log('Symbol:', result.symbol);
    console.log('File:', result.file?.split('/').pop());
    console.log('Changes:', result.changes.length);
    result.changes.slice(0, 3).forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.date} - ${c.author}: ${c.message?.slice(0, 50)}`);
    });
    console.log('Authors:', result.authors.join(', '));
    console.log('Age (days):', result.ageDays);
    console.log('Change Frequency:', result.changeFrequency, 'commits/month');
    if (result.error) console.log('Error:', result.error);
  });

  // Test 12: Analyze Refactoring
  await runTest('analyze_file_for_refactoring (operations.ts)', async () => {
    const testFile = `${process.cwd()}/packages/graph/src/operations.ts`;
    const result = await analyzeFileForRefactoring({ file: testFile, threshold: 3 });
    console.log('File:', result.file.split('/').pop());
    console.log('Total Functions:', result.totalFunctions);
    console.log('Extraction Candidates:', result.extractionCandidates.length);
    result.extractionCandidates.slice(0, 3).forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.name} (coupling: ${c.couplingScore})`);
    });
    console.log('Responsibilities:', result.responsibilities.length);
    console.log('Avg Coupling Score:', result.averageCouplingScore);
    console.log('Coupling Level:', result.couplingLevel);
    if (result.error) console.log('Error:', result.error);
  });

  // Test 13: Explain Code
  await runTest('explain_code (GraphClient)', async () => {
    const testFile = `${process.cwd()}/packages/graph/src/client.ts`;
    const result = await explainCode({ file: testFile, start_line: 1, end_line: 100 });
    console.log('Code length:', result.code.length, 'chars');
    console.log('Dependencies:', result.dependencies.length);
    result.dependencies.slice(0, 3).forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.name} (${d.type})`);
    });
    console.log('Dependents:', result.dependents.length);
    console.log('Related Tests:', result.relatedTests.length);
    console.log('Complexity:', result.complexity);
    if (result.error) console.log('Error:', result.error);
  });

  // Test 14: Find Vulnerabilities
  await runTest('find_vulnerabilities (mcp-server)', async () => {
    const testDir = `${process.cwd()}/packages/mcp-server/src`;
    const result = await findVulnerabilities({ scope: testDir, severity: 'all', category: 'all' });
    console.log('Files Scanned:', result.filesScanned);
    console.log('Summary:', JSON.stringify(result.summary));
    console.log('Vulnerabilities Found:', result.vulnerabilities.length);
    result.vulnerabilities.slice(0, 3).forEach((v, i) => {
      console.log(`  ${i + 1}. [${v.severity}] ${v.type} in ${v.file?.split('/').pop()}:${v.line}`);
    });
    if (result.error) console.log('Error:', result.error);
  });

  // Test 15: Trace Data Flow
  await runTest('trace_data_flow (parseProject)', async () => {
    const testFile = `${process.cwd()}/packages/api/src/services/parseService.ts`;
    const result = await traceDataFlow({
      source: 'projectPath',
      file: testFile
    });
    console.log('Paths Found:', result.paths.length);
    result.paths.slice(0, 3).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.source} → ${p.sink}`);
      if (p.transformations.length > 0) {
        console.log(`      Transforms: ${p.transformations.slice(0, 2).join(' → ')}`);
      }
    });
    console.log('Vulnerabilities:', result.vulnerabilities.length);
    console.log('Sanitizers Found:', result.sanitizersFound.slice(0, 3).join(', ') || 'none');
    console.log('Summary:', result.summary);
    if (result.error) console.log('Error:', result.error);
  });

  // Test 16: Get Repo Map
  await runTest('get_repo_map', async () => {
    const result = await getRepoMap({ maxTokens: 1024 });
    console.log('Files Included:', result.filesIncluded);
    console.log('Symbols Included:', result.symbolsIncluded);
    console.log('Map Length:', result.map.length, 'chars');
    if (result.map.length > 0) {
      console.log('Map Preview:', result.map.slice(0, 200) + '...');
    }
    if (result.error) console.log('Error:', result.error);
  });

  // Test 17: Trigger Reindex (scoped file)
  await runTest('trigger_reindex (scoped file)', async () => {
    const testFile = `${process.cwd()}/packages/mcp-server/src/tools/indexStatus.ts`;
    const result = await triggerReindex({ mode: 'incremental', scope: testFile });
    console.log('Success:', result.success);
    console.log('Files Processed:', result.filesProcessed);
    console.log('Symbols Updated:', result.symbolsUpdated);
    console.log('Duration:', result.duration, 'ms');
    if (result.errors.length > 0) {
      console.log('Errors:', result.errors.join(', '));
    }
  });

  // Summary
  console.log(`\n${separator}`);
  console.log('📊 TEST SUMMARY');
  console.log(separator);

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((acc, r) => acc + r.duration, 0);

  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Total Time: ${totalTime}ms`);
  console.log('');

  if (failed > 0) {
    console.log('❌ Failed Tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
  }

  console.log('');
  console.log(passed === results.length ? '✅ All tests passed!' : '⚠️ Some tests failed');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
