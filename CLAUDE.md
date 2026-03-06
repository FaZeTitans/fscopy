# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CLI tool to copy Firestore collections between Firebase projects. Built with Bun.

## Authentication

Uses Google Application Default Credentials (ADC). User must run:

```bash
gcloud auth application-default login
```

## Commands

```bash
bun install                              # Install dependencies
bun test                                 # Run tests
bun run type-check                       # TypeScript type checking
bun run lint                             # Run ESLint
bun run lint:fix                         # Fix ESLint errors
bun run format                           # Format with Prettier
bun run format:check                     # Check formatting

# Global CLI install (requires ~/.bun/bin in PATH)
bun add -g /Users/axel/EQ_Projects/small_programs/fscopy

# Update global CLI (same command)
bun add -g /Users/axel/EQ_Projects/small_programs/fscopy

# Remove global CLI
bun remove -g fscopy

# After global install:
fscopy --init config.ini     # Generate INI config (default)
fscopy --init config.json    # Generate JSON config
fscopy -f config.ini         # Run with config file
fscopy -c users orders -s    # Run with CLI args
fscopy -f config.ini -d false -y  # Live transfer
fscopy -f config.ini --log transfer.log  # With logging
fscopy -f config.ini --where "active == true"  # Filter docs
fscopy -f config.ini --exclude logs cache  # Exclude subcollections
fscopy -f config.ini --merge  # Merge instead of overwrite
fscopy -f config.ini --parallel 3  # Parallel transfers
fscopy -f config.ini --clear  # Clear destination before transfer
fscopy -f config.ini --delete-missing  # Sync mode: delete orphan docs
fscopy -i                              # Interactive mode with prompts
fscopy -f config.ini -t ./transform.ts # Transform docs during transfer
fscopy -f config.ini -r users:users_backup # Rename collection in destination
fscopy -f config.ini --id-prefix backup_  # Add prefix to document IDs
fscopy -f config.ini --webhook https://hooks.slack.com/... # Webhook notification
fscopy -f config.ini --resume                            # Resume interrupted transfer
fscopy -f config.ini --state-file ./custom.state.json    # Custom state file path
fscopy -f config.ini --verify                            # Verify counts after transfer
fscopy -f config.ini --rate-limit 100                    # Limit to 100 docs/s
fscopy -f config.ini --skip-oversized                    # Skip docs > 1MB
fscopy -f config.ini --json                              # JSON output for CI/CD
fscopy -f config.ini --detect-conflicts                  # Detect dest modifications during transfer
fscopy -f config.ini -s --max-depth 2                    # Limit subcollection recursion to 2 levels
fscopy -f config.ini --verify-integrity                  # Verify document integrity with hash after transfer

# Local development:
bun start -- -f config.ini              # Run locally
bun dev -- -f config.ini                # Run with watch mode
```

## Architecture

Modular TypeScript CLI with shebang `#!/usr/bin/env bun`.

**Directory structure:**

```text
src/
├── cli.ts              # Entry point, CLI args parsing (~280 lines)
├── orchestrator.ts     # Main transfer orchestration logic (~360 lines)
├── types.ts            # Shared TypeScript interfaces
├── interactive.ts      # Interactive mode prompts
├── config/
│   ├── defaults.ts     # Default config values and templates
│   ├── generator.ts    # Config file generation (--init)
│   ├── parser.ts       # INI/JSON parsing, config merging
│   └── validator.ts    # Config validation
├── firebase/
│   └── index.ts        # Firebase init, connectivity check, cleanup
├── output/
│   └── display.ts      # Config display, confirmation, summary output
├── state/
│   └── index.ts        # Resume support (load/save state, atomic writes)
├── transfer/
│   ├── helpers.ts      # getSubcollections, getDestCollectionPath, getDestDocId
│   ├── parallel.ts     # Parallel processing with error collection
│   ├── count.ts        # Document counting with progress callbacks
│   ├── clear.ts        # clearCollection, deleteOrphanDocuments
│   └── transfer.ts     # Main transfer logic with transform support
├── transform/
│   └── loader.ts       # Dynamic transform function loading
├── utils/
│   ├── credentials.ts  # ADC check before Firebase init
│   ├── doc-size.ts     # Document size estimation (1MB limit check)
│   ├── errors.ts       # Firebase error formatting with suggestions
│   ├── logger.ts       # File logging with timestamps
│   ├── patterns.ts     # Glob pattern matching for excludes
│   ├── rate-limiter.ts # Token bucket rate limiter
│   └── retry.ts        # Exponential backoff retry logic
├── webhook/
│   └── index.ts        # Slack, Discord, custom webhook notifications
└── __tests__/          # Test files for all modules
```

