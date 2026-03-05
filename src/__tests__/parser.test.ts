import { describe, test, expect } from 'bun:test';
import {
    parseWhereFilter,
    parseWhereFilters,
    parseRenameMapping,
    parseStringList,
    parseBoolean,
    mergeConfig,
} from '../config/parser.js';
import { defaults } from '../config/defaults.js';
import type { CliArgs } from '../types.js';

describe('parseBoolean', () => {
    test('returns true for boolean true', () => {
        expect(parseBoolean(true)).toBe(true);
    });

    test('returns false for boolean false', () => {
        expect(parseBoolean(false)).toBe(false);
    });

    test('returns true for string "true"', () => {
        expect(parseBoolean('true')).toBe(true);
    });

    test('returns true for string "TRUE"', () => {
        expect(parseBoolean('TRUE')).toBe(true);
    });

    test('returns false for string "false"', () => {
        expect(parseBoolean('false')).toBe(false);
    });

    test('returns false for other strings', () => {
        expect(parseBoolean('yes')).toBe(false);
        expect(parseBoolean('1')).toBe(false);
    });

    test('returns false for undefined', () => {
        expect(parseBoolean(undefined)).toBe(false);
    });
});

describe('parseStringList', () => {
    test('returns empty array for undefined', () => {
        expect(parseStringList(undefined)).toEqual([]);
    });

    test('returns empty array for empty string', () => {
        expect(parseStringList('')).toEqual([]);
    });

    test('parses single item', () => {
        expect(parseStringList('users')).toEqual(['users']);
    });

    test('parses multiple items', () => {
        expect(parseStringList('users,orders,products')).toEqual(['users', 'orders', 'products']);
    });

    test('trims whitespace', () => {
        expect(parseStringList('  users  ,  orders  ')).toEqual(['users', 'orders']);
    });

    test('filters empty items', () => {
        expect(parseStringList('users,,orders')).toEqual(['users', 'orders']);
    });
});

describe('parseWhereFilter', () => {
    test('parses equality filter', () => {
        const result = parseWhereFilter('status == active');
        expect(result).not.toBeNull();
        expect(result!.field).toBe('status');
        expect(result!.operator).toBe('==');
        expect(result!.value).toBe('active');
    });

    test('parses inequality filter', () => {
        const result = parseWhereFilter('count != 0');
        expect(result).not.toBeNull();
        expect(result!.field).toBe('count');
        expect(result!.operator).toBe('!=');
        expect(result!.value).toBe(0);
    });

    test('parses greater than filter', () => {
        const result = parseWhereFilter('age > 18');
        expect(result).not.toBeNull();
        expect(result!.field).toBe('age');
        expect(result!.operator).toBe('>');
        expect(result!.value).toBe(18);
    });

    test('parses less than filter', () => {
        const result = parseWhereFilter('price < 100');
        expect(result).not.toBeNull();
        expect(result!.operator).toBe('<');
        expect(result!.value).toBe(100);
    });

    test('parses greater than or equal filter', () => {
        const result = parseWhereFilter('score >= 50');
        expect(result).not.toBeNull();
        expect(result!.operator).toBe('>=');
    });

    test('parses less than or equal filter', () => {
        const result = parseWhereFilter('quantity <= 10');
        expect(result).not.toBeNull();
        expect(result!.operator).toBe('<=');
    });

    test('parses boolean true value', () => {
        const result = parseWhereFilter('active == true');
        expect(result).not.toBeNull();
        expect(result!.value).toBe(true);
    });

    test('parses boolean false value', () => {
        const result = parseWhereFilter('deleted == false');
        expect(result).not.toBeNull();
        expect(result!.value).toBe(false);
    });

    test('parses numeric value', () => {
        const result = parseWhereFilter('count == 42');
        expect(result).not.toBeNull();
        expect(result!.value).toBe(42);
    });

    test('parses negative number', () => {
        const result = parseWhereFilter('offset == -10');
        expect(result).not.toBeNull();
        expect(result!.value).toBe(-10);
    });

    test('parses decimal number', () => {
        const result = parseWhereFilter('price == 19.99');
        expect(result).not.toBeNull();
        expect(result!.value).toBe(19.99);
    });

    test('strips quotes from string value', () => {
        const result = parseWhereFilter('name == "John Doe"');
        expect(result).not.toBeNull();
        expect(result!.value).toBe('John Doe');
    });

    test('strips single quotes from string value', () => {
        const result = parseWhereFilter("status == 'pending'");
        expect(result).not.toBeNull();
        expect(result!.value).toBe('pending');
    });

    test('returns null for invalid filter (no operator)', () => {
        const result = parseWhereFilter('status active');
        expect(result).toBeNull();
    });

    test('returns null for empty field', () => {
        const result = parseWhereFilter('== active');
        expect(result).toBeNull();
    });

    test('returns null for empty value', () => {
        const result = parseWhereFilter('status ==');
        expect(result).toBeNull();
    });

    test('handles field names with dots', () => {
        const result = parseWhereFilter('user.name == John');
        expect(result).not.toBeNull();
        expect(result!.field).toBe('user.name');
    });
});

