/**
 * Tests for @codegraph/plugin-php extractors
 *
 * Validates extraction of classes, interfaces, traits, functions, methods,
 * properties, constants, imports (use), enums, inheritance, and calls
 * from PHP source files.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import Parser from 'tree-sitter';
import {
  extractClasses,
  extractInterfaces,
  extractFunctions,
  extractVariables,
  extractImports,
  extractTypes,
  extractInheritance,
  extractCalls,
  extractAllEntities,
  getGrammar,
} from '../src/index';

const FILE = 'test.php';

let parser: Parser;

beforeAll(() => {
  parser = new Parser();
  parser.setLanguage(getGrammar() as any);
});

function parse(code: string) {
  return parser.parse(code).rootNode;
}

// ============================================================================
// Class Extraction
// ============================================================================

describe('extractClasses', () => {
  it('extracts a simple class', () => {
    const root = parse(`<?php
class User {
    public string $name;
}
`);
    const classes = extractClasses(root as any, FILE);
    expect(classes).toHaveLength(1);
    expect(classes[0]!.name).toBe('User');
    expect(classes[0]!.isAbstract).toBe(false);
    expect(classes[0]!.startLine).toBe(2);
    expect(classes[0]!.endLine).toBe(4);
  });

  it('extracts abstract class', () => {
    const root = parse(`<?php
abstract class BaseModel {
    abstract protected function validate(): bool;
}
`);
    const classes = extractClasses(root as any, FILE);
    expect(classes).toHaveLength(1);
    expect(classes[0]!.name).toBe('BaseModel');
    expect(classes[0]!.isAbstract).toBe(true);
  });

  it('extracts class with doc comment', () => {
    const root = parse(`<?php
/**
 * Represents a user entity
 */
class User {
}
`);
    const classes = extractClasses(root as any, FILE);
    expect(classes).toHaveLength(1);
    expect(classes[0]!.docstring).toContain('Represents a user entity');
  });

  it('extracts multiple classes', () => {
    const root = parse(`<?php
class Admin {
}
class Guest {
}
`);
    const classes = extractClasses(root as any, FILE);
    expect(classes).toHaveLength(2);
    expect(classes.map(c => c.name)).toEqual(['Admin', 'Guest']);
  });
});

// ============================================================================
// Interface & Trait Extraction
// ============================================================================

describe('extractInterfaces', () => {
  it('extracts a simple interface', () => {
    const root = parse(`<?php
interface Serializable {
    public function serialize(): string;
}
`);
    const ifaces = extractInterfaces(root as any, FILE);
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0]!.name).toBe('Serializable');
  });

  it('extracts interface with extends', () => {
    const root = parse(`<?php
interface Cacheable extends Serializable {
    public function getCacheKey(): string;
}
`);
    const ifaces = extractInterfaces(root as any, FILE);
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0]!.name).toBe('Cacheable');
    expect(ifaces[0]!.extends).toEqual(['Serializable']);
  });

  it('extracts interface with multiple extends', () => {
    const root = parse(`<?php
interface HasEvents extends Serializable, JsonSerializable {
    public function getEvents(): array;
}
`);
    const ifaces = extractInterfaces(root as any, FILE);
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0]!.extends).toEqual(['Serializable', 'JsonSerializable']);
  });

  it('extracts a trait as InterfaceEntity', () => {
    const root = parse(`<?php
trait HasTimestamps {
    public function touch(): void {
    }
}
`);
    const ifaces = extractInterfaces(root as any, FILE);
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0]!.name).toBe('HasTimestamps');
  });

  it('extracts interface with doc comment', () => {
    const root = parse(`<?php
/**
 * Base repository interface
 */
interface Repository {
    public function find(int $id): mixed;
}
`);
    const ifaces = extractInterfaces(root as any, FILE);
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0]!.docstring).toContain('Base repository interface');
  });
});

// ============================================================================
// Function & Method Extraction
// ============================================================================

describe('extractFunctions', () => {
  it('extracts a top-level function', () => {
    const root = parse(`<?php
function createUser(string $name, string $email): User {
    return new User($name, $email);
}
`);
    const fns = extractFunctions(root as any, FILE);
    expect(fns).toHaveLength(1);
    expect(fns[0]!.name).toBe('createUser');
    expect(fns[0]!.params).toHaveLength(2);
    expect(fns[0]!.params[0]!.name).toBe('$name');
    expect(fns[0]!.params[0]!.type).toBe('string');
    expect(fns[0]!.params[1]!.name).toBe('$email');
    expect(fns[0]!.returnType).toBe('User');
  });

  it('extracts class methods', () => {
    const root = parse(`<?php
