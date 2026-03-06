# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-03-06

### Added
- CLI validation bounds for `--batch-size` (1-500), `--parallel` (1-20), `--rate-limit` (>=0), `--max-depth` (0-100), `--retries` (0-10), `--limit` (>=0)
- Config file extension warning for unrecognized formats
- Shared `buildQueryWithFilters` and `getFilteredSubcollections` helpers to reduce code duplication
- `.editorconfig` for consistent editor settings across contributors
- This changelog

### Fixed
- Batch commit failures now properly report errors instead of silently continuing
- Failed batch documents are correctly excluded from `documentsTransferred` count
- Firebase app cleanup on interactive mode connection errors
- State file loading provides clear error messages for corrupted JSON and missing version fields
- Webhook `sendWebhook` now returns `boolean` to indicate success/failure

### Changed
- Config merging refactored with `resolve()` helper to reduce repetitive null coalescing
- Query building logic consolidated into shared `buildQueryWithFilters` in `helpers.ts`
- Subcollection filtering consolidated into `getFilteredSubcollections` in `helpers.ts`
- Conflict detection refactored with local comparison via `detectConflicts` helper

## [1.4.0]

### Added
- `--verify-integrity` flag for hash-based document verification after transfer
- `--max-depth` flag to limit subcollection recursion depth
- `--detect-conflicts` flag to detect destination modifications during transfer

## [1.3.0]

### Added
- `--rate-limit` flag to throttle transfer rate (docs/sec)
- `--skip-oversized` flag to skip documents exceeding 1MB
- `--json` flag for CI/CD-friendly JSON output
- `--transform-samples` for validating transform functions before transfer

## [1.2.0]

### Added
- `--resume` and `--state-file` for resumable transfers
- `--verify` flag to verify document counts after transfer
- `--webhook` for Slack, Discord, and custom webhook notifications
- `--id-prefix` and `--id-suffix` for document ID modification
- `--rename-collection` for renaming collections in destination

## [1.1.0]

### Added
- Interactive mode (`-i`) with collection discovery
- `--transform` flag for document transformation during transfer
- `--clear` flag to clear destination before transfer
- `--delete-missing` flag for sync mode
- `--parallel` flag for parallel collection transfers
- `--where` filters for source document filtering
- `--exclude` patterns for subcollection filtering
- `--merge` mode for document merging instead of overwriting

## [1.0.0]

### Added
- Initial release
- Firestore collection copy between Firebase projects
- INI and JSON config file support
- Dry run mode (enabled by default)
- Subcollection support
- Batch writes with configurable size
- Retry logic with exponential backoff
- File logging support
