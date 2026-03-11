#!/usr/bin/env node
/**
 * @codegraph/cli
 * CLI entry point
 */

import { cli } from './cli';

cli.parse(process.argv);
