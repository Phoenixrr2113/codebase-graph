/**
 * Inheritance Extractor
 * Extracts class inheritance (extends) and interface implementation references
 * with cross-file resolution via imports
 */

import type { ClassEntity, InterfaceEntity, ImportEntity } from '@codegraph/types';

/**
 * Represents a class extends reference
 */
export interface ExtendsReference {
  /** Name of the child class */
  childName: string;
  /** File path of the child class */
  childFilePath: string;
  /** Start line of the child class */
  childStartLine: number;
  /** Name of the parent class */
  parentName: string;
  /** File path of the parent class (undefined if external/unresolved) */
  parentFilePath?: string;
}

/**
 * Represents a class implements reference
 */
export interface ImplementsReference {
  /** Name of the implementing class */
  className: string;
  /** File path of the implementing class */
  classFilePath: string;
  /** Start line of the implementing class */
  classStartLine: number;
  /** Name of the implemented interface */
  interfaceName: string;
  /** File path of the interface (undefined if external/unresolved) */
  interfaceFilePath?: string;
}

/**
 * Result of inheritance extraction
 */
export interface InheritanceResult {
  extends: ExtendsReference[];
  implements: ImplementsReference[];
}

/**
 * Extract all inheritance references with cross-file resolution
 * @param filePath - Path of the file being analyzed
 * @param classes - Classes defined in this file
 * @param interfaces - Interfaces defined in this file
 * @param imports - Imports in this file (for cross-file resolution)
 * @param includeExternals - Whether to include unresolved external references
 */
export function extractInheritance(
  filePath: string,
  classes: ClassEntity[],
  interfaces: InterfaceEntity[],
  imports: ImportEntity[],
  includeExternals: boolean = false
): InheritanceResult {
  // Build lookup maps
  const localClasses = new Map(classes.map(c => [c.name, c]));
  const localInterfaces = new Map(interfaces.map(i => [i.name, i]));
  const importedSymbols = buildImportMap(imports);

  const extendsRefs: ExtendsReference[] = [];
  const implementsRefs: ImplementsReference[] = [];

  for (const cls of classes) {
    // Process extends
    if (cls.extends) {
      const parentName = cls.extends;
      let parentFilePath: string | undefined;

      // Check if parent is a local class
      if (localClasses.has(parentName)) {
        parentFilePath = filePath;
      }
      // Check if parent is imported
      else if (importedSymbols.has(parentName)) {
        parentFilePath = importedSymbols.get(parentName);
      }

      // Skip external if not requested
      if (!parentFilePath && !includeExternals) {
        continue;
      }

      const ref: ExtendsReference = {
        childName: cls.name,
        childFilePath: filePath,
        childStartLine: cls.startLine,
        parentName,
      };
      if (parentFilePath) {
        ref.parentFilePath = parentFilePath;
      }

      extendsRefs.push(ref);
    }

    // Process implements
    if (cls.implements && cls.implements.length > 0) {
      for (const ifaceName of cls.implements) {
        let interfaceFilePath: string | undefined;

        // Check if interface is local
        if (localInterfaces.has(ifaceName)) {
          interfaceFilePath = filePath;
        }
        // Check if interface is imported
        else if (importedSymbols.has(ifaceName)) {
          interfaceFilePath = importedSymbols.get(ifaceName);
        }

        // Skip external if not requested
        if (!interfaceFilePath && !includeExternals) {
          continue;
        }

        const ref: ImplementsReference = {
          className: cls.name,
          classFilePath: filePath,
          classStartLine: cls.startLine,
          interfaceName: ifaceName,
        };
        if (interfaceFilePath) {
          ref.interfaceFilePath = interfaceFilePath;
        }

        implementsRefs.push(ref);
      }
    }
  }

  return {
    extends: extendsRefs,
    implements: implementsRefs,
  };
}

/**
 * Build a map of imported symbol names to their resolved file paths
 */
function buildImportMap(imports: ImportEntity[]): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();

  for (const imp of imports) {
    // Default import
    if (imp.isDefault && imp.defaultAlias) {
      map.set(imp.defaultAlias, imp.resolvedPath);
    }

    // Namespace import (* as X)
    if (imp.isNamespace && imp.namespaceAlias) {
      map.set(imp.namespaceAlias, imp.resolvedPath);
    }

    // Named imports
    for (const spec of imp.specifiers) {
      const localName = spec.alias || spec.name;
      map.set(localName, imp.resolvedPath);
    }
  }

  return map;
}
