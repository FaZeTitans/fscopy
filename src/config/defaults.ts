import type { Config } from '../types.js';

export const defaults: Config = {
    collections: [],
    includeSubcollections: false,
    dryRun: true,
    batchSize: 500,
    limit: 0,
    sourceProject: null,
    destProject: null,
    retries: 3,
    where: [],
    exclude: [],
    merge: false,
    parallel: 1,
    clear: false,
    deleteMissing: false,
    transform: null,
    renameCollection: {},
    idPrefix: null,
    idSuffix: null,
    webhook: null,
    resume: false,
    stateFile: '.fscopy-state.json',
    verify: false,
    rateLimit: 0,
    skipOversized: false,
    json: false,
    transformSamples: 3,
    detectConflicts: false,
    maxDepth: 0,
    verifyIntegrity: false,
    allowHttpWebhook: false,
};

export const iniTemplate = `; fscopy configuration file

[projects]
source = my-source-project
dest = my-dest-project

[transfer]
; Comma-separated list of collections
collections = collection1, collection2
includeSubcollections = false
dryRun = true
batchSize = 500
limit = 0

[options]
; Filter documents: "field operator value" (operators: ==, !=, <, >, <=, >=)
; where = status == active
; Exclude subcollections by pattern (comma-separated, supports glob)
; exclude = logs, temp/*, cache
; Merge documents instead of overwriting
merge = false
; Number of parallel collection transfers
parallel = 1
; Clear destination collections before transfer (DESTRUCTIVE)
clear = false
; Delete destination docs not present in source (sync mode)
deleteMissing = false
; Transform documents during transfer (path to JS/TS file)
; transform = ./transforms/anonymize.ts
; Rename collections in destination (format: source:dest, comma-separated)
; renameCollection = users:users_backup, orders:orders_2024
; Add prefix or suffix to document IDs
; idPrefix = backup_
; idSuffix = _v2
; Webhook URL for transfer notifications (Slack, Discord, or custom)
; webhook = https://hooks.slack.com/services/...
`;

export const jsonTemplate = {
    sourceProject: 'my-source-project',
    destProject: 'my-dest-project',
    collections: ['collection1', 'collection2'],
    includeSubcollections: false,
    dryRun: true,
    batchSize: 500,
    limit: 0,
    where: [],
    exclude: [],
    merge: false,
    parallel: 1,
    clear: false,
    deleteMissing: false,
    transform: null,
    renameCollection: {},
    idPrefix: null,
    idSuffix: null,
    webhook: null,
};
