import { describe, expect, it } from 'vitest';
import {
  spawnMCPClient,
  callMCPTool,
  closeMCPClient,
  type MCPSpawnConfig,
} from '../../src/adapters/_mcp-base.js';

describe('_mcp-base', () => {
  it('exports spawnMCPClient with correct signature', () => {
    expect(typeof spawnMCPClient).toBe('function');
  });

  it('exports callMCPTool with correct signature', () => {
    expect(typeof callMCPTool).toBe('function');
  });

  it('exports closeMCPClient with correct signature', () => {
    expect(typeof closeMCPClient).toBe('function');
  });

  it('MCPSpawnConfig type accepts the expected shape', () => {
    const cfg: MCPSpawnConfig = {
      command: 'node',
      args: ['./mcp-server.js'],
      env: { FOO: 'bar' },
    };
    expect(cfg.command).toBe('node');
  });
});
