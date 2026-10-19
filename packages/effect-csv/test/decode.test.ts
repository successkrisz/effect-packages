import { assert, describe, it } from '@effect/vitest'
import { Array as Arr, Cause, Channel, Effect, Exit, Result, Stream } from 'effect'
import * as Csv from '../src/Csv.ts'
import { reasonFields } from './utils.ts'

const bytes = (...values: ReadonlyArray<number>) => new Uint8Array(values)

const collect = Effect.fnUntraced(function* <E>(stream: Stream.Stream<Csv.Row, E>) {
	const rows: Array<Csv.Row> = []
	const exit = yield* stream.pipe(
		Stream.runForEach((row) =>
			Effect.sync(() => {
				rows.push(row)
			}),
		),
		Effect.exit,
	)
	return { rows, exit }
})

const assertDefect = <A, E>(exit: Exit.Exit<A, E>, isDefect: (u: unknown) => boolean) => {
	assert.isTrue(Exit.isFailure(exit))
	if (Exit.isFailure(exit)) {
		const defect = Cause.findDefect(exit.cause)
		assert.isTrue(Result.isSuccess(defect) && isDefect(defect.success))
	}
}

describe('decodeString', () => {
	it.effect('decodes records that span chunks', () =>
		Effect.gen(function* () {
			const rows = yield* Stream.make('a,"b', '\r\n', 'c"\r', '\nd,e').pipe(
				Stream.pipeThroughChannel(Csv.decodeString()),
				Stream.runCollect,
			)
			assert.deepStrictEqual(rows, [
				['a', 'b\r\nc'],
				['d', 'e'],
			])
		}),
	)

	it.effect('emits the rows of each upstream pull as one batch', () =>
		Effect.gen(function* () {
			const batches = yield* Stream.fromArrays(['a\nb\n'], ['c'], ['\nd']).pipe(
				Stream.pipeThroughChannel(Csv.decodeString()),
				Stream.chunks,
				Stream.runCollect,
			)
			assert.deepStrictEqual(batches, [[['a'], ['b']], [['c']], [['d']]])
		}),
	)

	it.effect('emits nothing for empty input', () =>
		Effect.gen(function* () {
			const rows = yield* Stream.make('', '').pipe(
				Stream.pipeThroughChannel(Csv.decodeString()),
				Stream.runCollect,
			)
			assert.deepStrictEqual(rows, [])
		}),
	)

	it.effect('emits the rows before malformed input, then fails', () =>
		Effect.gen(function* () {
			const { rows, exit } = yield* collect(
				Stream.fromArrays(['a\nb\n"c']).pipe(Stream.pipeThroughChannel(Csv.decodeString())),
			)
			assert.deepStrictEqual(rows, [['a'], ['b']])
			assert.isTrue(Exit.isFailure(exit))
			if (Exit.isFailure(exit)) {
				const error = Cause.findError(exit.cause)
				assert.isTrue(Result.isSuccess(error))
				if (Result.isSuccess(error)) {
					assert.deepStrictEqual(reasonFields(error.success), { _tag: 'UnclosedQuote', line: 3 })
				}
			}
		}),
	)

	it.effect('propagates upstream failures after the rows decoded so far', () =>
		Effect.gen(function* () {
			const { rows, exit } = yield* collect(
				Stream.concat(Stream.make('a\nb'), Stream.fail('boom' as const)).pipe(
					Stream.pipeThroughChannel(Csv.decodeString()),
				),
			)
			assert.deepStrictEqual(rows, [['a']])
			assert.deepStrictEqual(exit, Exit.fail('boom'))
		}),
	)

	it.effect('propagates the upstream done value after the last record', () =>
		Effect.gen(function* () {
			const upstream = Channel.fromIterable(
				(function* () {
					yield Arr.of('a,b\n')
					yield Arr.of('c,d')
					return 'finished' as const
				})(),
			)
			const rows: Array<Csv.Row> = []
			const done = yield* Channel.pipeTo(upstream, Csv.decodeString()).pipe(
				Channel.runForEach((batch) =>
					Effect.sync(() => {
						rows.push(...batch)
					}),
				),
			)
			assert.strictEqual(done, 'finished')
			assert.deepStrictEqual(rows, [
				['a', 'b'],
				['c', 'd'],
			])
		}),
	)

	it.effect('dies when it starts with invalid options', () =>
		Effect.gen(function* () {
			const channel = Csv.decodeString({ delimiter: ',,' })
			const exit = yield* Stream.make('a').pipe(
				Stream.pipeThroughChannel(channel),
				Stream.runCollect,
				Effect.exit,
			)
			assertDefect(exit, Cause.isIllegalArgumentError)
		}),
	)
})