**Config resolution** (priority: CLI > config file > defaults):

- `loadConfigFile()` parses INI or JSON based on extension
- `mergeConfig()` combines config sources
- `validateConfig()` checks required fields

**Transfer flow:**

1. `countDocuments()` - Counts total docs for progress bar (uses count() aggregation when possible)
2. `initializeFirebase()` - Creates two Firebase Admin apps (source/dest)
3. `checkDatabaseConnectivity()` - Verifies database access before transfer
4. `loadTransformFunction()` - Dynamically loads transform file (when --transform is used)
5. `clearCollection()` - Deletes all docs from destination (when --clear is used)
6. `transferCollection()` - Recursive function with retry handling, transform and rename support
7. `deleteOrphanDocuments()` - Deletes docs not in source (when --delete-missing is used)
8. `sendWebhook()` - Sends POST notification to Slack, Discord, or custom URL

## Config Options

INI format uses `[projects]` section for source/dest and `[transfer]` section for options.

| Option | CLI | INI key | JSON key | Default |
| ------ | --- | ------- | -------- | ------- |
| Source project | `--source-project` | `source` | `sourceProject` | required |
| Dest project | `--dest-project` | `dest` | `destProject` | required |
| Collections | `-c` | `collections` | `collections` | required |
| Subcollections | `-s` | `includeSubcollections` | `includeSubcollections` | false |
| Dry run | `-d` | `dryRun` | `dryRun` | true |
| Batch size | `-b` | `batchSize` | `batchSize` | 500 |
| Doc limit | `-l` | `limit` | `limit` | 0 (none) |
| Skip confirm | `-y` | - | - | false |
| Log file | `--log` | - | - | - |
| Max log size | `--max-log-size` | - | - | 0 (no rotation) |
| Retries | `--retries` | - | - | 3 |
| Quiet mode | `-q` | - | - | false |
| Where filter | `-w` | `where` | `where` | [] |
| Exclude | `-x` | `exclude` | `exclude` | [] |
| Merge mode | `-m` | `merge` | `merge` | false |
| Parallel | `-p` | `parallel` | `parallel` | 1 |
| Clear dest | `--clear` | `clear` | `clear` | false |
| Delete missing | `--delete-missing` | `deleteMissing` | `deleteMissing` | false |
| Interactive | `-i` | - | - | false |
| Transform | `-t` | `transform` | `transform` | null |
| Rename coll. | `-r` | `renameCollection` | `renameCollection` | {} |
| ID prefix | `--id-prefix` | `idPrefix` | `idPrefix` | null |
| ID suffix | `--id-suffix` | `idSuffix` | `idSuffix` | null |
| Webhook | `--webhook` | `webhook` | `webhook` | null |
| Resume | `--resume` | - | - | false |
| State file | `--state-file` | - | - | `.fscopy-state.json` |
| Verify | `--verify` | - | - | false |
| Rate limit | `--rate-limit` | - | - | 0 (none) |
| Skip oversized | `--skip-oversized` | - | - | false |
| JSON output | `--json` | - | - | false |
| Transform samples | `--transform-samples` | - | - | 3 |
| Detect conflicts | `--detect-conflicts` | - | - | false |
| Max depth | `--max-depth` | - | - | 0 (unlimited) |
| Verify integrity | `--verify-integrity` | - | - | false |
| Allow HTTP webhook | `--allow-http-webhook` | - | - | false |
