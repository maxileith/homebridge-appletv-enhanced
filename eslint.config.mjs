/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/typedef */
import stylisticJs from '@stylistic/eslint-plugin-js';
import stylisticTs from '@stylistic/eslint-plugin-ts';
import tsParser from '@typescript-eslint/parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

export default [
    {
        ignores: ['**/dist'],
    },
    ...compat.extends(
        'eslint:recommended',
        'plugin:@typescript-eslint/eslint-recommended',
        'plugin:@typescript-eslint/recommended',
    ),
    {
        languageOptions: {
            parser: tsParser,
            ecmaVersion: 2018,
            sourceType: 'module',
            parserOptions: {
                project: 'tsconfig.json',
            },
        },
        plugins: {
            '@stylistic/js': stylisticJs,
            '@stylistic/ts': stylisticTs,
        },

        rules: {
            'lines-between-class-members': [
                'warn',
                'always',
                {
                    exceptAfterSingleLine: true,
                },
            ],

            'class-methods-use-this': 'off',
            'comma-dangle': ['warn', 'always-multiline'],
            'comma-spacing': ['error'],
            curly: ['warn', 'all'],
            eqeqeq: 'warn',
            'default-param-last': 'off',
            'dot-notation': 'off',
            'init-declarations': 'off',
            'prefer-arrow-callback': ['warn'],
            'max-len': ['warn', 140],
            'no-console': ['warn'],
            'no-loop-func': 'off',
            'no-empty-function': 'off',
            'no-implied-eval': 'off',
            'no-unused-expressions': 'off',
            'no-case-declarations': 'off',
            'no-non-null-assertion': ['off'],
            'no-unused-vars': 'off',
            'no-multi-spaces': [
                'warn',
                {
                    ignoreEOLComments: true,
                },
            ],
            'no-trailing-spaces': ['warn'],
            'no-throw-literal': 'off',
            'no-useless-constructor': 'off',
            'no-constant-condition': 'off',
            'require-await': 'off',
            '@typescript-eslint/adjacent-overload-signatures': 'warn',
            '@typescript-eslint/array-type': 'warn',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/class-literal-property-style': 'error',
            // '@typescript-eslint/class-methods-use-this': 'error',
            '@typescript-eslint/consistent-generic-constructors': 'error',
            '@typescript-eslint/consistent-indexed-object-style': 'error',
            '@typescript-eslint/consistent-return': 'warn',
            '@typescript-eslint/consistent-type-assertions': 'error',
            '@typescript-eslint/consistent-type-definitions': 'error',
            '@typescript-eslint/consistent-type-exports': 'warn',
            '@typescript-eslint/consistent-type-imports': 'warn',
            '@typescript-eslint/default-param-last': 'error',
            '@typescript-eslint/dot-notation': 'warn',
            '@typescript-eslint/explicit-function-return-type': 'warn',
            '@typescript-eslint/explicit-member-accessibility': 'error',
            '@typescript-eslint/explicit-module-boundary-types': 'error',
            '@typescript-eslint/init-declarations': 'error',
            '@typescript-eslint/member-ordering': [
                'warn',
                {
                    default: {
                        order: 'alphabetically',
                    },
                },
            ],
            '@typescript-eslint/method-signature-style': 'warn',
            '@typescript-eslint/naming-convention': [
                'warn',
                {
                    selector: 'default',
                    format: ['camelCase'],
                    leadingUnderscore: 'allow',
                    trailingUnderscore: 'allow',
                },
                {
                    selector: 'import',
                    format: ['camelCase', 'PascalCase'],
                },
                {
                    selector: 'variable',
                    format: ['camelCase', 'UPPER_CASE'],
                    leadingUnderscore: 'allow',
                    trailingUnderscore: 'allow',
                },
                {
                    selector: 'typeLike',
                    format: ['PascalCase'],
                },
                {
                    selector: 'enumMember',
                    format: ['camelCase', 'UPPER_CASE'],
                },
            ],
            '@typescript-eslint/no-array-constructor': 'warn',
            '@typescript-eslint/no-array-delete': 'error',
            '@typescript-eslint/no-base-to-string': 'off',
            '@typescript-eslint/no-confusing-non-null-assertion': 'warn',
            '@typescript-eslint/no-confusing-void-expression': 'error',
            '@typescript-eslint/no-dupe-class-members': 'off',
            '@typescript-eslint/no-duplicate-enum-values': 'warn',
            '@typescript-eslint/no-duplicate-type-constituents': 'warn',
            '@typescript-eslint/no-dynamic-delete': 'error',
            '@typescript-eslint/no-empty-function': 'warn',
            '@typescript-eslint/no-empty-object-type': 'warn',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-extra-non-null-assertion': 'warn',
            '@typescript-eslint/no-extraneous-class': 'error',
            '@typescript-eslint/no-floating-promises': 'warn',
            '@typescript-eslint/no-for-in-array': 'warn',
            '@typescript-eslint/no-implied-eval': 'error',
            '@typescript-eslint/no-import-type-side-effects': 'error',
            '@typescript-eslint/no-inferrable-types': 'off',
            '@typescript-eslint/no-invalid-void-type': 'warn',
            '@typescript-eslint/no-loop-func': 'off',
            '@typescript-eslint/no-meaningless-void-operator': 'warn',
            '@typescript-eslint/no-misused-new': 'warn',
            '@typescript-eslint/no-misused-promises': 'warn',
            '@typescript-eslint/no-mixed-enums': 'warn',
            '@typescript-eslint/no-namespace': 'warn',
            '@typescript-eslint/no-non-null-asserted-nullish-coalescing': 'error',
            '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/no-require-imports': 'error',
            '@typescript-eslint/no-this-alias': 'error',
            '@typescript-eslint/no-unnecessary-condition': 'off',
            '@typescript-eslint/no-unnecessary-template-expression': 'warn',
            '@typescript-eslint/no-unnecessary-type-constraint': 'warn',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-declaration-merging': 'error',
            '@typescript-eslint/no-unsafe-enum-comparison': 'error',
            '@typescript-eslint/no-unsafe-function-type': 'error',
            '@typescript-eslint/no-unsafe-member-access': 'error',
            '@typescript-eslint/no-unsafe-return': 'error',
            '@typescript-eslint/no-unused-expressions': 'warn',
            '@typescript-eslint/no-unused-vars': 'warn',
            '@typescript-eslint/no-useless-constructor': 'warn',
            '@typescript-eslint/no-useless-empty-export': 'warn',
            '@typescript-eslint/prefer-enum-initializers': 'error',
            '@typescript-eslint/prefer-find': 'warn',
            '@typescript-eslint/prefer-for-of': 'warn',
            '@typescript-eslint/prefer-function-type': 'warn',
            '@typescript-eslint/prefer-includes': 'warn',
            '@typescript-eslint/prefer-namespace-keyword': 'warn',
            '@typescript-eslint/prefer-optional-chain': 'warn',
            '@typescript-eslint/prefer-readonly-parameter-types': 'off',
            '@typescript-eslint/prefer-return-this-type': 'warn',
            '@typescript-eslint/prefer-string-starts-ends-with': 'warn',
            '@typescript-eslint/promise-function-async': 'error',
            '@typescript-eslint/require-array-sort-compare': 'warn',
            '@typescript-eslint/require-await': 'off',
            '@typescript-eslint/restrict-plus-operands': 'warn',
            '@typescript-eslint/restrict-template-expressions': 'off',
            '@typescript-eslint/strict-boolean-expressions': 'warn',
            '@typescript-eslint/sort-type-constituents': 'warn',
            '@typescript-eslint/switch-exhaustiveness-check': 'warn',
            '@typescript-eslint/typedef': [
                'warn',
                {
                    arrayDestructuring: true,
                    variableDeclaration: true,
                    variableDeclarationIgnoreFunction: true,
                },
            ],
            '@typescript-eslint/unified-signatures': 'warn',

            '@stylistic/js/array-bracket-newline': [
                'warn', {
                    multiline: true,
                    minItems: 5,
                },
            ],
            '@stylistic/js/array-bracket-spacing': ['warn', 'never'],
            '@stylistic/js/arrow-parens': ['warn', 'always'],
            '@stylistic/js/arrow-spacing': [
                'warn', {
                    before: true,
                    after: true,
                },
            ],
            '@stylistic/ts/block-spacing': ['warn', 'always'],
            '@stylistic/ts/brace-style': ['warn', '1tbs'],
            '@stylistic/ts/comma-dangle': ['warn', 'always-multiline'],
            '@stylistic/ts/comma-spacing': [
                'warn', {
                    before: false,
                    after: true,
                },
            ],
            '@stylistic/js/dot-location': ['warn', 'property'],
            '@stylistic/js/eol-last': ['warn', 'always'],
            '@stylistic/ts/function-call-spacing': ['warn', 'never'],
            '@stylistic/ts/indent': ['warn', 4],
            '@stylistic/ts/key-spacing': ['warn', { beforeColon: false }],
            '@stylistic/ts/keyword-spacing': [
                'warn', {
                    before: true,
                    after: true,
                },
            ],
            '@stylistic/js/linebreak-style': ['warn', 'unix'],
            '@stylistic/js/max-statements-per-line': [
                'warn', {
                    max: 1,
                },
            ],
            '@stylistic/js/multiline-ternary': ['warn', 'always-multiline'],
            '@stylistic/js/new-parens': ['warn', 'always'],
            '@stylistic/js/no-confusing-arrow': 'warn',
            '@stylistic/ts/no-extra-parens': 'warn',
            '@stylistic/ts/no-extra-semi': 'warn',
            '@stylistic/js/no-floating-decimal': 'warn',
            '@stylistic/js/no-mixed-spaces-and-tabs': 'warn',
            '@stylistic/js/no-multi-spaces': 'warn',
            '@stylistic/js/no-multiple-empty-lines': [
                'warn', {
                    max: 2,
                },
            ],
            '@stylistic/js/no-trailing-spaces': 'warn',
            '@stylistic/js/no-whitespace-before-property': 'warn',
            '@stylistic/ts/object-curly-spacing': ['warn', 'always'],
            '@stylistic/ts/quote-props': ['warn', 'as-needed'],
            '@stylistic/js/quotes': ['warn', 'single'],
            '@stylistic/js/rest-spread-spacing': ['warn', 'never'],
            '@stylistic/ts/semi': ['warn', 'always'],
            '@stylistic/js/semi-spacing': [
                'warn', {
                    before: false,
                    after: true,
                },
            ],
            '@stylistic/js/semi-style': ['warn', 'last'],
            '@stylistic/ts/space-before-blocks': 'warn',
            '@stylistic/ts/space-before-function-paren': [
                'warn', {
                    anonymous: 'never',
                    named: 'never',
                    asyncArrow: 'always',
                },
            ],
            '@stylistic/js/space-in-parens': ['warn', 'never'],
            '@stylistic/js/switch-colon-spacing': [
                'warn', {
                    before: false,
                    after: true,
                },
            ],
            '@stylistic/js/template-curly-spacing': ['warn', 'never'],
            '@stylistic/ts/type-annotation-spacing': [
                'warn', {
                    before: false,
                    after: true,
                    overrides: {
                        arrow: {
                            before: true,
                            after: true,
                        },
                    },
                },
            ],
        },
    },
];
