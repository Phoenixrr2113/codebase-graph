import { getTools, handleToolCall } from './src/tools/consolidated';
import { clearConfig } from './src/config';

async function test() {
  console.log('=== Testing Project Onboarding Flow ===\n');
  
  // Clear config to simulate first use
  console.log('1. Clearing config (simulating first use)...');
  await clearConfig();
  console.log('   Config cleared.\n');

  // Test 2: Get tools - should have setup warning in description
  console.log('2. Getting tools (should show setup warning)...');
  try {
    const tools = await getTools();
    console.log(`   Found ${tools.length} tools: ${tools.map(t => t.name).join(', ')}`);

    const searchTool = tools.find(t => t.name === 'search');
    if (searchTool) {
      console.log('\n   Search tool description (first 300 chars):');
      console.log('   ' + searchTool.description.slice(0, 300).replace(/\n/g, '\n   '));
    }
  } catch (e: any) {
    console.log('   Error:', e.message);
  }

  // Test 3: Call search without setup - should return setup prompt
  console.log('\n3. Calling search without setup (should prompt)...');
  try {
    const result = await handleToolCall('search', { query: 'parse' });
    console.log('   Result:', JSON.stringify(result, null, 2).slice(0, 600));
  } catch (e: any) {
    console.log('   Error:', e.message);
  }

  // Test 4: Configure projects
  console.log('\n4. Calling configure_projects({ action: "status" })...');
  try {
    const result = await handleToolCall('configure_projects', { action: 'status' });
    console.log('   Result:', JSON.stringify(result, null, 2).slice(0, 800));
  } catch (e: any) {
    console.log('   Error:', e.message);
  }
  
  // Test 5: Set active project
  console.log('\n5. Setting active project to codebase-graph...');
  try {
    const result = await handleToolCall('configure_projects', {
      action: 'set',
      projects: ['codebase-graph']
    });
    console.log('   Result:', JSON.stringify(result, null, 2).slice(0, 500));
  } catch (e: any) {
    console.log('   Error:', e.message);
  }
  
  // Test 6: Now search should work
  console.log('\n6. Calling search after setup...');
  try {
    const result = await handleToolCall('search', { query: 'parse', limit: 3 });
    console.log('   Result:', JSON.stringify(result, null, 2).slice(0, 500));
  } catch (e: any) {
    console.log('   Error:', e.message);
  }
  
  console.log('\n=== Test Complete ===');
  process.exit(0);
}

test();
