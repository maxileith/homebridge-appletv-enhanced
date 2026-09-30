import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    camelCaseToTitleCase,
    capitalizeFirstLetter,
    normalizePath,
    removeSpecialCharacters,
    snakeCaseToTitleCase,
    trimToMaxLength,
} from './utils';

describe('utils', (): void => {
    describe('capitalizeFirstLetter', (): void => {
        it('capitalizes the first character and keeps the rest', (): void => {
            assert.equal(capitalizeFirstLetter('hello'), 'Hello');
        });

        it('returns an empty string unchanged', (): void => {
            assert.equal(capitalizeFirstLetter(''), '');
        });
    });

    describe('trimToMaxLength', (): void => {
        it('keeps values within the limit untouched', (): void => {
            assert.equal(trimToMaxLength('hello', 5), 'hello');
        });

        it('truncates values exceeding the limit', (): void => {
            assert.equal(trimToMaxLength('hello world', 5), 'hello');
        });
    });

    describe('removeSpecialCharacters', (): void => {
        it('strips characters outside the allowed set', (): void => {
            assert.equal(removeSpecialCharacters('Hello, (World)!'), 'Hello World');
        });

        it('collapses repeated whitespace and trims the result', (): void => {
            assert.equal(removeSpecialCharacters('  foo   bar  '), 'foo bar');
        });
    });

    describe('snakeCaseToTitleCase', (): void => {
        it('converts snake_case to title case', (): void => {
            assert.equal(snakeCaseToTitleCase('play_pause'), 'Play Pause');
        });

        it('converts a leading underscore', (): void => {
            assert.equal(snakeCaseToTitleCase('_turn_off'), 'Turn Off');
        });
    });

    describe('camelCaseToTitleCase', (): void => {
        it('converts camelCase to title case', (): void => {
            assert.equal(camelCaseToTitleCase('outputDevices'), 'Output Devices');
        });

        it('keeps the iTunes brand spelling', (): void => {
            assert.equal(camelCaseToTitleCase('iTunesStoreIdentifier'), 'iTunes Store Identifier');
        });
    });

    describe('normalizePath', (): void => {
        it('normalizes relative segments', (): void => {
            assert.equal(normalizePath('/foo/../bar'), '/bar');
        });
    });
});
