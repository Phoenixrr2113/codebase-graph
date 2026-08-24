import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const roots = ['app', 'components/landing']
const sourceFiles = []

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await collect(path)
    } else if (['.ts', '.tsx'].includes(extname(entry.name))) {
      sourceFiles.push(path)
    }
  }
}

for (const root of roots) await collect(root)

const source = (await Promise.all(sourceFiles.map((path) => readFile(path, 'utf8')))).join('\n')

const requiredClaims = [
  'Local-first code graph for AI agents and developers.',
  'Not yet published',
  '25 actions',
  'ownership',
  '365 days',
  '10,000 commits',
  'nomic-ai/nomic-embed-text-v1.5',
  '768-dimensional',
  'Voyage',
  'OpenRouter',
  'migration',
  'FalkorDBLite',
  'Linux x64',
  'Apple silicon',
  'libomp',
  'openssl@3',
  'Externals',
  'Previous',
  'Load next',
  '59% smaller',
  '25 installed-package assertions',
  'codegraph-mcp',
  'codegraph-dashboard',
]

const forbiddenClaims = [
  /Jina/i,
  /@codegraph\/mcp/,
  /CODEGRAPH_DRIVER[^\n]*embedded/i,
  /0\.969/,
  /4 persona tools/i,
  /four persona tools/i,
  /withCodeGraph/,
  /every function/i,
  /\u2014/,
]

const failures = []
for (const claim of requiredClaims) {
  if (!source.includes(claim)) failures.push(`Missing required claim: ${claim}`)
}
for (const pattern of forbiddenClaims) {
  if (pattern.test(source)) failures.push(`Forbidden landing copy remains: ${pattern}`)
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(`Landing claim audit passed across ${sourceFiles.length} source files.\n`)
