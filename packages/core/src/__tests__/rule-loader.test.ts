/**
 * Rule Loader — Unit Tests
 *
 * Verifies that externalized security rules load correctly
 * from JSON files, compile patterns into the right runtime types, and
 * provide consistent data between consumers (security.ts, dataflow.ts).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSecurityRules,
  resetRuleCache,
  getVulnerabilityTypes,
} from '../analysis/rules/rule-loader';

// Reset cache before each test to ensure fresh loads
beforeEach(() => {
  resetRuleCache();
});

// ============================================================================
// Security Rules Loading
// ============================================================================

describe('getSecurityRules', () => {
  it('loads security rules from JSON successfully', () => {
    const rules = getSecurityRules();
    expect(rules).toBeDefined();
  });

  it('returns cached rules on subsequent calls', () => {
    const first = getSecurityRules();
    const second = getSecurityRules();
    expect(first).toBe(second); // same object reference
  });

  it('returns fresh rules after cache reset', () => {
    const first = getSecurityRules();
    resetRuleCache();
    const second = getSecurityRules();
    // Deep-equal but not same reference
    expect(second).not.toBe(first);
    expect(second.sanitizers.size).toBe(first.sanitizers.size);
  });

  // --- Taint Sources ---
  describe('taintSources', () => {
    it('has user input sources', () => {
      const { taintSources } = getSecurityRules();
      expect(taintSources.userInput.size).toBeGreaterThan(0);
      expect(taintSources.userInput.has('req.body')).toBe(true);
      expect(taintSources.userInput.has('req.params')).toBe(true);
      expect(taintSources.userInput.has('req.query')).toBe(true);
    });

    it('has environment sources', () => {
      const { taintSources } = getSecurityRules();
      expect(taintSources.environment.size).toBeGreaterThan(0);
      expect(taintSources.environment.has('process.env')).toBe(true);
    });

    it('has file read sources', () => {
      const { taintSources } = getSecurityRules();
      expect(taintSources.fileRead.size).toBeGreaterThan(0);
      expect(taintSources.fileRead.has('readFile')).toBe(true);
      expect(taintSources.fileRead.has('fs.readFileSync')).toBe(true);
    });

    it('has API response sources', () => {
      const { taintSources } = getSecurityRules();
      expect(taintSources.apiResponse.size).toBeGreaterThan(0);
    });

    it('"all" set is union of all categories', () => {
      const { taintSources } = getSecurityRules();
      const expectedSize =
        taintSources.userInput.size +
        taintSources.environment.size +
        taintSources.fileRead.size +
        taintSources.apiResponse.size;
      expect(taintSources.all.size).toBe(expectedSize);
    });

    it('categorized array has category labels', () => {
      const { taintSources } = getSecurityRules();
      expect(taintSources.categorized.length).toBe(taintSources.all.size);

      const categories = new Set(taintSources.categorized.map(c => c.category));
      expect(categories.has('user_input')).toBe(true);
      expect(categories.has('environment')).toBe(true);
      expect(categories.has('file_read')).toBe(true);
      expect(categories.has('api_response')).toBe(true);
    });
  });

  // --- SQL Injection ---
  describe('sqlInjection', () => {
    it('has methods as Set', () => {
      const { sqlInjection } = getSecurityRules();
      expect(sqlInjection.methods).toBeInstanceOf(Set);
      expect(sqlInjection.methods.size).toBeGreaterThan(0);
      expect(sqlInjection.methods.has('query')).toBe(true);
    });

    it('has dangerous patterns as RegExp[]', () => {
      const { sqlInjection } = getSecurityRules();
      expect(Array.isArray(sqlInjection.dangerousPatterns)).toBe(true);
      expect(sqlInjection.dangerousPatterns.length).toBeGreaterThan(0);
      expect(sqlInjection.dangerousPatterns[0]).toBeInstanceOf(RegExp);
    });

    it('has severity, description, and fix', () => {
      const { sqlInjection } = getSecurityRules();
      expect(sqlInjection.severity).toBe('critical');
      expect(sqlInjection.description).toBeTruthy();
      expect(sqlInjection.fix).toBeTruthy();
    });
  });

  // --- XSS ---
  describe('xss', () => {
    it('has properties, methods, and jsx properties as Sets', () => {
      const { xss } = getSecurityRules();
      expect(xss.properties).toBeInstanceOf(Set);
      expect(xss.methods).toBeInstanceOf(Set);
      expect(xss.jsxProperties).toBeInstanceOf(Set);
      expect(xss.properties.has('innerHTML')).toBe(true);
      expect(xss.methods.has('document.write')).toBe(true);
      expect(xss.jsxProperties.has('dangerouslySetInnerHTML')).toBe(true);
    });
  });

  // --- Command Injection ---
  describe('commandInjection', () => {
    it('has methods and modules as Sets', () => {
      const { commandInjection } = getSecurityRules();
      expect(commandInjection.methods).toBeInstanceOf(Set);
      expect(commandInjection.modules).toBeInstanceOf(Set);
      expect(commandInjection.methods.has('exec')).toBe(true);
      expect(commandInjection.methods.has('spawn')).toBe(true);
    });
  });

  // --- Path Traversal ---
  describe('pathTraversal', () => {
    it('has methods as Set', () => {
      const { pathTraversal } = getSecurityRules();
      expect(pathTraversal.methods).toBeInstanceOf(Set);
      expect(pathTraversal.methods.has('readFile')).toBe(true);
      expect(pathTraversal.methods.has('readFileSync')).toBe(true);
    });
  });

  // --- Hardcoded Secrets ---
  describe('hardcodedSecrets', () => {
    it('has patterns as RegExp[]', () => {
      const { hardcodedSecrets } = getSecurityRules();
      expect(Array.isArray(hardcodedSecrets.patterns)).toBe(true);
      expect(hardcodedSecrets.patterns.length).toBeGreaterThan(0);
      expect(hardcodedSecrets.patterns[0]).toBeInstanceOf(RegExp);
    });

    it('patterns match known secret formats', () => {
      const { hardcodedSecrets } = getSecurityRules();
      // Patterns require surrounding quotes (as they appear in source code)
      const stripeKey = "'sk_test_TESTKEY_FAKE_DO_NOT_USE_456'";
      const matches = hardcodedSecrets.patterns.some(p => p.test(stripeKey));
      expect(matches).toBe(true);
    });

    it('patterns match AWS key format', () => {
      const { hardcodedSecrets } = getSecurityRules();
      // Patterns require surrounding quotes (as they appear in source code)
      const awsKey = "'AKIAIOSFODNN7EXAMPLE'";
      const matches = hardcodedSecrets.patterns.some(p => p.test(awsKey));
      expect(matches).toBe(true);
    });
  });

  // --- Eval Usage ---
  describe('evalUsage', () => {
    it('has functions as Set', () => {
      const { evalUsage } = getSecurityRules();
      expect(evalUsage.functions).toBeInstanceOf(Set);
      expect(evalUsage.functions.has('eval')).toBe(true);
      expect(evalUsage.functions.has('Function')).toBe(true);
    });
  });

  // --- Sanitizers ---
  describe('sanitizers', () => {
    it('is a Set of sanitizer names', () => {
      const { sanitizers } = getSecurityRules();
      expect(sanitizers).toBeInstanceOf(Set);
      expect(sanitizers.size).toBeGreaterThan(0);
    });

    it('contains common sanitizer functions', () => {
      const { sanitizers } = getSecurityRules();
      expect(sanitizers.has('escape')).toBe(true);
      expect(sanitizers.has('sanitize')).toBe(true);
      expect(sanitizers.has('encodeURIComponent')).toBe(true);
    });
  });

  // --- Taint Sinks ---
  describe('taintSinks', () => {
    it('is an array of sink definitions', () => {
      const { taintSinks } = getSecurityRules();
      expect(Array.isArray(taintSinks)).toBe(true);
      expect(taintSinks.length).toBeGreaterThan(0);
    });

    it('has expected categories', () => {
      const { taintSinks } = getSecurityRules();
      const categories = taintSinks.map(s => s.category);
      expect(categories).toContain('sql_injection');
      expect(categories).toContain('command_injection');
      expect(categories).toContain('xss');
      expect(categories).toContain('path_traversal');
    });

    it('each sink has patterns with method or property flags', () => {
      const { taintSinks } = getSecurityRules();
      for (const sink of taintSinks) {
        expect(sink.patterns.length).toBeGreaterThan(0);
        for (const p of sink.patterns) {
          expect(p.pattern).toBeTruthy();
          expect(p.method || p.property).toBeTruthy();
        }
      }
    });
  });
});

// ============================================================================
// Cross-Module Consistency
// ============================================================================

describe('Cross-module consistency', () => {
  it('security and dataflow share the same taint sources', () => {
    // Both security.ts and dataflow.ts now use getSecurityRules()
    // They should get the exact same cached object
    const rules1 = getSecurityRules();
    const rules2 = getSecurityRules();
    expect(rules1.taintSources.all).toBe(rules2.taintSources.all);
    expect(rules1.taintSources.categorized).toBe(rules2.taintSources.categorized);
  });

  it('taint sinks cover all vulnerability categories', () => {
    const { taintSinks } = getSecurityRules();
    const categories = new Set(taintSinks.map(s => s.category));

    // Should have all 4 categories used by dataflow analysis
    expect(categories.has('sql_injection')).toBe(true);
    expect(categories.has('command_injection')).toBe(true);
    expect(categories.has('xss')).toBe(true);
    expect(categories.has('path_traversal')).toBe(true);
  });

  it('sanitizers are shared between security and dataflow', () => {
    const { sanitizers } = getSecurityRules();
    // Sanitizers should be available to both modules
    expect(sanitizers.size).toBeGreaterThan(5);
  });
});

// ============================================================================
// getVulnerabilityTypes
// ============================================================================

describe('getVulnerabilityTypes', () => {
  it('returns vulnerability types from security rules', () => {
    const types = getVulnerabilityTypes();
    expect(types.length).toBeGreaterThan(0);
  });

  it('includes security vulnerability types', () => {
    const types = getVulnerabilityTypes();
    const typeNames = types.map(t => t.type);
    expect(typeNames).toContain('sql_injection');
    expect(typeNames).toContain('xss');
    expect(typeNames).toContain('command_injection');
    expect(typeNames).toContain('path_traversal');
    expect(typeNames).toContain('hardcoded_secret');
    expect(typeNames).toContain('eval_usage');
  });

  it('each type has severity and description', () => {
    const types = getVulnerabilityTypes();
    for (const t of types) {
      expect(t.severity).toBeTruthy();
      expect(t.description).toBeTruthy();
    }
  });
});

// ============================================================================
// resetRuleCache
// ============================================================================

describe('resetRuleCache', () => {
  it('clears security cache', () => {
    const sec1 = getSecurityRules();

    resetRuleCache();

    const sec2 = getSecurityRules();
    expect(sec2).not.toBe(sec1);
  });
});
