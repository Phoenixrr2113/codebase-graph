/**
 * Language Registry
 * Manages language plugins for multi-language parsing support
 */

import type {
  LanguagePlugin,
  PluginRegistration,
  RegisteredPlugin,
} from '@codegraph/types';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'LanguageRegistry' });

// ============================================================================
// Language Registry Class
// ============================================================================

/**
 * LanguageRegistry manages language plugins for the parser.
 * 
 * Plugins are registered with their supported file extensions,
 * and the registry provides lookup by extension.
 */
class LanguageRegistryImpl {
  /** Map of language ID to plugin */
  private plugins = new Map<string, LanguagePlugin>();
  
  /** Map of file extension to language plugin */
  private extensionMap = new Map<string, LanguagePlugin>();

  /**
   * Register a language plugin.
   * @param plugin - The language plugin to register
   * @returns Registration result with success status
   */
  register(plugin: LanguagePlugin): PluginRegistration {
    // Validate plugin
    if (!plugin.id || typeof plugin.id !== 'string') {
      return {
        success: false,
        languageId: plugin.id ?? 'unknown',
        extensions: [],
        error: 'Plugin must have a valid id',
      };
    }

    if (!plugin.extensions || plugin.extensions.length === 0) {
      return {
        success: false,
        languageId: plugin.id,
        extensions: [],
        error: 'Plugin must handle at least one file extension',
      };
    }

    // Check for duplicate ID
    if (this.plugins.has(plugin.id)) {
      logger.warn(`Plugin ${plugin.id} already registered, replacing`);
    }

    // Register the plugin
    this.plugins.set(plugin.id, plugin);

    // Map extensions to this plugin
    const registeredExtensions: string[] = [];
    for (const ext of plugin.extensions) {
      const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
      
      if (this.extensionMap.has(normalizedExt)) {
        const existing = this.extensionMap.get(normalizedExt)!;
        logger.warn(`Extension ${normalizedExt} already handled by ${existing.id}, overwriting with ${plugin.id}`);
      }
      
      this.extensionMap.set(normalizedExt, plugin);
      registeredExtensions.push(normalizedExt);
    }

    logger.info(`Registered plugin: ${plugin.displayName} (${plugin.id}) for extensions: ${registeredExtensions.join(', ')}`);

    return {
      success: true,
      languageId: plugin.id,
      extensions: registeredExtensions,
    };
  }

  /**
   * Get the plugin for a file extension.
   * @param ext - File extension (with or without leading dot)
   * @returns The language plugin or undefined if not found
   */
  getForExtension(ext: string): LanguagePlugin | undefined {
    const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    return this.extensionMap.get(normalizedExt);
  }

  /**
   * Get a plugin by its ID.
   * @param id - Language ID
   * @returns The language plugin or undefined if not found
   */
  getById(id: string): LanguagePlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Get all supported file extensions.
   */
  getSupportedExtensions(): string[] {
    return Array.from(this.extensionMap.keys());
  }

  /**
   * Get all registered plugins (metadata only).
   */
  getRegisteredPlugins(): RegisteredPlugin[] {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      displayName: p.displayName,
      extensions: p.extensions,
    }));
  }

  /**
   * Check if an extension is supported.
   */
  isSupported(ext: string): boolean {
    return this.getForExtension(ext) !== undefined;
  }

  /**
   * Clear all registered plugins (useful for testing).
   */
  clear(): void {
    this.plugins.clear();
    this.extensionMap.clear();
  }
}

// Export singleton instance
export const languageRegistry = new LanguageRegistryImpl();

// Export type for testing
export type LanguageRegistry = typeof languageRegistry;
