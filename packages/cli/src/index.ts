#!/usr/bin/env node
/**
 * @codegraph/cli
 * CLI entry point
 */

import { cli } from './cli.js';

cli.parse(process.argv);