class User {
    public function getName(): string {
        return $this->name;
    }

    protected function validate(): bool {
        return true;
    }
}
`);
    const fns = extractFunctions(root as any, FILE);
    expect(fns).toHaveLength(2);
    expect(fns[0]!.name).toBe('getName');
    expect(fns[0]!.returnType).toBe('string');
    expect(fns[1]!.name).toBe('validate');
    // Protected method is not exported
    expect(fns[1]!.isExported).toBe(false);
  });

  it('extracts static methods', () => {
    const root = parse(`<?php
class Factory {
    public static function create(): static {
        return new static();
    }
}
`);
    const fns = extractFunctions(root as any, FILE);
    expect(fns).toHaveLength(1);
    expect(fns[0]!.name).toBe('create');
  });

  it('extracts abstract methods (no body)', () => {
    const root = parse(`<?php
abstract class Base {
    abstract protected function validate(): bool;
}
`);
    const fns = extractFunctions(root as any, FILE);
    expect(fns).toHaveLength(1);
    expect(fns[0]!.name).toBe('validate');
    expect(fns[0]!.returnType).toBe('bool');
  });

  it('extracts method with doc comment', () => {
    const root = parse(`<?php
class User {
    /**
     * Get user email
     */
    public function getEmail(): string {
        return $this->email;
    }
}
`);
    const fns = extractFunctions(root as any, FILE);
    expect(fns).toHaveLength(1);
    expect(fns[0]!.docstring).toContain('Get user email');
  });

  it('extracts function with optional parameter', () => {
    const root = parse(`<?php
function greet(string $name, string $greeting = "Hello"): string {
    return "$greeting, $name!";
}
`);
    const fns = extractFunctions(root as any, FILE);
    expect(fns).toHaveLength(1);
    expect(fns[0]!.params).toHaveLength(2);
    expect(fns[0]!.params[1]!.optional).toBe(true);
  });

  it('extracts trait methods', () => {
    const root = parse(`<?php
trait HasTimestamps {
    public function touch(): void {
    }
}
`);
    const fns = extractFunctions(root as any, FILE);
    expect(fns).toHaveLength(1);
    expect(fns[0]!.name).toBe('touch');
  });

  it('extracts enum methods', () => {
    const root = parse(`<?php
enum Status: string {
    case Active = 'active';

    public function label(): string {
        return $this->value;
    }
}
`);
    const fns = extractFunctions(root as any, FILE);
    expect(fns).toHaveLength(1);
    expect(fns[0]!.name).toBe('label');
  });
});

// ============================================================================
// Variable Extraction (properties, constants)
// ============================================================================

describe('extractVariables', () => {
  it('extracts class properties', () => {
    const root = parse(`<?php
class User {
    public string $name;
    protected int $id;
    private array $roles;
}
`);
    const vars = extractVariables(root as any, FILE);
    expect(vars).toHaveLength(3);
    expect(vars[0]!.name).toBe('$name');
    expect(vars[0]!.type).toBe('string');
    expect(vars[0]!.kind).toBe('let');
    expect(vars[0]!.isExported).toBe(true);
    expect(vars[1]!.name).toBe('$id');
    expect(vars[1]!.isExported).toBe(false); // protected
  });

  it('extracts class constants', () => {
    const root = parse(`<?php
class User {
    const ROLE_ADMIN = 'admin';
    const ROLE_USER = 'user';
}
`);
    const vars = extractVariables(root as any, FILE);
    expect(vars).toHaveLength(2);
    expect(vars[0]!.name).toBe('ROLE_ADMIN');
    expect(vars[0]!.kind).toBe('const');
    expect(vars[1]!.name).toBe('ROLE_USER');
  });

  it('extracts top-level constants', () => {
    const root = parse(`<?php
const APP_VERSION = '1.0.0';
`);
    const vars = extractVariables(root as any, FILE);
    expect(vars).toHaveLength(1);
    expect(vars[0]!.name).toBe('APP_VERSION');
    expect(vars[0]!.kind).toBe('const');
  });

  it('extracts trait properties', () => {
    const root = parse(`<?php
