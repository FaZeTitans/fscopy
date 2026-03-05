#!/usr/bin/env bun

// Suppress GCE metadata lookup warning (we're not running on Google Cloud)
process.env.METADATA_SERVER_DETECTION = 'none';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import pkg from '../package.json';
import type { Config, CliArgs, ValidatedConfig } from './types.js';
import { Output, parseSize } from './utils/output.js';
import { ensureCredentials } from './utils/credentials.js';
import { loadConfigFile, mergeConfig } from './config/parser.js';
import { validateConfig, isValidatedConfig } from './config/validator.js';
import { defaults } from './config/defaults.js';
import { generateConfigFile } from './config/generator.js';
import { validateWebhookUrl } from './webhook/index.js';
import { runInteractiveMode } from './interactive.js';
import { displayConfig, askConfirmation } from './output/display.js';
import { runTransfer } from './orchestrator.js';

// =============================================================================
// CLI Arguments
// =============================================================================

const argv = yargs(hideBin(process.argv))
    .scriptName('fscopy')
    .version(pkg.version)
    .usage('$0 [options]')
    .option('init', {
        type: 'string',
        description: 'Generate a config template file (.ini by default, .json if specified)',
        nargs: 1,
        default: undefined,
    })
    .option('config', {
        alias: 'f',
        type: 'string',
        description: 'Path to config file (.ini or .json)',
    })
    .option('collections', {
        alias: 'c',
        type: 'array',
        description: 'Collections to transfer (e.g., -c users orders)',
    })
    .option('include-subcollections', {
        alias: 's',
        type: 'boolean',
        description: 'Include subcollections in transfer',
    })
    .option('dry-run', {
        alias: 'd',
        type: 'boolean',
        description: 'Preview transfer without writing',
    })
    .option('batch-size', {
        alias: 'b',
        type: 'number',
        description: 'Number of documents per batch write',
    })
    .option('limit', {
        alias: 'l',
        type: 'number',
        description: 'Limit number of documents per collection (0 = no limit)',
    })
    .option('source-project', {
        type: 'string',
        description: 'Source Firebase project ID',
    })
    .option('dest-project', {
        type: 'string',
        description: 'Destination Firebase project ID',
    })
    .option('yes', {
        alias: 'y',
        type: 'boolean',
        description: 'Skip confirmation prompt',
        default: false,
    })
    .option('log', {
        type: 'string',
        description: 'Path to log file for transfer details',
    })
    .option('max-log-size', {
        type: 'string',
        description: 'Max log file size before rotation (e.g., "10MB", "1GB"). 0 = no rotation.',
        default: '0',
    })
    .option('retries', {
        type: 'number',
        description: 'Number of retries on error (default: 3)',
        default: 3,
    })
    .option('quiet', {
        alias: 'q',
        type: 'boolean',
        description: 'Minimal output (no progress bar)',
        default: false,
    })
    .option('where', {
        alias: 'w',
        type: 'array',
        description: 'Filter documents (e.g., --where "status == active")',
    })
    .option('exclude', {
        alias: 'x',
        type: 'array',
        description: 'Exclude subcollections by pattern (e.g., --exclude "logs" "temp/*")',
    })
    .option('merge', {
        alias: 'm',
        type: 'boolean',
        description: 'Merge documents instead of overwriting',
    })
    .option('parallel', {
        alias: 'p',
        type: 'number',
        description: 'Number of parallel collection transfers (default: 1)',
    })
    .option('clear', {
        type: 'boolean',
        description: 'Clear destination collections before transfer (DESTRUCTIVE)',
    })
    .option('delete-missing', {
        type: 'boolean',
        description: 'Delete destination docs not present in source (sync mode)',
    })
    .option('interactive', {
        alias: 'i',
        type: 'boolean',
        description: 'Interactive mode with prompts for project and collection selection',
        default: false,
    })
    .option('transform', {
        alias: 't',
        type: 'string',
        description: 'Path to JS/TS file exporting a transform(doc, meta) function',
    })
    .option('rename-collection', {
        alias: 'r',
        type: 'array',
        description: 'Rename collection in destination (format: source:dest)',
    })
    .option('id-prefix', {
        type: 'string',
        description: 'Add prefix to document IDs in destination',
    })
    .option('id-suffix', {
        type: 'string',
        description: 'Add suffix to document IDs in destination',
    })
    .option('webhook', {
        type: 'string',
        description: 'Webhook URL for transfer notifications (Slack, Discord, or custom)',
    })
    .option('resume', {
        type: 'boolean',
        description: 'Resume an interrupted transfer from saved state',
        default: false,
    })
    .option('state-file', {
        type: 'string',
        description: 'Path to state file for resume (default: .fscopy-state.json)',
        default: '.fscopy-state.json',
    })
    .option('verify', {
        type: 'boolean',
        description: 'Verify document counts after transfer',
        default: false,
    })
    .option('rate-limit', {
        type: 'number',
        description: 'Limit transfer rate (documents per second, 0 = unlimited)',
        default: 0,
    })
    .option('skip-oversized', {
        type: 'boolean',
        description: 'Skip documents exceeding 1MB instead of failing',
        default: false,
    })
    .option('json', {
        type: 'boolean',
        description: 'Output results in JSON format (for CI/CD)',
        default: false,
    })
    .option('transform-samples', {
        type: 'number',
        description: 'Number of documents to test per collection during transform validation (0 = skip, -1 = all)',
        default: 3,
    })
    .option('detect-conflicts', {
        type: 'boolean',
        description: 'Detect if destination docs were modified during transfer',
        default: false,
    })
    .option('max-depth', {
        type: 'number',
        description: 'Max subcollection depth (0 = unlimited)',
        default: 0,
    })
    .option('verify-integrity', {
        type: 'boolean',
        description: 'Verify document integrity with hash after transfer',
        default: false,
    })
    .option('validate-only', {
        type: 'boolean',
        description: 'Only validate config and display it (no transfer)',
        default: false,
        hidden: true,
    })
    .example('$0 --init config.ini', 'Generate INI config template (default)')
    .example('$0 --init config.json', 'Generate JSON config template')
    .example('$0 -f config.ini', 'Run transfer with config file')
    .example('$0 -f config.ini -d false -y', 'Live transfer, skip confirmation')
    .example('$0 -f config.ini --log transfer.log', 'Transfer with logging')
    .example('$0 -f config.ini --where "active == true"', 'Filter documents')
    .example('$0 -f config.ini --exclude "logs" --exclude "cache"', 'Exclude subcollections')
    .example('$0 -f config.ini --merge', 'Merge instead of overwrite')
    .example('$0 -f config.ini --parallel 3', 'Transfer 3 collections in parallel')
    .example('$0 -f config.ini --clear', 'Clear destination before transfer')
    .example('$0 -f config.ini --delete-missing', 'Sync mode: delete orphan docs in dest')
    .example('$0 -i', 'Interactive mode with prompts')
    .example('$0 -f config.ini -t ./transform.ts', 'Transform documents during transfer')
    .example('$0 -f config.ini -r users:users_backup', 'Rename collection in destination')
    .example('$0 -f config.ini --id-prefix backup_', 'Add prefix to document IDs')
    .example('$0 -f config.ini --webhook https://hooks.slack.com/...', 'Send notification to Slack')
    .example('$0 -f config.ini --resume', 'Resume an interrupted transfer')
    .help()
    .parseSync() as CliArgs;

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
    // Handle --init command
    if (argv.init !== undefined) {
        const filename = argv.init || 'fscopy.ini';
        generateConfigFile(filename);
        process.exit(0);
    }

    // Check credentials before proceeding
    ensureCredentials();

    // Load and merge configuration
    const fileConfig = loadConfigFile(argv.config);
    let config: Config = mergeConfig(defaults, fileConfig, argv);

    // Run interactive mode if enabled
    if (argv.interactive) {
        config = await runInteractiveMode(config);
    }

    displayConfig(config);

    // Validate configuration
    const errors = validateConfig(config);
    if (errors.length > 0) {
        console.log('\n❌ Configuration errors:');
        errors.forEach((err) => console.log(`   - ${err}`));
        process.exit(1);
    }

    // After validation, config is guaranteed to have required fields
    if (!isValidatedConfig(config)) {
        console.log('\n❌ Configuration validation failed');
        process.exit(1);
    }
    const validConfig: ValidatedConfig = config;

    // Validate webhook URL if configured
    if (validConfig.webhook) {
        const webhookValidation = validateWebhookUrl(validConfig.webhook);
        if (!webhookValidation.valid) {
            console.log(`\n❌ ${webhookValidation.warning}`);
            process.exit(1);
        }
        if (webhookValidation.warning) {
            console.log(`\n⚠️  ${webhookValidation.warning}`);
        }
    }

    // Exit early if only validating config (for testing)
    if (argv.validateOnly) {
        console.log('\n✓ Configuration is valid');
        process.exit(0);
    }

    // Skip confirmation in interactive mode (already confirmed by selection)
    if (!argv.yes && !argv.interactive) {
        const confirmed = await askConfirmation(validConfig);
        if (!confirmed) {
            console.log('\n🚫 Transfer cancelled by user\n');
            process.exit(0);
        }
    }

    // Initialize output
    const output = new Output({
        quiet: argv.quiet,
        json: argv.json,
        logFile: argv.log,
        maxLogSize: parseSize(argv.maxLogSize),
    });
    output.init();
    output.logInfo('Transfer started', { config: validConfig as unknown as Record<string, unknown> });

    // Run transfer
    const result = await runTransfer(validConfig, argv, output);

    if (!result.success) {
        process.exit(1);
    }
}

// Run main
try {
    await main();
} catch (error) {
    console.error('\n❌ Unexpected error:', (error as Error).message);
    process.exit(1);
}
