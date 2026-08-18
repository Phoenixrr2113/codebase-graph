/**
 * Core Config Unit Tests
 *
 * Tests the MCP context config persistence layer.
 * Uses a temp directory via mocked os.homedir() to avoid touching real config.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Create temp home directory for all tests
const tempHome = mkdtempSync(join(tmpdir(), 'codegraph-config-test-'));

// Mock os.homedir() BEFORE importing config module
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => tempHome,
  };
});

// Now import the config module (it will use our mocked homedir)
const {
  loadConfig,
  saveConfig,
  needsSetup,
  getActiveProjectPaths,
  setActiveProjects,
  updateLastUsed,
  getLastUsed,
  isStale,
  clearConfig,
  STALENESS_THRESHOLD_MS,
} = await import('../config');

// Derived paths (match config.ts logic)
const CONFIG_DIR = join(tempHome, '.codegraph');
const CONFIG_FILE = join(CONFIG_DIR, 'mcp-context.json');

describe('Core Config', () => {
  beforeEach(async () => {
    // Clean up config file between tests
    try {
      if (existsSync(CONFIG_FILE)) {
        const { unlink } = await import('fs/promises');
        await unlink(CONFIG_FILE);
      }
    } catch {
      // best effort
    }
  });

  afterAll(() => {
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  // ============================================================
  // loadConfig
  // ============================================================

  describe('loadConfig', () => {
    it('returns null when no config file exists', async () => {
      const config = await loadConfig();
      expect(config).toBeNull();
    });

    it('returns parsed config when file exists', async () => {
      const data = {
        activeProjects: ['/home/user/project'],
        lastUpdated: '2025-01-01T00:00:00.000Z',
        setupComplete: true,
      };
      const { mkdir, writeFile } = await import('fs/promises');
      await mkdir(CONFIG_DIR, { recursive: true });
      await writeFile(CONFIG_FILE, JSON.stringify(data));

      const config = await loadConfig();
      expect(config).not.toBeNull();
      expect(config!.activeProjects).toEqual(['/home/user/project']);
      expect(config!.setupComplete).toBe(true);
    });

    it('returns null on corrupt JSON', async () => {
      const { mkdir, writeFile } = await import('fs/promises');
      await mkdir(CONFIG_DIR, { recursive: true });
      await writeFile(CONFIG_FILE, 'not valid json {{{');

      const config = await loadConfig();
      expect(config).toBeNull();
    });
  });

  // ============================================================
  // saveConfig
  // ============================================================

  describe('saveConfig', () => {
    it('creates config directory if missing', async () => {
      // Ensure config dir does not exist
      try { rmSync(CONFIG_DIR, { recursive: true, force: true }); } catch { /* noop */ }

      await saveConfig({
        activeProjects: [],
        lastUpdated: new Date().toISOString(),
        setupComplete: false,
      });

      expect(existsSync(CONFIG_DIR)).toBe(true);
      expect(existsSync(CONFIG_FILE)).toBe(true);
    });

    it('writes valid JSON', async () => {
      const config = {
        activeProjects: ['/test/project-a', '/test/project-b'],
        lastUpdated: '2025-06-15T12:00:00.000Z',
        setupComplete: true,
      };

      await saveConfig(config);

      const raw = readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.activeProjects).toEqual(['/test/project-a', '/test/project-b']);
      expect(parsed.setupComplete).toBe(true);
    });

    it('performs atomic write (temp file + rename)', async () => {
      // The fact that saveConfig uses rename means the config file is never
      // in a partially-written state. We verify by saving and reading back.
      const config = {
        activeProjects: ['/atomic/test'],
        lastUpdated: new Date().toISOString(),
        setupComplete: true,
      };

      await saveConfig(config);

      // After rename, tmp file should not exist
      expect(existsSync(CONFIG_FILE + '.tmp')).toBe(false);
      expect(existsSync(CONFIG_FILE)).toBe(true);
    });

    it('uses distinct temp files for concurrent writes in the same millisecond', async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_234_567);

      try {
        await expect(Promise.all([
          saveConfig({
            activeProjects: ['/concurrent/a'],
            lastUpdated: new Date().toISOString(),
            setupComplete: true,
          }),
          saveConfig({
            activeProjects: ['/concurrent/b'],
            lastUpdated: new Date().toISOString(),
            setupComplete: true,
          }),
        ])).resolves.toEqual([undefined, undefined]);
      } finally {
        now.mockRestore();
      }
    });
  });

  // ============================================================
  // needsSetup
  // ============================================================

  describe('needsSetup', () => {
    it('returns true when no config exists', async () => {
      expect(await needsSetup()).toBe(true);
    });

    it('returns false when setupComplete is true', async () => {
      await saveConfig({
        activeProjects: ['/project'],
        lastUpdated: new Date().toISOString(),
        setupComplete: true,
      });

      expect(await needsSetup()).toBe(false);
    });
  });

  // ============================================================
  // getActiveProjectPaths
  // ============================================================

  describe('getActiveProjectPaths', () => {
    it('returns empty array when no config exists', async () => {
      const paths = await getActiveProjectPaths();
      expect(paths).toEqual([]);
    });

    it('returns active projects from config', async () => {
      await saveConfig({
        activeProjects: ['/project-a', '/project-b'],
        lastUpdated: new Date().toISOString(),
        setupComplete: true,
      });

      const paths = await getActiveProjectPaths();
      expect(paths).toEqual(['/project-a', '/project-b']);
    });
  });

  // ============================================================
  // setActiveProjects
  // ============================================================

  describe('setActiveProjects', () => {
    it('saves config with setupComplete=true', async () => {
      await setActiveProjects(['/new/project']);

      const config = await loadConfig();
      expect(config).not.toBeNull();
      expect(config!.activeProjects).toEqual(['/new/project']);
      expect(config!.setupComplete).toBe(true);
      expect(config!.lastUpdated).toBeTruthy();
    });
  });

  // ============================================================
  // isStale / updateLastUsed / getLastUsed
  // ============================================================

  describe('isStale', () => {
    it('returns true when never used (no config)', async () => {
      expect(await isStale()).toBe(true);
    });

    it('returns true when lastUsed is old', async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48 hours ago
      await saveConfig({
        activeProjects: [],
        lastUpdated: new Date().toISOString(),
        setupComplete: true,
        lastUsed: oldDate,
      });

      expect(await isStale()).toBe(true);
    });

    it('returns false when recently used', async () => {
      await saveConfig({
        activeProjects: [],
        lastUpdated: new Date().toISOString(),
        setupComplete: true,
        lastUsed: new Date().toISOString(), // just now
      });

      expect(await isStale()).toBe(false);
    });
  });

  describe('updateLastUsed', () => {
    it('updates the lastUsed timestamp', async () => {
      await saveConfig({
        activeProjects: [],
        lastUpdated: new Date().toISOString(),
        setupComplete: true,
      });

      await updateLastUsed();

      const lastUsed = await getLastUsed();
      expect(lastUsed).toBeTruthy();
      // Should be very recent (within last 5 seconds)
      const elapsed = Date.now() - new Date(lastUsed!).getTime();
      expect(elapsed).toBeLessThan(5000);
    });
  });

  // ============================================================
  // clearConfig
  // ============================================================

  describe('clearConfig', () => {
    it('removes config file', async () => {
      await saveConfig({
        activeProjects: [],
        lastUpdated: new Date().toISOString(),
        setupComplete: true,
      });

      expect(existsSync(CONFIG_FILE)).toBe(true);
      await clearConfig();
      expect(existsSync(CONFIG_FILE)).toBe(false);
    });
  });
});