trait HasTimestamps {
    public string $createdAt;
}
`);
    const vars = extractVariables(root as any, FILE);
    expect(vars).toHaveLength(1);
    expect(vars[0]!.name).toBe('$createdAt');
    expect(vars[0]!.type).toBe('string');
  });
});

// ============================================================================
// Import Extraction
// ============================================================================

describe('extractImports', () => {
  it('extracts simple use statement', () => {
    const root = parse(`<?php
use App\\Models\\User;
`);
    const imports = extractImports(root as any, FILE);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.source).toBe('App\\Models\\User');
    expect(imports[0]!.specifiers).toHaveLength(1);
    expect(imports[0]!.specifiers[0]!.name).toBe('User');
  });

  it('extracts use with alias', () => {
    const root = parse(`<?php
use App\\Services\\Auth as AuthService;
`);
    const imports = extractImports(root as any, FILE);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.source).toBe('App\\Services\\Auth');
    expect(imports[0]!.specifiers[0]!.name).toBe('Auth');
    expect(imports[0]!.specifiers[0]!.alias).toBe('AuthService');
  });

  it('extracts grouped use statement', () => {
    const root = parse(`<?php
use App\\Services\\{AuthService, UserService};
`);
    const imports = extractImports(root as any, FILE);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.source).toBe('App\\Services');
    expect(imports[0]!.specifiers).toHaveLength(2);
    expect(imports[0]!.specifiers[0]!.name).toBe('AuthService');
    expect(imports[0]!.specifiers[1]!.name).toBe('UserService');
  });

  it('extracts use function', () => {
    const root = parse(`<?php
use function App\\Helpers\\formatDate;
`);
    const imports = extractImports(root as any, FILE);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.source).toBe('function App\\Helpers\\formatDate');
    expect(imports[0]!.specifiers[0]!.name).toBe('formatDate');
  });

  it('extracts use const', () => {
    const root = parse(`<?php
use const App\\Config\\MAX_RETRIES;
`);
    const imports = extractImports(root as any, FILE);
    expect(imports).toHaveLength(1);
    expect(imports[0]!.source).toBe('const App\\Config\\MAX_RETRIES');
    expect(imports[0]!.specifiers[0]!.name).toBe('MAX_RETRIES');
  });
});

// ============================================================================
// Type Extraction (enums)
// ============================================================================

describe('extractTypes', () => {
  it('extracts a simple enum', () => {
    const root = parse(`<?php
enum Color {
    case Red;
    case Green;
    case Blue;
}
`);
    const types = extractTypes(root as any, FILE);
    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe('Color');
    expect(types[0]!.kind).toBe('enum');
  });

  it('extracts a backed enum', () => {
    const root = parse(`<?php
enum Status: string {
    case Active = 'active';
    case Inactive = 'inactive';
}
`);
    const types = extractTypes(root as any, FILE);
    expect(types).toHaveLength(1);
    expect(types[0]!.name).toBe('Status');
    expect(types[0]!.kind).toBe('enum');
  });

  it('extracts enum with doc comment', () => {
    const root = parse(`<?php
/**
 * User status
 */
enum Status: string {
    case Active = 'active';
}
`);
    const types = extractTypes(root as any, FILE);
    expect(types).toHaveLength(1);
    expect(types[0]!.docstring).toContain('User status');
  });
});

// ============================================================================
// Inheritance Extraction
// ============================================================================

describe('extractInheritance', () => {
  it('extracts class extends', () => {
    const root = parse(`<?php
class User extends BaseModel {
}
`);
    const refs = extractInheritance(root as any, FILE);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.childName).toBe('User');
    expect(refs[0]!.parentName).toBe('BaseModel');
    expect(refs[0]!.type).toBe('extends');
  });

  it('extracts class implements', () => {
    const root = parse(`<?php
class User implements Serializable, Cacheable {
}
`);
    const refs = extractInheritance(root as any, FILE);
    expect(refs).toHaveLength(2);
    expect(refs[0]!.childName).toBe('User');
    expect(refs[0]!.parentName).toBe('Serializable');
    expect(refs[0]!.type).toBe('implements');
    expect(refs[1]!.parentName).toBe('Cacheable');
  });

  it('extracts class extends + implements', () => {
    const root = parse(`<?php
class User extends BaseModel implements Cacheable {
}
`);
    const refs = extractInheritance(root as any, FILE);
    expect(refs).toHaveLength(2);
    // extends comes first
    const ext = refs.find(r => r.type === 'extends');
    const impl = refs.find(r => r.type === 'implements');
    expect(ext?.parentName).toBe('BaseModel');
    expect(impl?.parentName).toBe('Cacheable');
  });

  it('extracts interface extends', () => {
    const root = parse(`<?php
