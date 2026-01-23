/**
 * Query graph to discover codebase-specific symbols for testing
 */
import { queryGraph } from './src/tools/queryGraph';

async function main() {
  console.log('Querying graph for codebase-graph symbols...\n');

  // First, get projects to find codebase-graph project ID
  const projects = await queryGraph({
    cypher: "MATCH (p:Project) RETURN p.id as id, p.name as name, p.rootPath as path, p.fileCount as fileCount"
  });
  console.log('=== PROJECTS ===');
  console.log(JSON.stringify(projects.data, null, 2));

  // Get functions for codebase-graph project
  const funcs = await queryGraph({
    cypher: `
      MATCH (p:Project)-[:HAS_FILE]->(f:File)-[:CONTAINS]->(fn:Function)
      WHERE p.name = 'codebase-graph'
      RETURN fn.name as name, f.path as file, fn.startLine as line, fn.complexity as complexity
      LIMIT 15
    `
  });
  console.log('\n=== FUNCTIONS ===');
  console.log(JSON.stringify(funcs.data, null, 2));

  // Get classes for codebase-graph project
  const classes = await queryGraph({
    cypher: `
      MATCH (p:Project)-[:HAS_FILE]->(f:File)-[:CONTAINS]->(c:Class)
      WHERE p.name = 'codebase-graph'
      RETURN c.name as name, f.path as file, c.startLine as line
      LIMIT 10
    `
  });
  console.log('\n=== CLASSES ===');
  console.log(JSON.stringify(classes.data, null, 2));

  // Get interfaces for codebase-graph project
  const interfaces = await queryGraph({
    cypher: `
      MATCH (p:Project)-[:HAS_FILE]->(f:File)-[:CONTAINS]->(i:Interface)
      WHERE p.name = 'codebase-graph'
      RETURN i.name as name, f.path as file, i.startLine as line
      LIMIT 10
    `
  });
  console.log('\n=== INTERFACES ===');
  console.log(JSON.stringify(interfaces.data, null, 2));

  // Get CALLS edges for codebase-graph project
  const calls = await queryGraph({
    cypher: `
      MATCH (p:Project)-[:HAS_FILE]->(f:File)-[:CONTAINS]->(caller:Function)-[r:CALLS]->(callee:Function)
      WHERE p.name = 'codebase-graph'
      RETURN caller.name as caller, callee.name as callee, f.path as file, r.line as line
      LIMIT 10
    `
  });
  console.log('\n=== CALLS EDGES ===');
  console.log(JSON.stringify(calls.data, null, 2));

  // Get IMPORTS edges
  const imports = await queryGraph({
    cypher: `
      MATCH (p:Project)-[:HAS_FILE]->(f:File)-[r:IMPORTS]->(target:File)
      WHERE p.name = 'codebase-graph'
      RETURN f.path as file, target.path as imports
      LIMIT 10
    `
  });
  console.log('\n=== IMPORTS EDGES ===');
  console.log(JSON.stringify(imports.data, null, 2));

  // Get files for codebase-graph project
  const files = await queryGraph({
    cypher: `
      MATCH (p:Project)-[:HAS_FILE]->(f:File)
      WHERE p.name = 'codebase-graph'
      RETURN f.path as path, f.name as name
      LIMIT 10
    `
  });
  console.log('\n=== FILES ===');
  console.log(JSON.stringify(files.data, null, 2));
}

main().catch(console.error);
