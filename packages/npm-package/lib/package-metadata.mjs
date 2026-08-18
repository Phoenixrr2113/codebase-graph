const dependencySources = [
  ['@huggingface/transformers', '@codegraph/plugin-nlp', 'dependencies'],
  ['@modelcontextprotocol/sdk', '@codegraph/mcp-server', 'dependencies'],
  ['tree-sitter', '@codegraph/plugin-go', 'dependencies'],
  ['tree-sitter-go', '@codegraph/plugin-go', 'dependencies'],
  ['tree-sitter-python', '@codegraph/plugin-python', 'dependencies'],
  ['tree-sitter-rust', '@codegraph/plugin-rust', 'dependencies'],
  ['tree-sitter-typescript', '@codegraph/plugin-typescript', 'dependencies'],
  ['tree-sitter-c-sharp', '@codegraph/plugin-languages', 'dependencies'],
  ['tree-sitter-java', '@codegraph/plugin-languages', 'dependencies'],
  ['tree-sitter-php', '@codegraph/plugin-languages', 'dependencies'],
];

const embeddedPlatformPackages = [
  '@falkordblite/darwin-arm64',
  '@falkordblite/linux-x64',
];

function requireRecord(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireString(record, key, label) {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function requireManifest(manifests, packageName) {
  const manifest = requireRecord(manifests[packageName], `dependencyManifests.${packageName}`);
  if (requireString(manifest, 'name', packageName) !== packageName) {
    throw new TypeError(`${packageName}.name must match its workspace key`);
  }
  return manifest;
}

function requireDependencyRange(manifests, dependencyName, packageName, sectionName) {
  const manifest = requireManifest(manifests, packageName);
  const section = requireRecord(manifest[sectionName], `${packageName}.${sectionName}`);
  const range = section[dependencyName];
  if (typeof range !== 'string' || range.length === 0 || range.startsWith('workspace:')) {
    throw new TypeError(`${packageName} must provide a publishable ${dependencyName} range`);
  }
  return range;
}

function cloneRecord(record, key, label) {
  return structuredClone(requireRecord(record[key], `${label}.${key}`));
}

function sortedRecord(entries) {
  return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));
}

export function createPublishedManifest({ packageManifest, dependencyManifests }) {
  const source = requireRecord(packageManifest, 'packageManifest');
  const manifests = requireRecord(dependencyManifests, 'dependencyManifests');
  const dependencies = new Map();

  for (const [dependencyName, packageName, sectionName] of dependencySources) {
    dependencies.set(
      dependencyName,
      requireDependencyRange(manifests, dependencyName, packageName, sectionName),
    );
  }

  const languageManifest = requireManifest(manifests, '@codegraph/plugin-languages');
  const languageOptionals = requireRecord(
    languageManifest.optionalDependencies,
    '@codegraph/plugin-languages.optionalDependencies',
  );
  const optionalDependencies = new Map();
  for (const [name, range] of Object.entries(languageOptionals)) {
    if (typeof range !== 'string' || range.length === 0 || range.startsWith('workspace:')) {
      throw new TypeError(`@codegraph/plugin-languages must provide a publishable ${name} range`);
    }
    optionalDependencies.set(name, range);
  }
  optionalDependencies.set(
    'falkordblite',
    requireDependencyRange(manifests, 'falkordblite', '@codegraph/graph', 'devDependencies'),
  );
  for (const packageName of embeddedPlatformPackages) {
    optionalDependencies.set(
      packageName,
      requireDependencyRange(manifests, packageName, '@codegraph/graph', 'optionalDependencies'),
    );
  }

  const name = requireString(source, 'name', 'packageManifest');
  if (name !== 'codegraph-mcp') {
    throw new TypeError('packageManifest.name must be codegraph-mcp');
  }
  const publishConfig = cloneRecord(source, 'publishConfig', 'packageManifest');
  if (publishConfig.access !== 'public') {
    throw new TypeError('packageManifest.publishConfig.access must be public');
  }

  return {
    name,
    version: requireString(source, 'version', 'packageManifest'),
    description: requireString(source, 'description', 'packageManifest'),
    type: 'module',
    main: './server/index.mjs',
    bin: cloneRecord(source, 'bin', 'packageManifest'),
    keywords: structuredClone(source.keywords),
    author: cloneRecord(source, 'author', 'packageManifest'),
    license: requireString(source, 'license', 'packageManifest'),
    homepage: requireString(source, 'homepage', 'packageManifest'),
    repository: cloneRecord(source, 'repository', 'packageManifest'),
    bugs: cloneRecord(source, 'bugs', 'packageManifest'),
    publishConfig: { access: 'public' },
    engines: cloneRecord(source, 'engines', 'packageManifest'),
    files: ['bin/', 'server/', 'LICENSE', 'README.md'],
    dependencies: sortedRecord(dependencies),
    optionalDependencies: sortedRecord(optionalDependencies),
  };
}