describe('decode', () => {
	const decodeBytes = (chunks: ReadonlyArray<Uint8Array>, options?: Csv.DecodeBytesOptions) =>
		Stream.fromIterable(chunks).pipe(
			Stream.rechunk(1),
			Stream.pipeThroughChannel(Csv.decode(options)),
			Stream.runCollect,
		)

	it.effect('decodes UTF-8 characters split across chunks', () =>
		Effect.gen(function* () {
			const rows = yield* decodeBytes([
				bytes(0x61, 0xc3),
				bytes(0xa9, 0x2c, 0xf0),
				bytes(0x9f),
				bytes(0x98),
				bytes(0x80, 0x0a),
			])
			assert.deepStrictEqual(rows, [['aé', '😀']])
		}),
	)

	it.effect('removes a byte-order mark split across chunks', () =>
		Effect.gen(function* () {
			const rows = yield* decodeBytes([bytes(0xef, 0xbb), bytes(0xbf, 0x61)])
			assert.deepStrictEqual(rows, [['a']])
		}),
	)

	it.effect('removes only one byte-order mark', () =>
		Effect.gen(function* () {
			const rows = yield* decodeBytes([bytes(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61)])
			assert.deepStrictEqual(rows, [['\uFEFFa']])
		}),
	)

	it.effect('decodes other encodings', () =>
		Effect.gen(function* () {
			const utf16 = yield* decodeBytes(
				[bytes(0xff, 0xfe, 0x61, 0x00, 0x2c), bytes(0x00, 0x62, 0x00)],
				{ encoding: 'utf-16le' },
			)
			assert.deepStrictEqual(utf16, [['a', 'b']])
			const latin1 = yield* decodeBytes([bytes(0xe9, 0x3b, 0x78)], {
				encoding: 'windows-1252',
				delimiter: ';',
			})
			assert.deepStrictEqual(latin1, [['é', 'x']])
		}),
	)

	it.effect('dies with an unsupported encoding', () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(decodeBytes([bytes(0x61)], { encoding: 'not-an-encoding' }))
			assertDefect(exit, (u) => u instanceof RangeError)
		}),
	)

	it.effect('dies with invalid options', () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(decodeBytes([bytes(0x61)], { quote: ',' }))
			assertDefect(exit, Cause.isIllegalArgumentError)
		}),
	)
})

describe('parse', () => {
	it.effect('parses a string', () =>
		Effect.gen(function* () {
			const rows = yield* Csv.parse('name,age\r\n"Doe, Jane",36\r\n')
			assert.deepStrictEqual(rows, [
				['name', 'age'],
				['Doe, Jane', '36'],
			])
		}),
	)

	it.effect('fails with a CsvError', () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(Csv.parse('a,b\nc'))
			assert.deepStrictEqual(reasonFields(error), {
				_tag: 'FieldCountMismatch',
				line: 2,
				expected: 2,
				actual: 1,
			})
		}),
	)

	it.effect('dies with invalid options when it runs', () =>
		Effect.gen(function* () {
			const parse = Csv.parse('a', { maxRecordSize: 0 })
			const exit = yield* Effect.exit(parse)
			assertDefect(exit, Cause.isIllegalArgumentError)
		}),
	)
})

describe('CsvError', () => {
	const unclosed = new Csv.CsvError({ reason: new Csv.UnclosedQuote({ line: 4 }) })

	it.effect('can be handled by reason', () =>
		Effect.gen(function* () {
			const line = yield* Csv.parse('a\n"b').pipe(
				Effect.as(0),
				Effect.catchReason('CsvError', 'UnclosedQuote', (reason) => Effect.succeed(reason.line)),
			)
			assert.strictEqual(line, 2)

			const rows = yield* Stream.make('a\n"b').pipe(
				Stream.pipeThroughChannel(Csv.decodeString()),
				Stream.catchReason('CsvError', 'UnclosedQuote', (reason) =>
					Stream.succeed([`line ${reason.line}`]),
				),
				Stream.runCollect,
			)
			assert.deepStrictEqual(rows, [['a'], ['line 2']])
		}),
	)

	it('is recognized by isCsvError', () => {
		assert.isTrue(Csv.isCsvError(unclosed))
		assert.isFalse(Csv.isCsvError(unclosed.reason))
		assert.isFalse(Csv.isCsvError(new Error('CsvError')))
		assert.isFalse(Csv.isCsvError(null))
	})

	it('uses the message of its reason', () => {
		const messages = [
			new Csv.UnclosedQuote({ line: 4 }),
			new Csv.InvalidQuote({ line: 2, fieldIndex: 1 }),
			new Csv.FieldCountMismatch({ line: 3, expected: 2, actual: 1 }),
			new Csv.RecordTooLarge({ line: 1, maxRecordSize: 10 }),
		].map((reason) => new Csv.CsvError({ reason }).message)
		assert.deepStrictEqual(messages, [
			'Unclosed quote in the record starting on line 4',
			'Invalid quote in field 1 of the record starting on line 2',
			'Expected 2 fields but found 1 in the record starting on line 3',
			'The record starting on line 1 exceeds the maximum size of 10 UTF-16 code units',
		])
	})
})
