const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const { readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const path = require('node:path');

let isSupportedAppleTV;
before(async () => {
    // Exercise the source without third-party test dependencies.
    const source = readFileSync(path.join(__dirname, '../src/deviceSupport.ts'), 'utf8');
    const javascript = stripTypeScriptTypes(source);
    ({ isSupportedAppleTV } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`));
});

test('accepts the AppleTV18,1 identity returned by pyatv 0.18', () => {
    assert.equal(isSupportedAppleTV({
        model: 'Unknown',
        modelName: 'AppleTV18,1',
        os: 'Unknown',
    }), true);
});

test('accepts AppleTV18,1 when pyatv identifies its operating system', () => {
    assert.equal(isSupportedAppleTV({ modelName: 'AppleTV18,1', os: 'TvOS' }), true);
});

test('preserves support for the existing tvOS Apple TV generations', () => {
    for (const model of ['Gen4', 'Gen4K', 'AppleTV4KGen2', 'AppleTV4KGen3']) {
        assert.equal(isSupportedAppleTV({ model, os: 'TvOS' }), true, model);
        assert.equal(isSupportedAppleTV({ model, os: 'Unknown' }), false, model);
    }
});

test('does not accept other unknown devices, HomePods, Macs or legacy Apple TVs', () => {
    const unsupported = [
        {},
        { model: 'Unknown', os: 'Unknown' },
        { model: 'Unknown', modelName: 'AudioAccessory11,1', os: 'Unknown' },
        { model: 'HomePod', modelName: 'HomePod', os: 'TvOS' },
        { model: 'Unknown', modelName: 'Mac16,1', os: 'MacOS' },
        { model: 'Gen3', modelName: 'Apple TV 3', os: 'Legacy' },
        { model: 'Unknown', modelName: 'AppleTV99,1', os: 'Unknown' },
        { model: 'Unknown', modelName: 'AppleTV18,10', os: 'Unknown' },
        { model: 'Unknown', modelName: 'AppleTV18,1', os: 'MacOS' },
        { model: 'Unknown', modelName: 'AppleTV18,1' },
    ];
    for (const device of unsupported) {
        assert.equal(isSupportedAppleTV(device), false, JSON.stringify(device));
    }
});

test('selects supported TVs from a mixed network scan without changing their identity', () => {
    const newTV = { model: 'Unknown', modelName: 'AppleTV18,1', os: 'Unknown' };
    const existingTV = { model: 'AppleTV4KGen3', modelName: 'Apple TV 4K (3rd generation)', os: 'TvOS' };
    const speaker = { model: 'HomePodMini', os: 'TvOS' };
    const scan = [speaker, newTV, { model: 'Unknown', os: 'Unknown' }, existingTV];
    const before = structuredClone(scan);
    const selected = scan.filter(isSupportedAppleTV);
    assert.deepEqual(selected, [newTV, existingTV]);
    assert.equal(selected[0], newTV);
    assert.deepEqual(scan, before);
});
