/**
 * Cross-file CALLS resolution for Rust (batch-three-lang-extraction).
 *
 * Before this change, plugin-rust's extractCalls only ever emitted a
 * CallReference when the callee matched a function declared in the SAME
 * file (`localFunctionNames`), so no CALLS edge could ever cross a Rust
 * file boundary. This file locks in the honest subset of cross-file
 * resolution that's actually derivable per-file from Rust's module system:
 *
 *  - `mod foo;` (a module declared without a body) names a SIBLING FILE,
 *    resolvable via the `<dir>/foo.rs` and `<dir>/foo/mod.rs` conventions.
 *  - `use crate::a::b::item;`, `use self::...`, and `use super::...` are the
 *    only `use` anchors whose target FILE is derivable from directory
 *    convention alone. An external crate name is not (Cargo's registry
 *    isn't visible to a per-file extractor), so those stay unresolved.
 *
 * Every resolution is verified against real sibling files on disk
 * (existsSync-gated), nothing here is guessed from the import text alone.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Parser from 'tree-sitter';
import Rust from 'tree-sitter-rust';
import { extractCalls, extractFunctions } from '../src';

let parser: Parser;
let dir: string;

function parseCode(code: string): Parser.SyntaxNode {
  return parser.parse(code).rootNode;
}

describe('Rust extractCalls: cross-file resolution', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(Rust as any);
    dir = mkdtempSync(join(tmpdir(), 'rust-calls-cross-file-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('mod-declared sibling file', () => {
    it('resolves a qualified call through a bare `mod foo;` to the sibling file', () => {
      // dir/main.rs declares `mod foo;`, so its submodule lives at dir/foo.rs
      // (main.rs is a crate-root-style file, so submodules share its dir).
      writeFileSync(join(dir, 'foo.rs'), 'pub fn helper() {}\n');
      const filePath = join(dir, 'main.rs');
      const code = `
        mod foo;
        fn process() {
            foo::helper();
        }
      `;
      const calls = extractCalls(parseCode(code), filePath);

      const call = calls.find((c) => c.callerName === 'process' && c.calleeName === 'helper');
      expect(call).toBeDefined();
      expect(call?.calleeFilePath).toBe(join(dir, 'foo.rs'));
    });

    it('resolves a mod-directory submodule (dir/name/mod.rs form)', () => {
      mkdirSync(join(dir, 'barmod'), { recursive: true });
      writeFileSync(join(dir, 'barmod', 'mod.rs'), 'pub fn thing() {}\n');
      const filePath = join(dir, 'main.rs');
      const code = `
        mod barmod;
        fn run() {
            barmod::thing();
        }
      `;
      const calls = extractCalls(parseCode(code), filePath);

      const call = calls.find((c) => c.callerName === 'run' && c.calleeName === 'thing');
      expect(call).toBeDefined();
      expect(call?.calleeFilePath).toBe(join(dir, 'barmod', 'mod.rs'));
    });

    it('does not resolve a qualified call when the mod-declared sibling file does not exist', () => {
      const filePath = join(dir, 'main.rs');
      const code = `
        mod ghost;
        fn process() {
            ghost::thing();
        }
      `;
      const calls = extractCalls(parseCode(code), filePath);

      expect(calls.filter((c) => c.callerName === 'process')).toHaveLength(0);
    });
  });

  describe('use crate, self, and super path resolution', () => {
    let crateDir: string;

    beforeAll(() => {
      crateDir = mkdtempSync(join(tmpdir(), 'rust-crate-'));
      writeFileSync(join(crateDir, 'Cargo.toml'), '[package]\nname = "fixture"\nversion = "0.1.0"\n');
      mkdirSync(join(crateDir, 'src'), { recursive: true });
      writeFileSync(join(crateDir, 'src', 'utils.rs'), 'pub fn helper() {}\n');
      writeFileSync(join(crateDir, 'src', 'lib.rs'), 'mod utils;\n');
    });

    afterAll(() => {
      rmSync(crateDir, { recursive: true, force: true });
    });

    it('resolves a bare call imported via use crate::a::b', () => {
      const filePath = join(crateDir, 'src', 'main.rs');
      const code = `
        use crate::utils::helper;
        fn process() {
            helper();
        }
      `;
      const calls = extractCalls(parseCode(code), filePath);

      const call = calls.find((c) => c.callerName === 'process' && c.calleeName === 'helper');
      expect(call).toBeDefined();
      expect(call?.calleeFilePath).toBe(join(crateDir, 'src', 'utils.rs'));
    });

    it('resolves a qualified call through a use crate::a module import', () => {
      const filePath = join(crateDir, 'src', 'main.rs');
      const code = `
        use crate::utils;
        fn process() {
            utils::helper();
        }
      `;
      const calls = extractCalls(parseCode(code), filePath);

      const call = calls.find((c) => c.callerName === 'process' && c.calleeName === 'helper');
      expect(call).toBeDefined();
      expect(call?.calleeFilePath).toBe(join(crateDir, 'src', 'utils.rs'));
    });

    it('resolves an aliased use import at the call site, but emits the DECLARED name at the target file', () => {
      // The call site uses the local alias (`aliased_helper`), but the real
      // Function node lives in utils.rs under its declared name (`helper`).
      // Edge creation matches Function nodes by (filePath, name), so emitting
      // the alias here would silently drop the edge: nothing in utils.rs is
      // named `aliased_helper`. calleeName must be the name actually
      // declared at calleeFilePath, not the call-site identifier.
      const filePath = join(crateDir, 'src', 'main.rs');
      const code = `
        use crate::utils::helper as aliased_helper;
        fn process() {
            aliased_helper();
        }
      `;
      const calls = extractCalls(parseCode(code), filePath);

      const call = calls.find((c) => c.callerName === 'process');
      expect(call).toBeDefined();
      expect(call?.calleeName).toBe('helper');
      expect(call?.calleeFilePath).toBe(join(crateDir, 'src', 'utils.rs'));
      // The alias itself must never leak into calleeName: no node is ever
      // declared "aliased_helper" anywhere, so a downstream Function-node
      // match on (calleeFilePath, calleeName) would find nothing.
      expect(calls.some((c) => c.calleeName === 'aliased_helper')).toBe(false);
    });

    it('emits a (calleeName, calleeFilePath) pair matching the target Function node identity for an aliased import', () => {
      // Shape test mirroring the reviewer's live-graph reproduction
      // (fixture-rs-alias: `mod util; use crate::util::helper as h; h();`).
      // Node identity is Function:{filePath}:{name} (see generateEntityId /
      // buildCallEdgesFromRefs) - the emitted CallReference must carry
      // exactly the (filePath, name) pair the real target node was created
      // with, not the call-site alias.
      const targetFunctions = extractFunctions(
        parseCode('pub fn helper() -> i32 { 7 }'),
        join(crateDir, 'src', 'utils.rs'),
      );
      const targetFn = targetFunctions.find((f) => f.name === 'helper');
      expect(targetFn).toBeDefined();

      const filePath = join(crateDir, 'src', 'main.rs');
      const code = `
        use crate::utils::helper as h;
        fn main() {
            let _ = h();
        }
      `;
      const calls = extractCalls(parseCode(code), filePath);
      const call = calls.find((c) => c.callerName === 'main');

      expect(call).toBeDefined();
      // The pair the pipeline uses to build Function:<calleeFilePath>:<calleeName>
      // must line up with the pair the real node was extracted with.
      expect(call?.calleeFilePath).toBe(targetFn?.filePath);
      expect(call?.calleeName).toBe(targetFn?.name);
    });

    it('does not resolve use crate::missing::helper (target file absent)', () => {
      const filePath = join(crateDir, 'src', 'main.rs');
      const code = `
        use crate::missing::helper;
        fn process() {
            helper();
        }
      `;
      const calls = extractCalls(parseCode(code), filePath);

      expect(calls.filter((c) => c.callerName === 'process')).toHaveLength(0);
    });

    it('does not resolve an external crate import, since no anchor can help', () => {
      const filePath = join(crateDir, 'src', 'main.rs');
      const code = `
        use rand::Rng;
        fn process() {
            Rng::method();
        }
      `;
      const calls = extractCalls(parseCode(code), filePath);

      expect(calls.filter((c) => c.callerName === 'process')).toHaveLength(0);
    });

    it('resolves use super::item from a nested module file', () => {
      writeFileSync(join(crateDir, 'src', 'lib.rs'), 'mod utils;\npub fn top_helper() {}\n');
      const filePath = join(crateDir, 'src', 'utils.rs');
      const code = `
        use super::top_helper;
        fn process() {
            top_helper();
        }
      `;
      const calls = extractCalls(parseCode(code), filePath);

      const call = calls.find((c) => c.callerName === 'process' && c.calleeName === 'top_helper');
      expect(call).toBeDefined();
      expect(call?.calleeFilePath).toBe(join(crateDir, 'src', 'lib.rs'));
    });
  });

  describe('existing same-file behavior is unaffected by context being absent', () => {
    it('still resolves plain same-file calls with no calleeFilePath set', () => {
      const filePath = join(dir, 'plain.rs');
      const code = `
        fn validate() -> bool { true }
        fn process() {
            validate();
        }
      `;
      const calls = extractCalls(parseCode(code), filePath);

      const call = calls.find((c) => c.callerName === 'process' && c.calleeName === 'validate');
      expect(call).toBeDefined();
      expect(call?.calleeFilePath).toBeUndefined();
    });
  });
});
