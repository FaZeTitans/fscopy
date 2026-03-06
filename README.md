<p align="center">
  <img src="assets/banner.png" alt="fscopy banner" width="600">
</p>

<h1 align="center">
  <img src="assets/logo.png" alt="fscopy logo" width="40" height="40" style="vertical-align: middle;">
  fscopy
</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@fazetitans/fscopy"><img src="https://img.shields.io/npm/v/@fazetitans/fscopy.svg" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

<p align="center">
  <strong>Fast CLI tool to copy Firestore collections between Firebase projects</strong>
</p>

Transfer documents between Firebase projects with support for subcollections, filtering, parallel transfers, and merge mode. Built with [Bun](https://bun.sh) for maximum performance.

## Features

- **Subcollection support** - Recursively copy nested collections
- **Document filtering** - Filter documents with `--where` clauses
- **Exclude patterns** - Skip subcollections by name or glob pattern
- **Merge mode** - Update existing documents instead of overwriting
- **Parallel transfers** - Copy multiple collections simultaneously
- **Clear destination** - Optionally delete destination data before transfer
- **Sync mode** - Delete destination docs not present in source
- **Document transform** - Transform data during transfer with custom JS/TS functions
- **Collection renaming** - Rename collections in destination for backups or migrations
- **ID modification** - Add prefix or suffix to document IDs to avoid conflicts
- **Webhook notifications** - Send Slack, Discord, or custom webhooks on completion
- **Resume transfers** - Continue interrupted transfers from saved state
- **Interactive mode** - Guided setup with prompts for project and collection selection
- **Progress bar** - Real-time progress with speed (docs/s) and ETA
- **Automatic retry** - Exponential backoff on network errors
- **Dry run mode** - Preview changes before applying (enabled by default)
- **Flexible config** - INI, JSON, or CLI arguments
- **Rate limiting** - Control transfer speed to avoid quota issues
- **Size validation** - Skip oversized documents (>1MB)
- **JSON output** - Machine-readable output for CI/CD pipelines
- **Post-transfer verification** - Verify document counts after transfer

## Installation

### With Bun (recommended)

```bash
# Global install
bun add -g @fazetitans/fscopy

# Or run directly
bunx @fazetitans/fscopy --help
```

### With npm

```bash
npm install -g @fazetitans/fscopy
```

### Prerequisites

1. [Bun](https://bun.sh) or Node.js 18+
1. Google Cloud authentication: `gcloud auth application-default login`
1. Firestore read access on source project, write access on destination

## Quick Start

```bash
# 1. Generate config file
fscopy --init config.ini

# 2. Edit config.ini with your project IDs and collections

# 3. Preview transfer (dry run)
fscopy -f config.ini

# 4. Execute transfer
fscopy -f config.ini -d false -y
```

## Usage

### Basic Transfer

```bash
# Using config file
fscopy -f config.ini

# Using CLI arguments
fscopy \
  --source-project my-source \
  --dest-project my-dest \
  -c users orders products
```

### With Subcollections

```bash
# Include all subcollections
fscopy -f config.ini -s

# Exclude specific subcollections
fscopy -f config.ini -s --exclude logs --exclude "temp/*"
```

### Filtering Documents

```bash
# Single filter
fscopy -f config.ini --where "status == active"

# Multiple filters (AND)
fscopy -f config.ini -w "active == true" -w "createdAt > 2024-01-01"

# Supported operators: ==, !=, <, >, <=, >=
```

### Advanced Options

```bash
# Merge mode (update instead of overwrite)
fscopy -f config.ini --merge

# Parallel transfers (3 collections at once)
fscopy -f config.ini --parallel 3

# With logging
fscopy -f config.ini --log transfer.log

# Limit documents per collection
fscopy -f config.ini --limit 100

# Quiet mode (no progress bar)
fscopy -f config.ini -q

# Clear destination before transfer (DESTRUCTIVE)
fscopy -f config.ini --clear

# Sync mode: delete orphan docs in destination
fscopy -f config.ini --delete-missing

# Interactive mode with prompts
fscopy -i

# Transform documents during transfer
fscopy -f config.ini --transform ./transforms/anonymize.ts

# Rename collections in destination
fscopy -f config.ini -r users:users_backup -r orders:orders_2024

# Add prefix to document IDs
fscopy -f config.ini --id-prefix backup_

# Add suffix to document IDs
fscopy -f config.ini --id-suffix _archived

# Send notification to Slack/Discord
fscopy -f config.ini --webhook https://hooks.slack.com/services/...

# Resume an interrupted transfer
fscopy -f config.ini --resume

# Verify document counts after transfer
fscopy -f config.ini --verify

# Rate limit to 100 docs/second (avoid quota issues)
fscopy -f config.ini --rate-limit 100

# Skip documents larger than 1MB
fscopy -f config.ini --skip-oversized

# JSON output for CI/CD pipelines
fscopy -f config.ini --json
```

### Collection Renaming

Rename collections during transfer for backups or migrations:

```bash
# Backup with dated collection names
fscopy -f config.ini -r users:users_2024_12_29 -r orders:orders_2024_12_29

# Multiple renames in one command
fscopy -f config.ini --rename-collection users:users_v2 --rename-collection products:catalog
```

Subcollections are automatically renamed along with their parent collection.

### ID Modification

Add prefix or suffix to document IDs to avoid conflicts when merging:

```bash
# Add prefix: user123 → backup_user123
fscopy -f config.ini --id-prefix backup_

# Add suffix: user123 → user123_v2
fscopy -f config.ini --id-suffix _v2

# Combine both: user123 → old_user123_archived
fscopy -f config.ini --id-prefix old_ --id-suffix _archived
```

### Document Transform

Transform documents during transfer using a custom function:

```bash
# Create a transform file
cat > anonymize.ts << 'EOF'
export function transform(doc, meta) {
    // Anonymize email addresses
    if (doc.email) {
        doc.email = `user_${meta.id}@example.com`;
    }
    // Remove sensitive fields
    delete doc.password;
    delete doc.ssn;
    // Return null to skip the document
    if (doc.deleted) return null;
    return doc;
}
EOF

# Use the transform
fscopy -f config.ini -t ./anonymize.ts
```

The transform function receives:

- `doc` - The document data as an object
- `meta` - Metadata with `id` (document ID) and `path` (full document path)

Return the transformed document, or `null` to skip it.

> **Security Warning**: The `--transform` option executes arbitrary code from the specified file. Only use transform files from trusted sources. Never run transforms from untrusted or unverified files as they have full access to your system.

### Webhook Notifications

Get notified when transfers complete (success or failure):

```bash
# Slack webhook
fscopy -f config.ini --webhook https://hooks.slack.com/services/XXX/YYY/ZZZ

# Discord webhook
fscopy -f config.ini --webhook https://discord.com/api/webhooks/123/abc

# Custom webhook (receives raw JSON payload)
fscopy -f config.ini --webhook https://api.example.com/webhook
```

The webhook receives a POST request with:

- `source` / `destination` - Project IDs
- `collections` - List of transferred collections
- `stats` - Documents transferred, deleted, errors
- `duration` - Transfer time in seconds
- `dryRun` - Whether it was a dry run
- `success` - Boolean status
- `error` - Error message (if failed)

Slack and Discord webhooks are automatically formatted with rich messages.

### Resume Interrupted Transfers

Large migrations can be resumed if interrupted:

```bash
# Start a transfer (state is saved automatically to .fscopy-state.json)
fscopy -f config.ini -d false

# If interrupted (Ctrl+C, network error, etc.), resume from where it left off
fscopy -f config.ini --resume

# Use a custom state file
fscopy -f config.ini --state-file ./my-transfer.state.json
fscopy -f config.ini --resume --state-file ./my-transfer.state.json
```

The state file tracks:

- Completed document IDs per collection
- Transfer statistics
- Source/destination project validation

State files are automatically deleted on successful completion.

## Configuration

### INI Format (recommended)

```bash
fscopy --init config.ini
```

```ini
[projects]
source = my-source-project
dest = my-dest-project

[transfer]
collections = users, orders, products
includeSubcollections = true
dryRun = true
batchSize = 500
limit = 0

[options]
; where = status == active
; exclude = logs, cache, temp/*
merge = false
parallel = 1
clear = false
deleteMissing = false
; transform = ./transforms/anonymize.ts
; renameCollection = users:users_backup, orders:orders_2024
; idPrefix = backup_
; idSuffix = _v2
```

### JSON Format

```bash
fscopy --init config.json
```

```json
{
    "sourceProject": "my-source-project",
    "destProject": "my-dest-project",
    "collections": ["users", "orders"],
    "includeSubcollections": true,
    "dryRun": true,
    "batchSize": 500,
    "limit": 0,
    "where": ["status == active"],
    "exclude": ["logs", "cache"],
    "merge": false,
    "parallel": 1,
    "clear": false,
    "deleteMissing": false,
    "transform": null,
    "renameCollection": {},
    "idPrefix": null,
    "idSuffix": null
}
```

## CLI Reference

| Option                     | Alias | Type    | Default              | Description                             |
| -------------------------- | ----- | ------- | -------------------- | --------------------------------------- |
| `--init`                   |       | string  |                      | Generate config template                |
| `--config`                 | `-f`  | string  |                      | Path to config file                     |
| `--source-project`         |       | string  |                      | Source Firebase project                 |
| `--dest-project`           |       | string  |                      | Destination project                     |
| `--collections`            | `-c`  | array   |                      | Collections to transfer                 |
| `--include-subcollections` | `-s`  | boolean | `false`              | Include subcollections                  |
| `--where`                  | `-w`  | array   |                      | Filter documents                        |
| `--exclude`                | `-x`  | array   |                      | Exclude subcollections                  |
| `--merge`                  | `-m`  | boolean | `false`              | Merge instead of overwrite              |
| `--parallel`               | `-p`  | number  | `1`                  | Parallel transfers                      |
| `--dry-run`                | `-d`  | boolean | `true`               | Preview without writing                 |
| `--batch-size`             | `-b`  | number  | `500`                | Documents per batch                     |
| `--limit`                  | `-l`  | number  | `0`                  | Limit docs (0 = no limit)               |
| `--retries`                |       | number  | `3`                  | Retries on error                        |
| `--log`                    |       | string  |                      | Log file path                           |
| `--quiet`                  | `-q`  | boolean | `false`              | No progress bar                         |
| `--yes`                    | `-y`  | boolean | `false`              | Skip confirmation                       |
| `--clear`                  |       | boolean | `false`              | Clear destination before transfer       |
| `--delete-missing`         |       | boolean | `false`              | Delete dest docs not in source          |
| `--interactive`            | `-i`  | boolean | `false`              | Interactive mode with prompts           |
| `--transform`              | `-t`  | string  |                      | Path to JS/TS transform file            |
| `--rename-collection`      | `-r`  | array   |                      | Rename collection (source:dest)         |
| `--id-prefix`              |       | string  |                      | Add prefix to document IDs              |
| `--id-suffix`              |       | string  |                      | Add suffix to document IDs              |
| `--webhook`                |       | string  |                      | Webhook URL for notifications           |
| `--resume`                 |       | boolean | `false`              | Resume from saved state                 |
| `--state-file`             |       | string  | `.fscopy-state.json` | State file path                         |
| `--verify`                 |       | boolean | `false`              | Verify counts after transfer            |
| `--rate-limit`             |       | number  | `0`                  | Limit docs/second (0 = unlimited)       |
| `--skip-oversized`         |       | boolean | `false`              | Skip documents > 1MB                    |
| `--json`                   |       | boolean | `false`              | JSON output for CI/CD                   |
| `--max-depth`              |       | number  | `0`                  | Max subcollection depth (0 = unlimited) |
| `--detect-conflicts`       |       | boolean | `false`              | Detect concurrent modifications         |
| `--verify-integrity`       |       | boolean | `false`              | Verify document integrity with hash     |
| `--allow-http-webhook`     |       | boolean | `false`              | Allow HTTP (non-HTTPS) webhook URLs     |

## How It Works

1. **Authentication** - Uses Google Application Default Credentials (ADC)
2. **Document counting** - Counts total documents for progress bar
3. **Batch processing** - Transfers documents in configurable batches
4. **Retry logic** - Automatic retry with exponential backoff on failures
5. **Subcollection discovery** - Uses `listCollections()` to find nested data

## Security

- **Transform files execute arbitrary code** - The `--transform` option uses dynamic imports to load and execute JavaScript/TypeScript files. Only use transform files you have written or thoroughly reviewed. Malicious transform files could access your filesystem, network, or credentials.

- **Webhook URLs must use HTTPS** - fscopy blocks HTTP webhooks by default (except localhost). Use `--allow-http-webhook` to explicitly allow unencrypted webhooks. Webhook payloads contain project names and transfer statistics that could be sensitive.

- **Transform file extensions are validated** - Only `.ts`, `.js`, `.mjs`, and `.mts` files are accepted as transform files.

- **Credentials via ADC** - fscopy uses Google Application Default Credentials. Ensure you're authenticated with the correct account before running transfers.

## Notes

- **Dry run is ON by default** - Use `-d false` for actual transfer
- **Documents are overwritten** - Use `--merge` to update instead
- **Where filters apply to root only** - Subcollections are copied in full
- **Exclude patterns support globs** - e.g., `temp/*`, `*/logs`
- **Progress bar shows ETA** - Based on documents processed
- **Clear is destructive** - `--clear` deletes all destination docs before transfer
- **Delete-missing syncs** - `--delete-missing` removes orphan docs after transfer
- **Transform applies to all** - Transform function is applied to both root and subcollection docs
- **Limit applies to root only** - `--limit` restricts the number of documents at the root collection level; subcollections are always copied in full
- **Same project allowed** - Source and destination can be the same project when using `--rename-collection` or `--id-prefix`/`--id-suffix`

## Environment Variables

| Variable | Description |
| -------- | ----------- |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Google Cloud credentials JSON file |
| `FSCOPY_SKIP_CREDENTIALS_CHECK` | Set to `1` to skip the credentials check at startup (useful in CI/CD with alternative auth) |

## Limitations

### Firestore Special Types

When reading documents, Firestore sentinel values are resolved to their actual values:

| Sentinel | Behavior |
| -------- | -------- |
| `serverTimestamp()` | Resolved to actual `Timestamp` value |
| `increment()` | Resolved to current numeric value |
| `arrayUnion()` / `arrayRemove()` | Resolved to current array value |

These sentinels are **write-time operations**, not persistent values. fscopy transfers the resolved data, which is the expected behavior for data migration.

### Document References

`DocumentReference` fields are transferred as-is. If the reference points to a document in the source project, it will still point to the source after transfer. Consider using `--transform` to update references if needed.

### Collection and Document IDs

fscopy validates IDs according to Firestore rules:

- Cannot be empty
- Cannot be `.` or `..`
- Cannot match `__*__` pattern (reserved by Firestore)

Unicode characters, special characters (`#`, `$`, `[`, `]`), and forward slashes in nested paths are all supported.

### Subcollection Depth

Use `--max-depth` to limit recursion when copying deeply nested subcollections:

```bash
# Copy only first level of subcollections
fscopy -f config.ini -s --max-depth 1

# Copy up to 3 levels deep
fscopy -f config.ini -s --max-depth 3
```

## Development

```bash
# Clone and install
git clone https://github.com/fazetitans/fscopy.git
cd fscopy
bun install

# Run locally
bun start -- -f config.ini

# Run tests
bun test

# Type check & lint
bun run type-check
bun run lint
```

## License

[MIT](LICENSE)
