/**
 * Test script for @codegraph/plugin-markdown
 * Run with: npx tsx packages/plugin-markdown/test-plugin.ts
 */

import { parseMarkdownContent } from './src/index';

const testMarkdown = `---
name: test-skill
description: A test skill for verification
metadata:
  openclaw:
    emoji: "🧪"
    requires:
      bins: ["test-cli"]
---

# Test Skill Documentation

This is a test markdown file to verify the plugin works correctly.

## Installation

Install the CLI tool:

\`\`\`bash
npm install -g test-cli
\`\`\`

## Usage

Here's how to use it:

\`\`\`typescript
import { testFunction } from 'test-cli';

testFunction('hello');
\`\`\`

## Links

- See [Installation Guide](./install.md) for details
- Check the [API Reference](./api.md#functions)
- External: [Documentation](https://example.com/docs)

### Nested Section

This is a nested section under Links.

## Troubleshooting

If you encounter issues, check the logs.
`;

async function main() {
  console.log('Testing @codegraph/plugin-markdown...\n');

  try {
    const result = await parseMarkdownContent(testMarkdown, '/test/SKILL.md');

    console.log('=== Document ===');
    console.log(`  Path: ${result.document.path}`);
    console.log(`  Title: ${result.document.title}`);
    console.log(`  Frontmatter keys: ${Object.keys(result.document.frontmatter).join(', ')}`);
    console.log(`  Hash: ${result.document.hash}`);

    console.log('\n=== Sections ===');
    for (const section of result.sections) {
      const indent = '  '.repeat(section.level);
      console.log(`${indent}[H${section.level}] ${section.heading} (lines ${section.startLine}-${section.endLine})`);
    }

    console.log('\n=== Code Blocks ===');
    for (const cb of result.codeBlocks) {
      console.log(`  [${cb.language}] line ${cb.startLine}: ${cb.content.slice(0, 40).replace(/\n/g, '\\n')}...`);
    }

    console.log('\n=== Links ===');
    for (const link of result.links) {
      const type = link.isInternal ? 'internal' : 'external';
      const anchor = link.anchor ? `#${link.anchor}` : '';
      console.log(`  [${type}] "${link.text}" -> ${link.target}${anchor}`);
    }

    console.log('\n✅ Synthetic test passed!');

    // Test with real file
    console.log('\n\n=== Testing with Real File ===');
    const { parseMarkdownFile } = await import('./src/index');
    const realResult = await parseMarkdownFile('/Users/randywilson/Desktop/openclaw/skills/github/SKILL.md');

    console.log(`  Title: ${realResult.document.title}`);
    console.log(`  Frontmatter: ${JSON.stringify(realResult.document.frontmatter, null, 2)}`);
    console.log(`  Sections: ${realResult.sections.length}`);
    console.log(`  Code Blocks: ${realResult.codeBlocks.length}`);
    console.log(`  Links: ${realResult.links.length}`);

    console.log('\n✅ Real file test passed!');
  } catch (error) {
    console.error('❌ Plugin test failed:', error);
    process.exit(1);
  }
}

main();
