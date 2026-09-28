#!/usr/bin/env node
// bughunters is the earlier name of bugpatrol: the same CLI, at the same version.
import { bugpatrolArgs } from './args.js';

process.argv.splice(2, Infinity, ...bugpatrolArgs(process.argv.slice(2)));
await import('bugpatrol/dist/bin.js');
