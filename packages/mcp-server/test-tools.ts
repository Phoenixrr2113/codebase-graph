/**
 * Manual test script for MCP tools
 * Run with: npx tsx packages/mcp-server/test-tools.ts
 */

import { getIndexStatus } from './src/tools/indexStatus.js';
import { findSymbol } from './src/tools/findSymbol.js';
import { queryGraph } from './src/tools/queryGraph.js';
import { analyzeImpact } from './src/tools/analyzeImpact.js';

async function main() {
  console.log('🧪 Testing MCP Tools against FalkorDB...\n');

  // Test 1: Index Status
  console.log('='.repeat(60));
  console.log('TEST 1: get_index_status');
  console.log('='.repeat(60));
  try {
    const status = await getIndexStatus({});
    console.log('Status:', status.status);
    console.log('Total Files:', status.totalFiles);
    console.log('Total Functions:', status.totalFunctions);
    console.log('Total Classes:', status.totalClasses);
    console.log('Total Edges:', status.totalEdges);
    console.log('Projects:', status.projects.length);
    if (status.projects.length > 0) {
      status.projects.forEach(p => {
        console.log(`  - ${p.name}: ${p.fileCount} files`);
      });
    }
    if (status.error) console.log('Error:', status.error);
  } catch (e) {
    console.error('Error:', e);
  }

  // Test 2: Find Symbol - look for createClient
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: find_symbol (createClient)');
  console.log('='.repeat(60));
  try {
    const result = await findSymbol({ name: 'createClient', kind: 'function' });
    console.log('Found:', result.found);
    if (result.symbol) {
      console.log('Symbol:', result.symbol.name);
      console.log('Kind:', result.symbol.kind);
      console.log('File:', result.symbol.file);
      console.log('Line:', result.symbol.line);
    }
    if (result.alternatives && result.alternatives.length > 0) {
      console.log('Alternatives:', result.alternatives.length);
    }
    if (result.error) console.log('Error:', result.error);
  } catch (e) {
    console.error('Error:', e);
  }

  // Test 3: Find Symbol - look for parseProject
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: find_symbol (parseProject)');
  console.log('='.repeat(60));
  try {
    const result = await findSymbol({ name: 'parseProject', kind: 'any' });
    console.log('Found:', result.found);
    if (result.symbol) {
      console.log('Symbol:', result.symbol.name);
      console.log('Kind:', result.symbol.kind);
      console.log('File:', result.symbol.file);
      console.log('Line:', result.symbol.line);
    }
    if (result.error) console.log('Error:', result.error);
  } catch (e) {
    console.error('Error:', e);
  }

  // Test 4: Query Graph - count files
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: query_graph (count files)');
  console.log('='.repeat(60));
  try {
    const result = await queryGraph({
      cypher: 'MATCH (f:File) RETURN count(f) as fileCount'
    });
    console.log('Success:', result.success);
    console.log('Data:', JSON.stringify(result.data, null, 2));
    console.log('Count:', result.count);
    if (result.error) console.log('Error:', result.error);
  } catch (e) {
    console.error('Error:', e);
  }

  // Test 5: Query Graph - find functions in codebase-graph
  console.log('\n' + '='.repeat(60));
  console.log('TEST 5: query_graph (functions in codebase-graph)');
  console.log('='.repeat(60));
  try {
    const result = await queryGraph({
      cypher: `MATCH (f:Function) 
               WHERE f.filePath CONTAINS 'codebase-graph' 
               RETURN f.name as name, f.filePath as file, f.startLine as line 
               LIMIT 10`
    });
    console.log('Success:', result.success);
    console.log('Count:', result.count);
    if (result.data.length > 0) {
      result.data.forEach((row: any, i: number) => {
        console.log(`  ${i + 1}. ${row.name} (${row.file?.split('/').pop()}:${row.line})`);
      });
    }
    if (result.error) console.log('Error:', result.error);
  } catch (e) {
    console.error('Error:', e);
  }
  // Test 6: Analyze Impact - test with createClient function
  console.log('\n' + '='.repeat(60));
  console.log('TEST 6: analyze_impact (createClient)');
  console.log('='.repeat(60));
  try {
    const result = await analyzeImpact({ symbol: 'createClient', depth: 3 });
    console.log('Direct Callers:', result.directCallers.length);
    result.directCallers.slice(0, 5).forEach(c => {
      console.log(`  - ${c.name} (${c.file?.split('/').pop()})`);
    });
    console.log('Transitive Callers:', result.transitiveCallers.length);
    console.log('Affected Files:', result.affectedFiles.length);
    console.log('Affected Tests:', result.affectedTests.length);
    console.log('Risk Score:', result.riskScore);
    console.log('Risk Level:', result.riskLevel);
    console.log('Recommendation:', result.recommendation);
    if (result.error) console.log('Error:', result.error);
  } catch (e) {
    console.error('Error:', e);
  }

  // Test 7: Complexity Report
  console.log('\n' + '='.repeat(60));
  console.log('TEST 7: get_complexity_report');
  console.log('='.repeat(60));
  try {
    const { getComplexityReport } = await import('./src/tools/complexityReport.js');
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
  } catch (e) {
    console.error('Error:', e);
  }

  // Test 8: Search Code
  console.log('\n' + '='.repeat(60));
  console.log('TEST 8: search_code');
  console.log('='.repeat(60));
  try {
    const { searchCode } = await import('./src/tools/searchCode.js');
    const result = await searchCode({ query: 'Client', type: 'name', scope: 'all' });
    console.log('Total Results:', result.total);
    console.log('First 5 Results:');
    result.results.slice(0, 5).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.name} (${r.kind}) - ${r.file?.split('/').pop()}:${r.line}`);
    });
    if (result.error) console.log('Error:', result.error);
  } catch (e) {
    console.error('Error:', e);
  }

  console.log('\n✅ Tests complete!');
  process.exit(0);
}

main().catch(console.error);