describe('parseWhereFilters', () => {
    test('returns empty array for undefined', () => {
        expect(parseWhereFilters(undefined)).toEqual([]);
    });

    test('returns empty array for empty array', () => {
        expect(parseWhereFilters([])).toEqual([]);
    });

    test('parses multiple filters', () => {
        const filters = parseWhereFilters(['status == active', 'count > 0']);
        expect(filters).toHaveLength(2);
        expect(filters[0].field).toBe('status');
        expect(filters[1].field).toBe('count');
    });

    test('filters out invalid entries', () => {
        const filters = parseWhereFilters(['status == active', 'invalid', 'count > 0']);
        expect(filters).toHaveLength(2);
    });
});

describe('parseRenameMapping', () => {
    test('returns empty object for undefined', () => {
        expect(parseRenameMapping(undefined)).toEqual({});
    });

    test('returns empty object for empty array', () => {
        expect(parseRenameMapping([])).toEqual({});
    });

    test('parses single mapping', () => {
        const result = parseRenameMapping(['users:users_backup']);
        expect(result).toEqual({ users: 'users_backup' });
    });

    test('parses multiple mappings', () => {
        const result = parseRenameMapping(['users:users_v2', 'orders:orders_archive']);
        expect(result).toEqual({
            users: 'users_v2',
            orders: 'orders_archive',
        });
    });

    test('handles string input with comma separation', () => {
        const result = parseRenameMapping('users:backup,orders:archive');
        expect(result).toEqual({
            users: 'backup',
            orders: 'archive',
        });
    });

    test('trims whitespace', () => {
        const result = parseRenameMapping(['  users  :  backup  ']);
        expect(result).toEqual({ users: 'backup' });
    });

    test('ignores invalid mappings (no colon)', () => {
        const result = parseRenameMapping(['users:backup', 'invalid', 'orders:archive']);
        expect(result).toEqual({
            users: 'backup',
            orders: 'archive',
        });
    });

    test('ignores mappings with empty source', () => {
        const result = parseRenameMapping([':backup']);
        expect(result).toEqual({});
    });

    test('ignores mappings with empty dest', () => {
        const result = parseRenameMapping(['users:']);
        expect(result).toEqual({});
    });
});

describe('mergeConfig', () => {
    test('file config values for merge/parallel/clear/deleteMissing are used when CLI does not specify them', () => {
        const fileConfig = {
            merge: true,
            parallel: 4,
            clear: true,
            deleteMissing: true,
        };
        const cliArgs = {} as CliArgs;

        const result = mergeConfig(defaults, fileConfig, cliArgs);

        expect(result.merge).toBe(true);
        expect(result.parallel).toBe(4);
        expect(result.clear).toBe(true);
        expect(result.deleteMissing).toBe(true);
    });

    test('CLI args override file config values', () => {
        const fileConfig = {
            merge: true,
            parallel: 4,
            clear: true,
            deleteMissing: true,
        };
        const cliArgs = {
            merge: false,
            parallel: 2,
            clear: false,
            deleteMissing: false,
        } as CliArgs;

        const result = mergeConfig(defaults, fileConfig, cliArgs);

        expect(result.merge).toBe(false);
        expect(result.parallel).toBe(2);
        expect(result.clear).toBe(false);
        expect(result.deleteMissing).toBe(false);
    });

    test('defaults are used when neither CLI nor file config specify values', () => {
        const fileConfig = {};
        const cliArgs = {} as CliArgs;

        const result = mergeConfig(defaults, fileConfig, cliArgs);

        expect(result.merge).toBe(false);
        expect(result.parallel).toBe(1);
        expect(result.clear).toBe(false);
        expect(result.deleteMissing).toBe(false);
    });
});
