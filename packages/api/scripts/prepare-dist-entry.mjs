import { rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = resolve(packageDirectory, 'dist');
const entryPath = resolve(distDirectory, 'index.js');
const serverPath = resolve(distDirectory, 'server.js');
const loaderPath = resolve(distDirectory, 'esm-loader.js');

await unlink(serverPath).catch(() => undefined);
await rename(entryPath, serverPath);

await writeFile(loaderPath, `export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (originalError) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw originalError;
    for (const candidate of [\`${'${specifier}'}.js\`, \`${'${specifier}'}/index.js\`]) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        // Try the next Node ESM file form.
      }
    }
    throw originalError;
  }
}
`, 'utf8');

await writeFile(entryPath, `import { register } from 'node:module';

register('./esm-loader.js', import.meta.url);
const server = await import('./server.js');

export const app = server.app;
`, 'utf8');