interface Cacheable extends Serializable {
}
`);
    const refs = extractInheritance(root as any, FILE);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.childName).toBe('Cacheable');
    expect(refs[0]!.parentName).toBe('Serializable');
    expect(refs[0]!.type).toBe('extends');
  });

  it('extracts trait use as implements', () => {
    const root = parse(`<?php
class User {
    use HasTimestamps;
    use SoftDeletes;
}
`);
    const refs = extractInheritance(root as any, FILE);
    expect(refs).toHaveLength(2);
    expect(refs[0]!.childName).toBe('User');
    expect(refs[0]!.parentName).toBe('HasTimestamps');
    expect(refs[0]!.type).toBe('implements');
    expect(refs[1]!.parentName).toBe('SoftDeletes');
  });

  it('extracts multi-trait use statement', () => {
    const root = parse(`<?php
class User {
    use HasTimestamps, SoftDeletes;
}
`);
    const refs = extractInheritance(root as any, FILE);
    expect(refs).toHaveLength(2);
    expect(refs.map(r => r.parentName)).toEqual(['HasTimestamps', 'SoftDeletes']);
  });
});

// ============================================================================
// Call Extraction
// ============================================================================

describe('extractCalls', () => {
  it('extracts function calls from functions', () => {
    const root = parse(`<?php
function helper(): string {
    return "hello";
}

function main(): void {
    $result = helper();
}
`);
    const calls = extractCalls(root as any, FILE);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.callerName).toBe('main');
    expect(calls[0]!.calleeName).toBe('helper');
  });

  it('skips PHP built-in function calls', () => {
    const root = parse(`<?php
function process(): void {
    $len = strlen("hello");
    $data = json_encode([]);
    $arr = array_map(fn($x) => $x, []);
}
`);
    const calls = extractCalls(root as any, FILE);
    expect(calls).toHaveLength(0);
  });

  it('extracts method-to-function calls', () => {
    const root = parse(`<?php
function createUser(): void {
}

class UserService {
    public function register(): void {
        createUser();
    }
}
`);
    const calls = extractCalls(root as any, FILE);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.callerName).toBe('register');
    expect(calls[0]!.calleeName).toBe('createUser');
  });
});

// ============================================================================
// extractAllEntities
// ============================================================================

describe('extractAllEntities', () => {
  it('extracts all entity types from a complex file', () => {
    const root = parse(`<?php
namespace App\\Models;

use App\\Interfaces\\Loggable;
use App\\Traits\\HasTimestamps;

interface Serializable {
    public function serialize(): string;
}

abstract class BaseModel {
    protected string $table;
    const VERSION = '1.0';
}

class User extends BaseModel implements Serializable {
    public string $name;

    public function serialize(): string {
        return json_encode($this);
    }
}

trait Cacheable {
    public function getCacheKey(): string {
        return 'key';
    }
}

enum Status: string {
    case Active = 'active';
}

function createUser(string $name): User {
    return new User($name);
}
`);
    const entities = extractAllEntities(root as any, FILE);
    expect(entities.classes.length).toBeGreaterThanOrEqual(2); // BaseModel + User
    expect(entities.interfaces.length).toBeGreaterThanOrEqual(2); // Serializable + Cacheable (trait)
    expect(entities.functions.length).toBeGreaterThanOrEqual(3); // createUser + serialize + getCacheKey
    expect(entities.variables.length).toBeGreaterThanOrEqual(3); // $table, VERSION, $name
    expect(entities.imports.length).toBeGreaterThanOrEqual(2); // Loggable + HasTimestamps
    expect(entities.types.length).toBeGreaterThanOrEqual(1); // Status enum
    expect(entities.components).toHaveLength(0);
  });

  it('returns empty arrays for empty file', () => {
    const root = parse(`<?php
`);
    const entities = extractAllEntities(root as any, FILE);
    expect(entities.functions).toHaveLength(0);
    expect(entities.classes).toHaveLength(0);
    expect(entities.interfaces).toHaveLength(0);
    expect(entities.variables).toHaveLength(0);
    expect(entities.imports).toHaveLength(0);
    expect(entities.types).toHaveLength(0);
    expect(entities.components).toHaveLength(0);
  });

  it('handles file without php tag', () => {
    const root = parse(`<?php
// just a comment
`);
    const entities = extractAllEntities(root as any, FILE);
    expect(entities.functions).toHaveLength(0);
  });
});
