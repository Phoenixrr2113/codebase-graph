/**
 * Go Plugin Unit Tests
 * Tests for entity extraction from Go syntax trees
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Parser from 'tree-sitter';
import Go from 'tree-sitter-go';
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
} from '../src';

const TEST_FILE = '/test/main.go';

let parser: Parser;

function parseCode(code: string): Parser.SyntaxNode {
  const tree = parser.parse(code);
  return tree.rootNode;
}

describe('Go Extractors', () => {
  beforeAll(() => {
    parser = new Parser();
    parser.setLanguage(Go as any);
  });

  afterAll(() => {
    // Parser cleanup if needed
  });

  // ==========================================================================
  // Struct Extraction (→ ClassEntity)
  // ==========================================================================

  describe('extractClasses (structs)', () => {
    it('should extract exported struct declarations', () => {
      const code = `
        package main

        type Server struct {
            Host string
            Port int
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('Server');
      expect(classes[0].isExported).toBe(true);
      expect(classes[0].isAbstract).toBe(false);
    });

    it('should extract unexported structs', () => {
      const code = `
        package main

        type config struct {
            debug bool
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].name).toBe('config');
      expect(classes[0].isExported).toBe(false);
    });

    it('should extract struct with embedded types', () => {
      const code = `
        package main

        type BaseHandler struct {}
        type Server struct {
            BaseHandler
            Name string
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(2);
      const server = classes.find((c) => c.name === 'Server');
      expect(server).toBeDefined();
      expect(server?.implements).toContain('BaseHandler');
    });

    it('should extract struct with pointer embedding', () => {
      const code = `
        package main

        type Logger struct {}
        type Service struct {
            *Logger
            name string
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      const service = classes.find((c) => c.name === 'Service');
      expect(service).toBeDefined();
      expect(service?.implements).toContain('Logger');
    });

    it('should extract doc comments from struct', () => {
      const code = `
        package main

        // Server handles HTTP requests.
        // It manages connections and routing.
        type Server struct {
            Port int
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(1);
      expect(classes[0].docstring).toBeDefined();
      expect(classes[0].docstring).toContain('Server handles HTTP requests');
    });

    it('should not extract interfaces as classes', () => {
      const code = `
        package main

        type Reader interface {
            Read(p []byte) (n int, err error)
        }
      `;
      const rootNode = parseCode(code);
      const classes = extractClasses(rootNode as any, TEST_FILE);

      expect(classes).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Interface Extraction
  // ==========================================================================

  describe('extractInterfaces', () => {
    it('should extract interface declarations', () => {
      const code = `
        package main

        type Reader interface {
            Read(p []byte) (n int, err error)
        }
      `;
      const rootNode = parseCode(code);
      const interfaces = extractInterfaces(rootNode as any, TEST_FILE);

      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].name).toBe('Reader');
      expect(interfaces[0].isExported).toBe(true);
    });

    it('should extract interface with embedded interfaces', () => {
      const code = `
        package main

        type Reader interface {
            Read(p []byte) (n int, err error)
        }
        type Writer interface {
            Write(p []byte) (n int, err error)
        }
        type ReadWriter interface {
            Reader
            Writer
        }
      `;
      const rootNode = parseCode(code);
      const interfaces = extractInterfaces(rootNode as any, TEST_FILE);

      expect(interfaces).toHaveLength(3);
      const rw = interfaces.find((i) => i.name === 'ReadWriter');
      expect(rw).toBeDefined();
      expect(rw?.extends).toContain('Reader');
      expect(rw?.extends).toContain('Writer');
    });

    it('should extract unexported interfaces', () => {
      const code = `
        package main

        type handler interface {
            handle()
        }
      `;
      const rootNode = parseCode(code);
      const interfaces = extractInterfaces(rootNode as any, TEST_FILE);

      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].name).toBe('handler');
      expect(interfaces[0].isExported).toBe(false);
    });

    it('should extract empty interface', () => {
      const code = `
        package main

        type Any interface {}
      `;
      const rootNode = parseCode(code);
      const interfaces = extractInterfaces(rootNode as any, TEST_FILE);

      expect(interfaces).toHaveLength(1);
      expect(interfaces[0].name).toBe('Any');
    });
  });

  // ==========================================================================
  // Function & Method Extraction
  // ==========================================================================

  describe('extractFunctions', () => {
    it('should extract top-level function declarations', () => {
      const code = `
        package main

        func main() {
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('main');
      expect(functions[0].isExported).toBe(false);
      expect(functions[0].isAsync).toBe(false);
    });

    it('should extract exported functions', () => {
      const code = `
        package main

        func HandleRequest(w http.ResponseWriter, r *http.Request) {
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('HandleRequest');
      expect(functions[0].isExported).toBe(true);
      expect(functions[0].params.length).toBe(2);
    });

    it('should extract functions with return types', () => {
      const code = `
        package main

        func add(a int, b int) int {
            return a + b
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('add');
      expect(functions[0].returnType).toBe('int');
      expect(functions[0].params).toHaveLength(2);
    });

    it('should extract functions with multiple return values', () => {
      const code = `
        package main

        func divide(a, b float64) (float64, error) {
            if b == 0 {
                return 0, fmt.Errorf("division by zero")
            }
            return a / b, nil
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].name).toBe('divide');
      expect(functions[0].returnType).toBeDefined();
      expect(functions[0].returnType).toContain('error');
    });

    it('should extract methods with receiver', () => {
      const code = `
        package main

        type Server struct {
            port int
        }

        func (s *Server) Start() error {
            return nil
        }

        func (s Server) GetPort() int {
            return s.port
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      // Should have both methods
      const methods = functions.filter((f) => f.name === 'Start' || f.name === 'GetPort');
      expect(methods).toHaveLength(2);

      const start = functions.find((f) => f.name === 'Start');
      expect(start).toBeDefined();
      expect(start?.isExported).toBe(true);
    });

    it('should extract doc comments from functions', () => {
      const code = `
        package main

        // Process handles the main processing logic.
        // It validates and transforms the input data.
        func Process(data []byte) error {
            return nil
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].docstring).toBeDefined();
      expect(functions[0].docstring).toContain('Process handles the main processing logic');
    });

    it('should handle variadic parameters', () => {
      const code = `
        package main

        func Printf(format string, args ...interface{}) {
        }
      `;
      const rootNode = parseCode(code);
      const functions = extractFunctions(rootNode as any, TEST_FILE);

      expect(functions).toHaveLength(1);
      expect(functions[0].params.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==========================================================================
  // Variable Extraction (var, const)
  // ==========================================================================

  describe('extractVariables', () => {
    it('should extract var declarations', () => {
      const code = `
        package main

        var MaxRetries int = 5
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe('MaxRetries');
      expect(variables[0].isExported).toBe(true);
      expect(variables[0].kind).toBe('let');
    });

    it('should extract const declarations', () => {
      const code = `
        package main

        const Version = "1.0.0"
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe('Version');
      expect(variables[0].kind).toBe('const');
    });

    it('should extract grouped var declarations', () => {
      const code = `
        package main

        var (
            host string
            port int
        )
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables).toHaveLength(2);
      const names = variables.map((v) => v.name);
      expect(names).toContain('host');
      expect(names).toContain('port');
    });

    it('should extract grouped const declarations', () => {
      const code = `
        package main

        const (
            StatusOK    = 200
            StatusNotFound = 404
        )
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables.length).toBeGreaterThanOrEqual(2);
      const ok = variables.find((v) => v.name === 'StatusOK');
      expect(ok).toBeDefined();
      expect(ok?.kind).toBe('const');
      expect(ok?.isExported).toBe(true);
    });

    it('should identify unexported variables', () => {
      const code = `
        package main

        var debugMode bool
      `;
      const rootNode = parseCode(code);
      const variables = extractVariables(rootNode as any, TEST_FILE);

      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe('debugMode');
      expect(variables[0].isExported).toBe(false);
    });
  });

  // ==========================================================================
  // Import Extraction
  // ==========================================================================

  describe('extractImports', () => {
    it('should extract single import', () => {
      const code = `
        package main

        import "fmt"
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('fmt');
      expect(imports[0].specifiers).toHaveLength(1);
      expect(imports[0].specifiers[0].name).toBe('fmt');
    });

    it('should extract grouped imports', () => {
      const code = `
        package main

        import (
            "fmt"
            "net/http"
            "os"
        )
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(3);
      expect(imports.some((i) => i.source === 'fmt')).toBe(true);
      expect(imports.some((i) => i.source === 'net/http')).toBe(true);
      expect(imports.some((i) => i.source === 'os')).toBe(true);
    });

    it('should extract aliased imports', () => {
      const code = `
        package main

        import (
            myfmt "fmt"
        )
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(1);
      expect(imports[0].source).toBe('fmt');
      expect(imports[0].specifiers[0].alias).toBe('myfmt');
    });

    it('should handle dot imports', () => {
      const code = `
        package main

        import . "fmt"
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(1);
      expect(imports[0].isNamespace).toBe(true);
    });

    it('should extract third-party package imports', () => {
      const code = `
        package main

        import (
            "github.com/gin-gonic/gin"
            "github.com/sirupsen/logrus"
        )
      `;
      const rootNode = parseCode(code);
      const imports = extractImports(rootNode as any, TEST_FILE);

      expect(imports).toHaveLength(2);
      expect(imports[0].specifiers[0].name).toBe('gin');
      expect(imports[1].specifiers[0].name).toBe('logrus');
    });
  });

  // ==========================================================================
  // Type Extraction
  // ==========================================================================

  describe('extractTypes', () => {
    it('should extract type definitions', () => {
      const code = `
        package main

        type Duration int64
      `;
      const rootNode = parseCode(code);
      const types = extractTypes(rootNode as any, TEST_FILE);

      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('Duration');
      expect(types[0].kind).toBe('type');
      expect(types[0].isExported).toBe(true);
    });

    it('should extract function type definitions', () => {
      const code = `
        package main

        type HandlerFunc func(w http.ResponseWriter, r *http.Request)
      `;
      const rootNode = parseCode(code);
      const types = extractTypes(rootNode as any, TEST_FILE);

      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('HandlerFunc');
      expect(types[0].kind).toBe('type');
    });

    it('should not extract structs or interfaces as types', () => {
      const code = `
        package main

        type Server struct { Port int }
        type Handler interface { Handle() }
        type Duration int64
      `;
      const rootNode = parseCode(code);
      const types = extractTypes(rootNode as any, TEST_FILE);

      // Only Duration should be extracted as type
      expect(types).toHaveLength(1);
      expect(types[0].name).toBe('Duration');
    });
  });

  // ==========================================================================
  // Inheritance Extraction
  // ==========================================================================

  describe('extractInheritance', () => {
    it('should extract struct embedding as implements', () => {
      const code = `
        package main

        type Base struct {}
        type Child struct {
            Base
        }
      `;
      const rootNode = parseCode(code);
      const inheritance = extractInheritance(rootNode as any, TEST_FILE);

      const implRefs = inheritance.filter((r) => r.type === 'implements');
      expect(implRefs).toHaveLength(1);
      expect(implRefs[0].childName).toBe('Child');
      expect(implRefs[0].parentName).toBe('Base');
    });

    it('should extract interface embedding as extends', () => {
      const code = `
        package main

        type Reader interface { Read() }
        type Writer interface { Write() }
        type ReadWriter interface {
            Reader
            Writer
        }
      `;
      const rootNode = parseCode(code);
      const inheritance = extractInheritance(rootNode as any, TEST_FILE);

      const extendsRefs = inheritance.filter((r) => r.type === 'extends');
      expect(extendsRefs.some((r) => r.childName === 'ReadWriter' && r.parentName === 'Reader')).toBe(true);
      expect(extendsRefs.some((r) => r.childName === 'ReadWriter' && r.parentName === 'Writer')).toBe(true);
    });
  });

  // ==========================================================================
  // Call Extraction
  // ==========================================================================

  describe('extractCalls', () => {
    it('should extract local function calls', () => {
      const code = `
        package main

        func process() {
            validate()
            transform()
        }
        func validate() {}
        func transform() {}
      `;
      const rootNode = parseCode(code);
      const calls = extractCalls(rootNode as any, TEST_FILE);

      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls.some((c) => c.callerName === 'process' && c.calleeName === 'validate')).toBe(true);
      expect(calls.some((c) => c.callerName === 'process' && c.calleeName === 'transform')).toBe(true);
    });

    it('should skip built-in function calls', () => {
      const code = `
        package main

        func process() {
            println("hello")
            x := make([]int, 10)
            y := len(x)
            _ = y
        }
      `;
      const rootNode = parseCode(code);
      const calls = extractCalls(rootNode as any, TEST_FILE);

      // println, make, len are builtins — should be skipped
      expect(calls.filter((c) => c.callerName === 'process')).toHaveLength(0);
    });

    it('should not extract calls to external functions', () => {
      const code = `
        package main

        import "fmt"

        func process() {
            fmt.Println("hello")
        }
      `;
      const rootNode = parseCode(code);
      const calls = extractCalls(rootNode as any, TEST_FILE);

      // fmt.Println is external — should not be included
      expect(calls.filter((c) => c.callerName === 'process')).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Extract All Entities
  // ==========================================================================

  describe('extractAllEntities', () => {
    it('should extract all entity types at once', () => {
      const code = `
        package main

        import "fmt"

        type Handler interface {
            Handle()
        }

        type Duration int64

        type Server struct {
            Port int
        }

        var DefaultPort = 8080

        func NewServer(port int) *Server {
            return &Server{Port: port}
        }

        func (s *Server) Start() error {
            return nil
        }
      `;
      const rootNode = parseCode(code);
      const entities = extractAllEntities(rootNode as any, TEST_FILE);

      expect(entities.imports).toHaveLength(1);
      expect(entities.interfaces).toHaveLength(1);
      expect(entities.classes).toHaveLength(1); // Server struct
      expect(entities.types).toHaveLength(1); // Duration
      expect(entities.variables.length).toBeGreaterThan(0); // DefaultPort
      expect(entities.functions.length).toBeGreaterThanOrEqual(2); // NewServer + Start
      expect(entities.components).toHaveLength(0); // Go doesn't have React components
    });

    it('should handle empty file', () => {
      const code = `package main`;
      const rootNode = parseCode(code);
      const entities = extractAllEntities(rootNode as any, TEST_FILE);

      expect(entities.functions).toHaveLength(0);
      expect(entities.classes).toHaveLength(0);
      expect(entities.interfaces).toHaveLength(0);
      expect(entities.variables).toHaveLength(0);
      expect(entities.imports).toHaveLength(0);
      expect(entities.types).toHaveLength(0);
    });

    it('should handle complex Go file', () => {
      const code = `
        package main

        import (
            "context"
            "fmt"
            "net/http"
        )

        // Handler handles HTTP requests.
        type Handler interface {
            ServeHTTP(w http.ResponseWriter, r *http.Request)
        }

        // Middleware wraps a handler with additional logic.
        type Middleware func(Handler) Handler

        // Router manages HTTP routes.
        type Router struct {
            routes map[string]Handler
            middleware []Middleware
        }

        const MaxRoutes = 1000

        var defaultRouter *Router

        // NewRouter creates a new Router instance.
        func NewRouter() *Router {
            return &Router{
                routes: make(map[string]Handler),
            }
        }

        func (r *Router) AddRoute(path string, handler Handler) {
            r.routes[path] = handler
        }

        func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
            handler, ok := r.routes[req.URL.Path]
            if !ok {
                http.NotFound(w, req)
                return
            }
            handler.ServeHTTP(w, req)
        }
      `;
      const rootNode = parseCode(code);
      const entities = extractAllEntities(rootNode as any, TEST_FILE);

      expect(entities.imports).toHaveLength(3);
      expect(entities.interfaces).toHaveLength(1); // Handler
      expect(entities.classes).toHaveLength(1); // Router
      expect(entities.types).toHaveLength(1); // Middleware (function type)
      expect(entities.variables.length).toBeGreaterThanOrEqual(2); // MaxRoutes, defaultRouter
      expect(entities.functions.length).toBeGreaterThanOrEqual(3); // NewRouter, AddRoute, ServeHTTP

      // Verify specifics
      const router = entities.classes.find((c) => c.name === 'Router');
      expect(router?.isExported).toBe(true);
      expect(router?.docstring).toContain('Router manages HTTP routes');

      const handler = entities.interfaces.find((i) => i.name === 'Handler');
      expect(handler?.isExported).toBe(true);

      const newRouter = entities.functions.find((f) => f.name === 'NewRouter');
      expect(newRouter?.isExported).toBe(true);
      expect(newRouter?.docstring).toContain('creates a new Router instance');
    });
  });
});
