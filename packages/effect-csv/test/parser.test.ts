import { assert, describe, it } from '@effect/vitest'
import { Cause } from 'effect'
import type * as Csv from '../src/Csv.ts'
import * as Parser from '../src/internal/parser.ts'
import { type Outcome, parseChunks } from './utils.ts'

interface Case {
	readonly name: string
	readonly input: string | ReadonlyArray<string>
	readonly options?: Csv.DecodeOptions
	readonly rows?: ReadonlyArray<Csv.Row>
	readonly error?: Outcome['error']
}

const check = ({ input, options, rows = [], error }: Case) => {
	const outcome = parseChunks(typeof input === 'string' ? [input] : input, options)
	assert.deepStrictEqual(outcome, { rows, error })
}

describe('parser', () => {
	describe('records and fields', () => {
		it.each<Case>([
			{ name: 'empty input', input: '', rows: [] },
			{ name: 'one field', input: 'a', rows: [['a']] },
			{ name: 'fields', input: 'a,b,c', rows: [['a', 'b', 'c']] },
			{
				name: 'LF',
				input: 'a,b\nc,d',
				rows: [
					['a', 'b'],
					['c', 'd'],
				],
			},
			{
				name: 'CRLF',
				input: 'a,b\r\nc,d',
				rows: [
					['a', 'b'],
					['c', 'd'],
				],
			},
			{
				name: 'CR',
				input: 'a,b\rc,d',
				rows: [
					['a', 'b'],
					['c', 'd'],
				],
			},
			{ name: 'mixed line breaks', input: 'a\rb\nc\r\nd', rows: [['a'], ['b'], ['c'], ['d']] },
			{ name: 'trailing LF', input: 'a\n', rows: [['a']] },
			{ name: 'trailing CRLF', input: 'a\r\n', rows: [['a']] },
			{ name: 'trailing CR', input: 'a\r', rows: [['a']] },
			{ name: 'trailing delimiter', input: 'a,', rows: [['a', '']] },
			{ name: 'leading delimiter', input: ',a', rows: [['', 'a']] },
			{ name: 'only a delimiter', input: ',', rows: [['', '']] },
			{
				name: 'delimiter before a line break',
				input: 'a,\nb,',
				rows: [
					['a', ''],
					['b', ''],
				],
			},
			{ name: 'blank line', input: '\n', rows: [['']] },
			{
				name: 'blank lines between records',
				input: 'a\n\r\n\rb',
				rows: [['a'], [''], [''], ['b']],
			},
			{ name: 'whitespace is kept', input: ' a , b ', rows: [[' a ', ' b ']] },
			{ name: 'non-ASCII text', input: 'é,ʤ,😀', rows: [['é', 'ʤ', '😀']] },
		])('$name', check)
	})

	describe('quoted fields', () => {
		it.each<Case>([
			{ name: 'empty', input: '""', rows: [['']] },
			{ name: 'empty fields', input: '"",""', rows: [['', '']] },
			{ name: 'delimiter inside', input: '"a,b",c', rows: [['a,b', 'c']] },
			{ name: 'escaped quote', input: '"a""b"', rows: [['a"b']] },
			{ name: 'only an escaped quote', input: '""""', rows: [['"']] },
			{ name: 'consecutive escaped quotes', input: '"a""""b"', rows: [['a""b']] },
			{ name: 'LF inside', input: '"a\nb",c', rows: [['a\nb', 'c']] },
			{ name: 'CRLF inside', input: '"a\r\nb"', rows: [['a\r\nb']] },
			{ name: 'CR inside', input: '"a\rb"', rows: [['a\rb']] },
			{ name: 'closing quote before LF', input: '"a"\nb', rows: [['a'], ['b']] },
			{ name: 'closing quote before CRLF', input: '"a"\r\nb', rows: [['a'], ['b']] },
			{ name: 'closing quote before CR', input: '"a"\rb', rows: [['a'], ['b']] },
			{ name: 'closing quote at the end', input: 'a,"b"', rows: [['a', 'b']] },
			{ name: 'mixed with unquoted fields', input: 'a,"b",c', rows: [['a', 'b', 'c']] },
		])('$name', check)
	})

	describe('byte-order mark', () => {
		it.each<Case>([
			{ name: 'removed at the start', input: '\uFEFFa,b', rows: [['a', 'b']] },
			{ name: 'alone', input: '\uFEFF', rows: [] },
			{ name: 'only one is removed', input: '\uFEFF\uFEFFa', rows: [['\uFEFFa']] },
			{ name: 'kept after the start', input: 'a\n\uFEFFb', rows: [['a'], ['\uFEFFb']] },
			{ name: 'removed after empty chunks', input: ['', '', '\uFEFFa'], rows: [['a']] },
			{ name: 'kept in a later chunk', input: ['\uFEFF', '\uFEFFa'], rows: [['\uFEFFa']] },
			{ name: 'kept in a second chunk', input: ['a', '\uFEFFb'], rows: [['a\uFEFFb']] },
		])('$name', check)
	})

	describe('chunk boundaries', () => {
		it.each<Case>([
			{ name: 'field across chunks', input: ['ab', 'c,d'], rows: [['abc', 'd']] },
			{ name: 'CRLF across chunks', input: ['a\r', '\nb'], rows: [['a'], ['b']] },
			{ name: 'CR at the end of a chunk', input: ['a\r', 'b'], rows: [['a'], ['b']] },
			{ name: 'quoted field across chunks', input: ['"a,', 'b"'], rows: [['a,b']] },
			{ name: 'escaped quote across chunks', input: ['"a"', '"b"'], rows: [['a"b']] },
			{
				name: 'escaped quote at the end of a chunk',
				input: ['"', '"', '"', '"'],
				rows: [['"']],
			},
			{ name: 'escaped quote ends a chunk', input: ['"a""', 'b"'], rows: [['a"b']] },
			{ name: 'closing quote at the end of a chunk', input: ['"a"', ',b'], rows: [['a', 'b']] },
			{ name: 'empty chunks', input: ['', 'a', '', ',', '', 'b', ''], rows: [['a', 'b']] },
		])('$name', check)
	})

	describe('errors', () => {
		it.each<Case>([
			{ name: 'unclosed quote', input: '"a', error: { _tag: 'UnclosedQuote', line: 1 } },
			{ name: 'unclosed empty quote', input: 'a,"', error: { _tag: 'UnclosedQuote', line: 1 } },
			{
				name: 'unclosed quote on a later line',
				input: 'a\n"b\nc',
				rows: [['a']],
				error: { _tag: 'UnclosedQuote', line: 2 },
			},
			{
				name: 'text after a closing quote',
				input: '"a"b',
				error: { _tag: 'InvalidQuote', line: 1, fieldIndex: 0 },
			},
			{
				name: 'space after a closing quote',
				input: 'x,"a" ,b',
				error: { _tag: 'InvalidQuote', line: 1, fieldIndex: 1 },
			},
			{
				name: 'quote inside an unquoted field',
				input: 'a,b"c',
				error: { _tag: 'InvalidQuote', line: 1, fieldIndex: 1 },
			},
			{
				name: 'quote after leading whitespace',
				input: 'x\na, "b"',
				rows: [['x']],
				error: { _tag: 'InvalidQuote', line: 2, fieldIndex: 1 },
			},
			{
				name: 'invalid quote reports the line where the record starts',
				input: 'x\n"a\nb"c',
				rows: [['x']],
				error: { _tag: 'InvalidQuote', line: 2, fieldIndex: 0 },
			},
			{
				name: 'fewer fields than the first record',
				input: 'a,b\nc',
				rows: [['a', 'b']],
				error: { _tag: 'FieldCountMismatch', line: 2, expected: 2, actual: 1 },
			},
			{
				name: 'more fields than the first record',
				input: 'a\nb,c',
				rows: [['a']],
				error: { _tag: 'FieldCountMismatch', line: 2, expected: 1, actual: 2 },
			},
			{
				name: 'blank line in multi-column input',
				input: 'a,b\n\nc,d',
				rows: [['a', 'b']],
				error: { _tag: 'FieldCountMismatch', line: 2, expected: 2, actual: 1 },
			},
			{
				name: 'mismatch at the end of the input',
				input: 'a,b\nc,d\ne',
				rows: [
					['a', 'b'],
					['c', 'd'],
				],
				error: { _tag: 'FieldCountMismatch', line: 3, expected: 2, actual: 1 },
			},
		])('$name', check)
	})

	describe('line numbers', () => {
		it.each([
			['"a\nb",c\nd', 3],
			['"a\r\nb",c\r\nd', 3],
			['"a\rb",c\rd', 3],
			['"a\r\rb",c\nd', 4],
			['"a\n\rb",c\nd', 4],
			['"a\n\nb",c\n\n', 4],
			['a,b\n"c\nd",e\nf', 4],
		] as const)('%j fails on line %i', (input, line) => {
			const outcome = parseChunks([input])
			assert.deepStrictEqual(outcome.error, {
				_tag: 'FieldCountMismatch',
				line,
				expected: 2,
				actual: 1,
			})
		})

		it('counts a CRLF inside quotes once when it is split across chunks', () => {
			const outcome = parseChunks(['"a\r', '\nb",c\nd'])
			assert.deepStrictEqual(outcome.error, {
				_tag: 'FieldCountMismatch',
				line: 3,
				expected: 2,
				actual: 1,
			})
		})

		it.each([
			['#a\r\n"b\nc",d\n\n#e\rf', 6],
			['\r\n#a,b\n"c\r\n\rd",e\r#\n\r\nf', 8],
			['  \n#\n x,y\n\t\n f', 5],
		] as const)('counts skipped lines: %j fails on line %i', (input, line) => {
			const outcome = parseChunks([input], { comment: '#', skipEmptyLines: true, trim: true })
			assert.deepStrictEqual(outcome.error, {
				_tag: 'FieldCountMismatch',
				line,
				expected: 2,
				actual: 1,
			})
		})

		it('counts a quoted LF after a chunk that ends with a CR terminator', () => {
			const outcome = parseChunks(['a,b\r', '"\nc",d\ne'])
			assert.deepStrictEqual(outcome.error, {
				_tag: 'FieldCountMismatch',
				line: 4,
				expected: 2,
				actual: 1,
			})
		})
	})

	describe('options', () => {
		describe('delimiter', () => {
			it.each<Case>([
				{ name: 'tab', input: 'a\tb,c', options: { delimiter: '\t' }, rows: [['a', 'b,c']] },
				{
					name: 'semicolon with quotes',
					input: '"a;b";c\nd;e',
					options: { delimiter: ';' },
					rows: [
						['a;b', 'c'],
						['d', 'e'],
					],
				},
			])('$name', check)
		})

		describe('quote', () => {
			it.each<Case>([
				{
					name: 'single quote',
					input: `'a,b',"c"`,
					options: { quote: "'" },
					rows: [['a,b', '"c"']],
				},
				{
					name: 'doubled custom quote',
					input: `'a''b'`,
					options: { quote: "'" },
					rows: [["a'b"]],
				},
				{
					name: 'null disables quoting',
					input: '"a,b"\nc"d,e',
					options: { quote: null },
					rows: [
						['"a', 'b"'],
						['c"d', 'e'],
					],
				},
				{
					name: 'null ignores escape',
					input: 'a\\,b',
					options: { quote: null, escape: '\\' },
					rows: [['a\\', 'b']],
				},
			])('$name', check)
		})

		describe('escape', () => {
			const backslash = { escape: '\\' } as const
			it.each<Case>([
				{ name: 'escapes a quote', input: '"a\\"b",c', options: backslash, rows: [['a"b', 'c']] },
				{ name: 'escapes itself', input: '"a\\\\b"', options: backslash, rows: [['a\\b']] },
				{
					name: 'kept before another character',
					input: '"a\\b\\\nc"',
					options: backslash,
					rows: [['a\\b\\\nc']],
				},
				{ name: 'escaped quote at the start', input: '"\\"a"', options: backslash, rows: [['"a']] },
				{ name: 'only in quoted fields', input: 'a\\,b', options: backslash, rows: [['a\\', 'b']] },
				{
					name: 'escape across chunks',
					input: ['"a\\', '"b"'],
					options: backslash,
					rows: [['a"b']],
				},
				{
					name: 'escape before another character across chunks',
					input: ['"a\\', 'b"'],
					options: backslash,
					rows: [['a\\b']],
				},
				{
					name: 'escaped quote alone in a chunk',
					input: ['"a\\', '"', 'b"'],
					options: backslash,
					rows: [['a"b']],
				},
				{
					name: 'escaped escape alone in a chunk',
					input: ['"a\\', '\\', 'b"'],
					options: backslash,
					rows: [['a\\b']],
				},
				{
					name: 'doubled quote is not an escape',
					input: '"a""b"',
					options: backslash,
					error: { _tag: 'InvalidQuote', line: 1, fieldIndex: 0 },
				},
				{
					name: 'escaped closing quote leaves the field open',
					input: '"a\\"',
					options: backslash,
					error: { _tag: 'UnclosedQuote', line: 1 },
				},
				{
					name: 'input ends after an escape',
					input: '"a\\',
					options: backslash,
					error: { _tag: 'UnclosedQuote', line: 1 },
				},
				{
					name: 'explicit escape equal to quote',
					input: '"a""b"',
					options: { escape: '"' },
					rows: [['a"b']],
				},
			])('$name', check)
		})

		describe('relaxColumnCount', () => {
			it.each<Case>([
				{
					name: 'allows differing field counts',
					input: 'a,b\nc\nd,e,f\n\n',
					options: { relaxColumnCount: true },
					rows: [['a', 'b'], ['c'], ['d', 'e', 'f'], ['']],
				},
			])('$name', check)
		})

		describe('maxRecordSize', () => {
			const max = (maxRecordSize: number) => ({ maxRecordSize }) as const
			it.each<Case>([
				{
					name: 'a record of exactly the limit',
					input: 'abc\nde',
					options: max(3),
					rows: [['abc'], ['de']],
				},
				{ name: 'line break is not counted', input: 'ab\r\n', options: max(2), rows: [['ab']] },
				{
					name: 'unquoted record',
					input: 'abcd',
					options: max(3),
					error: { _tag: 'RecordTooLarge', line: 1, maxRecordSize: 3 },
				},
				{
					name: 'delimiters count',
					input: 'a,b\nc,de',
					options: max(3),
					rows: [['a', 'b']],
					error: { _tag: 'RecordTooLarge', line: 2, maxRecordSize: 3 },
				},
				{
					name: 'empty fields count',
					input: ',,,,',
					options: max(3),
					error: { _tag: 'RecordTooLarge', line: 1, maxRecordSize: 3 },
				},
				{ name: 'quotes count', input: '"a"', options: max(3), rows: [['a']] },
				{
					name: 'quoted record',
					input: '"ab"',
					options: max(3),
					error: { _tag: 'RecordTooLarge', line: 1, maxRecordSize: 3 },
				},
				{
					name: 'line breaks inside quotes count',
					input: '"a\nb"',
					options: max(4),
					error: { _tag: 'RecordTooLarge', line: 1, maxRecordSize: 4 },
				},
				{
					name: 'unclosed quote fails fast',
					input: ['"abc', 'def', 'ghi'],
					options: max(5),
					error: { _tag: 'RecordTooLarge', line: 1, maxRecordSize: 5 },
				},
				{
					name: 'checked before an invalid quote at the limit',
					input: 'ab"',
					options: max(2),
					error: { _tag: 'RecordTooLarge', line: 1, maxRecordSize: 2 },
				},
				{
					name: 'invalid quote before the limit',
					input: '"a"b',
					options: max(4),
					error: { _tag: 'InvalidQuote', line: 1, fieldIndex: 0 },
				},
				{
					name: 'record across chunks',
					input: ['a', 'b', ',', 'c'],
					options: max(3),
					error: { _tag: 'RecordTooLarge', line: 1, maxRecordSize: 3 },
				},
				{
					name: 'limit applies per record',
					input: ['ab\n', 'cd\n', 'ef'],
					options: max(2),
					rows: [['ab'], ['cd'], ['ef']],
				},
				{
					name: 'record ended by a line break alone in a chunk',
					input: ['ab', '\n', 'cd'],
					options: max(2),
					rows: [['ab'], ['cd']],
				},
				{
					name: 'record ended by a CRLF split across chunks',
					input: ['ab', '\r', '\n', 'cd'],
					options: max(2),
					rows: [['ab'], ['cd']],
				},
				{
					name: 'quoted record ended at a chunk boundary',
					input: ['"a', '"', '\n', 'cd'],
					options: max(3),
					rows: [['a'], ['cd']],
				},
				{
					name: 'Infinity disables the limit',
					input: 'a'.repeat(1000),
					options: max(Number.POSITIVE_INFINITY),
					rows: [['a'.repeat(1000)]],
				},
			])('$name', check)

			it('defaults to 10 MiB', () => {
				assert.strictEqual(Parser.defaultMaxRecordSize, 10 * 1024 * 1024)
				const outcome = parseChunks(['a'.repeat(Parser.defaultMaxRecordSize), 'b'])
				assert.deepStrictEqual(outcome.error, {
					_tag: 'RecordTooLarge',
					line: 1,
					maxRecordSize: Parser.defaultMaxRecordSize,
				})
			})
		})

		describe('trim', () => {
			const trim = { trim: true } as const
			it.each<Case>([
				{ name: 'unquoted fields', input: '  a  , b ,c', options: trim, rows: [['a', 'b', 'c']] },
				{ name: 'keeps inner whitespace', input: ' a b ', options: trim, rows: [['a b']] },
				{
					name: 'around quoted fields',
					input: '  " a , b "  ,c',
					options: trim,
					rows: [[' a , b ', 'c']],
				},
				{
					name: 'after a closing quote before a line break',
					input: '"a"  \n"b" \r\n c',
					options: trim,
					rows: [['a'], ['b'], ['c']],
				},
				{ name: 'after a closing quote at the end', input: '"a"  ', options: trim, rows: [['a']] },
				{ name: 'empty fields', input: ' , ', options: trim, rows: [['', '']] },
				{
					name: 'a tab delimiter is not whitespace',
					input: ' a \t b ',
					options: { trim: true, delimiter: '\t' },
					rows: [['a', 'b']],
				},
				{ name: 'tabs', input: 'a\t,\tb', options: trim, rows: [['a', 'b']] },
				{
					name: 'Unicode whitespace',
					input: '\u00A0a\u3000,\u2003b\uFEFF',
					options: trim,
					rows: [['a', 'b']],
				},
				{
					name: 'a line of only whitespace is a record',
					input: 'a\n \t \nb',
					options: trim,
					rows: [['a'], [''], ['b']],
				},
				{
					name: 'a whitespace quote is not trimmed',
					input: ' a ,\tb\t',
					options: { trim: true, quote: ' ' },
					rows: [['a', 'b']],
				},
				{
					name: 'a whitespace quote kept by relaxQuotes is not trimmed',
					input: '\ta \t',
					options: { trim: true, quote: ' ', relaxQuotes: true },
					rows: [['a ']],
				},
				{
					name: 'a whitespace quote after a closing quote is not trimmed',
					input: ' a \t ',
					options: { trim: true, quote: ' ', escape: '\\' },
					error: { _tag: 'InvalidQuote', line: 1, fieldIndex: 0 },
				},
				{
					name: 'a quote after leading whitespace opens a quoted field',
					input: 'a, "b,c"',
					options: trim,
					rows: [['a', 'b,c']],
				},
				{
					name: 'whitespace across chunks',
					input: ['  ', ' "a', '"  ', '  ,b  ', ' '],
					options: trim,
					rows: [['a', 'b']],
				},
				{
					name: 'text after a closing quote still fails',
					input: '"a" b',
					options: trim,
					error: { _tag: 'InvalidQuote', line: 1, fieldIndex: 0 },
				},
				{
					name: 'a quote after whitespace after a closing quote is not an escape',
					input: 'x,"a" ""',
					options: trim,
					error: { _tag: 'InvalidQuote', line: 1, fieldIndex: 1 },
				},
				{
					name: 'skipped whitespace counts towards maxRecordSize',
					input: '    a',
					options: { trim: true, maxRecordSize: 3 },
					error: { _tag: 'RecordTooLarge', line: 1, maxRecordSize: 3 },
				},
				{
					name: 'a line of only whitespace counts towards maxRecordSize',
					input: 'a\n    \nb',
					options: { trim: true, maxRecordSize: 3 },
					rows: [['a']],
					error: { _tag: 'RecordTooLarge', line: 2, maxRecordSize: 3 },
				},
				{
					name: 'whitespace at the end of the input counts towards maxRecordSize',
					input: 'a,    ',
					options: { trim: true, maxRecordSize: 3 },
					error: { _tag: 'RecordTooLarge', line: 1, maxRecordSize: 3 },
				},
				{
					name: 'whitespace after a closing quote counts towards maxRecordSize',
					input: '"a"  ',
					options: { trim: true, maxRecordSize: 4 },
					error: { _tag: 'RecordTooLarge', line: 1, maxRecordSize: 4 },
				},
				{
					name: 'a line of only whitespace at the limit',
					input: '   \nb',
					options: { trim: true, maxRecordSize: 3 },
					rows: [[''], ['b']],
				},
			])('$name', check)
		})

		describe('comment', () => {
			const hash = { comment: '#' } as const
			it.each<Case>([
				{
					name: 'skips lines that start with the comment character',
					input: '#x\na\n#y,"z\nb',
					options: hash,
					rows: [['a'], ['b']],
				},
				{
					name: 'only at the start of a line',
					input: 'a#b,#c',
					options: hash,
					rows: [['a#b', '#c']],
				},
				{
					name: 'not on a line inside a quoted field',
					input: '"a\n#b"',
					options: hash,
					rows: [['a\n#b']],
				},
				{
					name: 'not after leading whitespace',
					input: ' #x',
					options: hash,
					rows: [[' #x']],
				},
				{ name: 'at the end of the input', input: 'a\n#b', options: hash, rows: [['a']] },
				{ name: 'alone', input: '#a\r\n#b\r', options: hash, rows: [] },
				{ name: 'empty comment lines', input: '#\n#\ra', options: hash, rows: [['a']] },
				{
					name: 'CRLF after a comment across chunks',
					input: ['#a\r', '\nb'],
					options: hash,
					rows: [['b']],
				},
				{ name: 'after a byte-order mark', input: '\uFEFF#x\na', options: hash, rows: [['a']] },
				{
					name: 'does not set the column count',
					input: '#x\na,b\n#y\nc,d',
					options: hash,
					rows: [
						['a', 'b'],
						['c', 'd'],
					],
				},
				{
					name: 'does not count towards maxRecordSize',
					input: ['#xxx', 'xxx\nab'],
					options: { comment: '#', maxRecordSize: 2 },
					rows: [['ab']],
				},
				{
					name: 'counts in line numbers',
					input: 'a,b\n#x\r\n#y\nc',
					options: hash,
					rows: [['a', 'b']],
					error: { _tag: 'FieldCountMismatch', line: 4, expected: 2, actual: 1 },
				},
				{
					name: 'with trim, after leading whitespace',
					input: ' \t#x\na',
					options: { comment: '#', trim: true },
					rows: [['a']],
				},
				{
					name: 'with trim, not after a delimiter',
					input: 'a, #b\n #c',
					options: { comment: '#', trim: true },
					rows: [['a', '#b']],
				},
				{
					name: 'with trim, leading whitespace does not count towards maxRecordSize',
					input: '     #x\na',
					options: { comment: '#', trim: true, maxRecordSize: 2 },
					rows: [['a']],
				},
				{
					name: 'the escape character',
					input: '\\x\n"a\\"b"',
					options: { comment: '\\', escape: '\\' },
					rows: [['a"b']],
				},
				{
					name: 'the quote character when quoting is disabled',
					input: '"x\na"',
					options: { comment: '"', quote: null },
					rows: [['a"']],
				},
			])('$name', check)
		})

		describe('skipEmptyLines', () => {
			const skip = { skipEmptyLines: true } as const
			it.each<Case>([
				{
					name: 'skips lines without characters',
					input: '\na,b\n\r\n\rc,d\n\n',
					options: skip,
					rows: [
						['a', 'b'],
						['c', 'd'],
					],
				},
				{ name: 'only empty lines', input: '\n\r\n\r', options: skip, rows: [] },
				{
					name: 'a quoted empty field is a record',
					input: '""\n\n""',
					options: skip,
					rows: [[''], ['']],
				},
				{ name: 'a delimiter is a record', input: ',\n\n', options: skip, rows: [['', '']] },
				{
					name: 'a line of only whitespace is a record',
					input: ' \n\t',
					options: skip,
					rows: [[' '], ['\t']],
				},
				{
					name: 'with trim, skips lines of only whitespace',
					input: 'a\n \t \nb\n  ',
					options: { skipEmptyLines: true, trim: true },
					rows: [['a'], ['b']],
				},
				{
					name: 'with trim, long lines of only whitespace are not records',
					input: 'a\n     \nb',
					options: { skipEmptyLines: true, trim: true, maxRecordSize: 2 },
					rows: [['a'], ['b']],
				},
				{
					name: 'line breaks across chunks',
					input: ['a\r', '\n', '\r', '\nb'],
					options: skip,
					rows: [['a'], ['b']],
				},
				{
					name: 'does not set the column count',
					input: '\n\na,b',
					options: skip,
					rows: [['a', 'b']],
				},
				{
					name: 'counts in line numbers',
					input: 'a,b\n\r\n\rc',
					options: skip,
					rows: [['a', 'b']],
					error: { _tag: 'FieldCountMismatch', line: 4, expected: 2, actual: 1 },
				},
			])('$name', check)
		})

		describe('relaxQuotes', () => {
			const relax = { relaxQuotes: true } as const
			it.each<Case>([
				{
					name: 'keeps quotes inside unquoted fields',
					input: 'a"b,c""d"',
					options: relax,
					rows: [['a"b', 'c""d"']],
				},
				{
					name: 'a quote after leading whitespace',
					input: ' "a" ,b',
					options: relax,
					rows: [[' "a" ', 'b']],
				},
				{ name: 'across chunks', input: ['a"', '"b'], options: relax, rows: [['a""b']] },
				{
					name: 'a field that starts with a quote is quoted',
					input: '"a,b",c',
					options: relax,
					rows: [['a,b', 'c']],
				},
				{
					name: 'text after a closing quote still fails',
					input: '"a"b',
					options: relax,
					error: { _tag: 'InvalidQuote', line: 1, fieldIndex: 0 },
				},
				{
					name: 'an unclosed quote still fails',
					input: 'a"\n"b',
					options: relax,
					rows: [['a"']],
					error: { _tag: 'UnclosedQuote', line: 2 },
				},
				{
					name: 'a quote is content for maxRecordSize',
					input: 'ab"',
					options: { relaxQuotes: true, maxRecordSize: 2 },
					error: { _tag: 'RecordTooLarge', line: 1, maxRecordSize: 2 },
				},
				{
					name: 'with trim',
					input: ' a"b ,  "c" ',
					options: { relaxQuotes: true, trim: true },
					rows: [['a"b', 'c']],
				},
			])('$name', check)
		})
	})

	describe('lifecycle', () => {
		it('keeps returning the first error', () => {
			const parser = Parser.make(undefined, () => undefined)
			const error = parser.feed('"a"b')
			assert.strictEqual(error?.reason._tag, 'InvalidQuote')
			assert.strictEqual(parser.feed('c\n'), error)
			assert.strictEqual(parser.end(), error)
		})

		it('emits the last record only once', () => {
			const rows: Array<Csv.Row> = []
			const parser = Parser.make(undefined, (row) => {
				rows.push(row)
				return undefined
			})
			parser.feed('a,b')
			assert.strictEqual(parser.end(), undefined)
			assert.strictEqual(parser.end(), undefined)
			assert.deepStrictEqual(rows, [['a', 'b']])
		})
	})

	describe('option validation', () => {
		const invalid: ReadonlyArray<readonly [string, Csv.DecodeOptions, RegExp]> = [
			['empty delimiter', { delimiter: '' }, /`delimiter` must be one/],
			['long delimiter', { delimiter: ',,' }, /`delimiter` must be one/],
			['astral delimiter', { delimiter: '😀' }, /`delimiter` must be one/],
			['LF delimiter', { delimiter: '\n' }, /`delimiter` must be one/],
			['CR delimiter', { delimiter: '\r' }, /`delimiter` must be one/],
			['empty quote', { quote: '' }, /`quote` must be null or one/],
			['long quote', { quote: '""' }, /`quote` must be null or one/],
			['LF quote', { quote: '\n' }, /`quote` must be null or one/],
			['quote equal to the delimiter', { quote: ',' }, /`quote` must differ/],
			['quote equal to a custom delimiter', { delimiter: ';', quote: ';' }, /`quote` must differ/],
			['empty escape', { escape: '' }, /`escape` must be one/],
			['long escape', { escape: '\\\\' }, /`escape` must be one/],
			['CR escape', { escape: '\r' }, /`escape` must be one/],
			['escape equal to the delimiter', { escape: ',' }, /`escape` must differ/],
			[
				'escape equal to a custom delimiter',
				{ delimiter: ';', escape: ';' },
				/`escape` must differ/,
			],
			['zero maxRecordSize', { maxRecordSize: 0 }, /`maxRecordSize`/],
			['negative maxRecordSize', { maxRecordSize: -1 }, /`maxRecordSize`/],
			['fractional maxRecordSize', { maxRecordSize: 1.5 }, /`maxRecordSize`/],
			['NaN maxRecordSize', { maxRecordSize: Number.NaN }, /`maxRecordSize`/],
			['empty comment', { comment: '' }, /`comment` must be one/],
			['long comment', { comment: '##' }, /`comment` must be one/],
			['LF comment', { comment: '\n' }, /`comment` must be one/],
			// @ts-expect-error JavaScript callers can pass any value
			['null comment', { comment: null }, /`comment` must be one/],
			['comment equal to the delimiter', { comment: ',' }, /`comment` must differ/],
			[
				'comment equal to a custom delimiter',
				{ delimiter: ';', comment: ';' },
				/`comment` must differ/,
			],
			['comment equal to the quote', { comment: '"' }, /`comment` must differ/],
			['comment equal to a custom quote', { quote: "'", comment: "'" }, /`comment` must differ/],
		]

		it.each(invalid)('rejects %s', (_, options, message) => {
			assert.throws(
				() => Parser.make(options, () => undefined),
				Cause.IllegalArgumentError,
				message,
			)
		})

		it.each<readonly [string, Csv.DecodeOptions]>([
			['quote null with an invalid escape', { quote: null, escape: '' }],
			['quote null with the delimiter as escape', { quote: null, delimiter: ';', escape: ';' }],
			['escape equal to the quote', { quote: "'", escape: "'" }],
			['Infinity maxRecordSize', { maxRecordSize: Number.POSITIVE_INFINITY }],
			['comment equal to the escape', { escape: '\\', comment: '\\' }],
			['comment equal to the quote when quoting is disabled', { quote: null, comment: '"' }],
		])('accepts %s', (_, options) => {
			Parser.make(options, () => undefined)
		})
	})
})
