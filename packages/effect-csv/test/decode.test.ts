import { assert, describe, expectTypeOf, it } from '@effect/vitest'
import {
	Array as Arr,
	Cause,
	Channel,
	Context,
	Effect,
	Exit,
	Result,
	Schema,
	SchemaGetter,
	Stream,
} from 'effect'
import * as Csv from '../src/Csv.ts'
import { type ReasonFields, reasonFields } from './utils.ts'

const bytes = (...values: ReadonlyArray<number>) => new Uint8Array(values)

const encodeText = (text: string) => new TextEncoder().encode(text)

const collect = Effect.fnUntraced(function* <A, E>(stream: Stream.Stream<A, E>) {
	const rows: Array<A> = []
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

const assertError = <A, E>(exit: Exit.Exit<A, E>, isError: (u: unknown) => boolean) => {
	assert.isTrue(Exit.isFailure(exit))
	if (Exit.isFailure(exit)) {
		const error = Cause.findError(exit.cause)
		assert.isTrue(Result.isSuccess(error) && isError(error.success), Cause.pretty(exit.cause))
	}
}

const assertCsvError = <A, E>(exit: Exit.Exit<A, E>, expected: ReasonFields) => {
	assertError(exit, Csv.isCsvError)
	if (Exit.isFailure(exit)) {
		const error = Cause.findError(exit.cause)
		if (Result.isSuccess(error) && Csv.isCsvError(error.success)) {
			assert.deepStrictEqual(reasonFields(error.success), expected)
		}
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

	it.effect('decodes a commented, padded file with the dialect options', () =>
		Effect.gen(function* () {
			const rows = yield* Stream.make('# exported 2026-10-19\nname, age\n\nAda , 36\n').pipe(
				Stream.pipeThroughChannel(
					Csv.decodeString({ comment: '#', skipEmptyLines: true, trim: true }),
				),
				Stream.runCollect,
			)
			assert.deepStrictEqual(rows, [
				['name', 'age'],
				['Ada', '36'],
			])
		}),
	)

	it.effect('keeps quotes inside unquoted fields with relaxQuotes', () =>
		Effect.gen(function* () {
			const rows = yield* Stream.make('size,note\n12",a "b"\n').pipe(
				Stream.pipeThroughChannel(Csv.decodeString({ relaxQuotes: true })),
				Stream.runCollect,
			)
			assert.deepStrictEqual(rows, [
				['size', 'note'],
				['12"', 'a "b"'],
			])
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
			for (const options of [{ delimiter: ',,' }, { comment: ',' }]) {
				const exit = yield* Stream.make('a').pipe(
					Stream.pipeThroughChannel(Csv.decodeString(options)),
					Stream.runCollect,
					Effect.exit,
				)
				assertDefect(exit, Cause.isIllegalArgumentError)
			}
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

describe('toObjects', () => {
	const toObjects = (rows: ReadonlyArray<Csv.Row>, options?: Csv.ToObjectsOptions) =>
		collect(Stream.fromIterable(rows).pipe(Stream.pipeThroughChannel(Csv.toObjects(options))))

	it.effect('keys each row by the header row', () =>
		Effect.gen(function* () {
			const { rows, exit } = yield* toObjects([
				['name', 'age'],
				['Ada', '36'],
				['Alan', '41'],
			])
			assert.deepStrictEqual(exit, Exit.void)
			assert.deepStrictEqual(rows, [
				{ name: 'Ada', age: '36' },
				{ name: 'Alan', age: '41' },
			])
		}),
	)

	it.effect('orders the keys of each object by column', () =>
		Effect.gen(function* () {
			const { rows } = yield* toObjects([
				['b', 'a', 'c'],
				['1', '2', '3'],
			])
			assert.deepStrictEqual(rows.map(Object.keys), [['b', 'a', 'c']])
		}),
	)

	it.effect('emits nothing for a header without rows or for no rows', () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* toObjects([['a', 'b']])).rows, [])
			assert.deepStrictEqual((yield* toObjects([])).rows, [])
		}),
	)

	it.effect('emits the objects of each upstream pull as one batch', () =>
		Effect.gen(function* () {
			const batches = yield* Stream.fromArrays(
				[['a', 'b']],
				[
					['1', '2'],
					['3', '4'],
				],
				[['5', '6']],
			).pipe(Stream.pipeThroughChannel(Csv.toObjects()), Stream.chunks, Stream.runCollect)
			assert.deepStrictEqual(batches, [
				[
					{ a: '1', b: '2' },
					{ a: '3', b: '4' },
				],
				[{ a: '5', b: '6' }],
			])
		}),
	)

	it.effect('uses explicit columns without consuming a row', () =>
		Effect.gen(function* () {
			const { rows } = yield* toObjects(
				[
					['1', '2'],
					['3', '4'],
				],
				{ columns: ['x', 'y'] },
			)
			assert.deepStrictEqual(rows, [
				{ x: '1', y: '2' },
				{ x: '3', y: '4' },
			])
		}),
	)

	it.effect('replaces a header row that is dropped first', () =>
		Effect.gen(function* () {
			const rows = yield* Stream.make('a,b\n1,2\n').pipe(
				Stream.pipeThroughChannel(Csv.decodeString()),
				Stream.drop(1),
				Stream.pipeThroughChannel(Csv.toObjects({ columns: ['x', 'y'] })),
				Stream.runCollect,
			)
			assert.deepStrictEqual(rows, [{ x: '1', y: '2' }])
		}),
	)

	it.effect('emits the objects before a row with a different number of fields, then fails', () =>
		Effect.gen(function* () {
			const { rows, exit } = yield* toObjects([['a', 'b'], ['1', '2'], ['3']])
			assert.deepStrictEqual(rows, [{ a: '1', b: '2' }])
			assertCsvError(exit, { _tag: 'FieldCountMismatch', line: 3, expected: 2, actual: 1 })
		}),
	)

	it.effect('counts line breaks inside fields in the line of a failing row', () =>
		Effect.gen(function* () {
			const { rows, exit } = yield* toObjects([
				['a', 'b'],
				['x\r\ny', '1'],
				['\np\rq\n', '2'],
				['3'],
			])
			assert.strictEqual(rows.length, 2)
			assertCsvError(exit, { _tag: 'FieldCountMismatch', line: 8, expected: 2, actual: 1 })
		}),
	)

	it.effect('reports the input line of rows decoded with relaxColumnCount', () =>
		Effect.gen(function* () {
			const input = 'a,b\n"x\r\ny",1\r\n2'
			const { exit } = yield* collect(
				Stream.make(input).pipe(
					Stream.pipeThroughChannel(Csv.decodeString({ relaxColumnCount: true })),
					Stream.pipeThroughChannel(Csv.toObjects()),
				),
			)
			const expected = yield* Effect.flip(Csv.parse(input))
			assertCsvError(exit, reasonFields(expected))
			assert.deepStrictEqual(reasonFields(expected), {
				_tag: 'FieldCountMismatch',
				line: 4,
				expected: 2,
				actual: 1,
			})
		}),
	)

	it.effect('counts lines from the rows it receives, not lines skipped before them', () =>
		Effect.gen(function* () {
			const { exit } = yield* collect(
				Stream.make('# note\n\na,a\n').pipe(
					Stream.pipeThroughChannel(Csv.decodeString({ comment: '#', skipEmptyLines: true })),
					Stream.pipeThroughChannel(Csv.toObjects()),
				),
			)
			assertCsvError(exit, {
				_tag: 'InvalidHeader',
				line: 1,
				fieldIndex: 1,
				name: 'a',
				problem: 'Duplicate',
			})
		}),
	)

	it.effect('fails when the rows do not match explicit columns', () =>
		Effect.gen(function* () {
			const { rows, exit } = yield* toObjects([['1', '2', '3']], { columns: ['a', 'b'] })
			assert.deepStrictEqual(rows, [])
			assertCsvError(exit, { _tag: 'FieldCountMismatch', line: 1, expected: 2, actual: 3 })
		}),
	)

	it.effect('omits missing keys and drops extra fields with relaxColumnCount', () =>
		Effect.gen(function* () {
			const { rows, exit } = yield* toObjects(
				[['a', 'b', 'c'], ['1'], ['1', '2', '3', '4'], ['1', '2']],
				{ relaxColumnCount: true },
			)
			assert.deepStrictEqual(exit, Exit.void)
			assert.deepStrictEqual(rows, [{ a: '1' }, { a: '1', b: '2', c: '3' }, { a: '1', b: '2' }])
		}),
	)

	it.effect('fails with InvalidHeader for an empty column name', () =>
		Effect.gen(function* () {
			const { rows, exit } = yield* toObjects([
				['a', '', 'c'],
				['1', '2', '3'],
			])
			assert.deepStrictEqual(rows, [])
			assertCsvError(exit, {
				_tag: 'InvalidHeader',
				line: 1,
				fieldIndex: 1,
				name: '',
				problem: 'Empty',
			})
		}),
	)

	it.effect('fails with InvalidHeader for a repeated column name', () =>
		Effect.gen(function* () {
			const { exit } = yield* toObjects([['a', 'b', 'a']], { relaxColumnCount: true })
			assertCsvError(exit, {
				_tag: 'InvalidHeader',
				line: 1,
				fieldIndex: 2,
				name: 'a',
				problem: 'Duplicate',
			})
		}),
	)

	it.effect('creates a __proto__ key as an own property', () =>
		Effect.gen(function* () {
			const { rows } = yield* toObjects([
				['__proto__', 'a'],
				['x', 'y'],
			])
			const [record] = rows
			assert.deepStrictEqual(Object.keys(record), ['__proto__', 'a'])
			assert.strictEqual(Object.getOwnPropertyDescriptor(record, '__proto__')?.value, 'x')
			assert.strictEqual(Object.getPrototypeOf(record), Object.prototype)
		}),
	)

	it.effect('propagates upstream failures after the objects converted so far', () =>
		Effect.gen(function* () {
			const { rows, exit } = yield* collect(
				Stream.concat(Stream.make(['a'], ['1']), Stream.fail('boom' as const)).pipe(
					Stream.pipeThroughChannel(Csv.toObjects()),
				),
			)
			assert.deepStrictEqual(rows, [{ a: '1' }])
			assert.deepStrictEqual(exit, Exit.fail('boom'))
		}),
	)

	it.effect('propagates the upstream done value', () =>
		Effect.gen(function* () {
			const upstream = Channel.fromIterable(
				(function* () {
					yield Arr.of<Csv.Row>(['a'])
					yield Arr.of<Csv.Row>(['1'])
					return 'finished' as const
				})(),
			)
			const records: Array<Readonly<Record<string, string>>> = []
			const done = yield* Channel.pipeTo(upstream, Csv.toObjects()).pipe(
				Channel.runForEach((batch) =>
					Effect.sync(() => {
						records.push(...batch)
					}),
				),
			)
			assert.strictEqual(done, 'finished')
			assert.deepStrictEqual(records, [{ a: '1' }])
		}),
	)

	it.effect('dies when it starts with invalid columns', () =>
		Effect.gen(function* () {
			const channels = [
				Csv.toObjects({ columns: [] }),
				Csv.toObjects({ columns: ['a', ''] }),
				Csv.toObjects({ columns: ['a', 'b', 'a'] }),
				// @ts-expect-error JavaScript callers can pass any value
				Csv.toObjects({ columns: 'none' }),
			]
			for (const channel of channels) {
				const exit = yield* Stream.make(['1']).pipe(
					Stream.pipeThroughChannel(channel),
					Stream.runCollect,
					Effect.exit,
				)
				assertDefect(exit, Cause.isIllegalArgumentError)
			}
		}),
	)
})

describe('decodeSchemaString', () => {
	const Person = Schema.Struct({ name: Schema.String, age: Schema.FiniteFromString })
	const Point = Schema.Tuple([Schema.FiniteFromString, Schema.FiniteFromString])

	it.effect('decodes objects keyed by the header row', () =>
		Effect.gen(function* () {
			const people = yield* Stream.make('name,age\r\nAda,', '36\r\n"Turing, Alan",41').pipe(
				Stream.pipeThroughChannel(Csv.decodeSchemaString(Person)()),
				Stream.runCollect,
			)
			assert.deepStrictEqual(people, [
				{ name: 'Ada', age: 36 },
				{ name: 'Turing, Alan', age: 41 },
			])
		}),
	)

	it.effect('decodes objects keyed by explicit columns', () =>
		Effect.gen(function* () {
			const people = yield* Stream.make('Ada;36\n').pipe(
				Stream.pipeThroughChannel(
					Csv.decodeSchemaString(Person)({ columns: ['name', 'age'], delimiter: ';' }),
				),
				Stream.runCollect,
			)
			assert.deepStrictEqual(people, [{ name: 'Ada', age: 36 }])
		}),
	)

	it.effect('decodes missing fields as missing keys with relaxColumnCount', () =>
		Effect.gen(function* () {
			const Entry = Schema.Struct({ key: Schema.String, note: Schema.optionalKey(Schema.String) })
			const entries = yield* Stream.make('key,note\na\nb,c\n').pipe(
				Stream.pipeThroughChannel(Csv.decodeSchemaString(Entry)({ relaxColumnCount: true })),
				Stream.runCollect,
			)
			assert.deepStrictEqual(entries, [{ key: 'a' }, { key: 'b', note: 'c' }])
		}),
	)

	it.effect('decodes raw rows with columns "none"', () =>
		Effect.gen(function* () {
			const points = yield* Stream.make('1,2\n3,4\n').pipe(
				Stream.pipeThroughChannel(Csv.decodeSchemaString(Point)({ columns: 'none' })),
				Stream.runCollect,
			)
			assert.deepStrictEqual(points, [
				[1, 2],
				[3, 4],
			])
		}),
	)

	it.effect('fails with a SchemaError for a value that does not match the schema', () =>
		Effect.gen(function* () {
			const objects = yield* collect(
				Stream.fromArrays(['name,age\nAda,36\n'], ['Alan,41\nBob,x\n']).pipe(
					Stream.pipeThroughChannel(Csv.decodeSchemaString(Person)()),
				),
			)
			assert.deepStrictEqual(objects.rows, [{ name: 'Ada', age: 36 }])
			assertError(objects.exit, Schema.isSchemaError)
			const rows = yield* collect(
				Stream.make('1,2,3\n').pipe(
					Stream.pipeThroughChannel(Csv.decodeSchemaString(Point)({ columns: 'none' })),
				),
			)
			assertError(rows.exit, Schema.isSchemaError)
		}),
	)

	it.effect('fails with a CsvError for malformed input or an invalid header', () =>
		Effect.gen(function* () {
			const malformed = yield* collect(
				Stream.make('name,age\nAda,36\n"Alan').pipe(
					Stream.pipeThroughChannel(Csv.decodeSchemaString(Person)()),
				),
			)
			assert.deepStrictEqual(malformed.rows, [{ name: 'Ada', age: 36 }])
			assertCsvError(malformed.exit, { _tag: 'UnclosedQuote', line: 3 })

			const header = yield* collect(
				Stream.make('name,name\n').pipe(
					Stream.pipeThroughChannel(Csv.decodeSchemaString(Person)()),
				),
			)
			assertCsvError(header.exit, {
				_tag: 'InvalidHeader',
				line: 1,
				fieldIndex: 1,
				name: 'name',
				problem: 'Duplicate',
			})
		}),
	)

	it.effect('reports the input line after skipped comment and empty lines', () =>
		Effect.gen(function* () {
			const options = { comment: '#', skipEmptyLines: true } as const
			const header = yield* collect(
				Stream.make('# note\n\nname,name\n').pipe(
					Stream.pipeThroughChannel(Csv.decodeSchemaString(Person)(options)),
				),
			)
			assertCsvError(header.exit, {
				_tag: 'InvalidHeader',
				line: 3,
				fieldIndex: 1,
				name: 'name',
				problem: 'Duplicate',
			})

			const columns = yield* collect(
				Stream.make('# note\n\nAda,36\n').pipe(
					Stream.pipeThroughChannel(
						Csv.decodeSchemaString(Person)({ ...options, columns: ['name', 'age', 'note'] }),
					),
				),
			)
			assertCsvError(columns.exit, {
				_tag: 'FieldCountMismatch',
				line: 3,
				expected: 3,
				actual: 2,
			})
		}),
	)

	it.effect('fails with the first error in input order', () =>
		Effect.gen(function* () {
			const { rows, exit } = yield* collect(
				Stream.make('Ada,36\n"Bob').pipe(
					Stream.pipeThroughChannel(
						Csv.decodeSchemaString(Person)({ columns: ['name', 'age', 'note'] }),
					),
				),
			)
			assert.deepStrictEqual(rows, [])
			assertCsvError(exit, { _tag: 'FieldCountMismatch', line: 1, expected: 3, actual: 2 })
		}),
	)

	it.effect('decodes raw rows with comments and columns "none"', () =>
		Effect.gen(function* () {
			const points = yield* Stream.make('# x,y\n1, 2\n').pipe(
				Stream.pipeThroughChannel(
					Csv.decodeSchemaString(Point)({ columns: 'none', comment: '#', trim: true }),
				),
				Stream.runCollect,
			)
			assert.deepStrictEqual(points, [[1, 2]])
		}),
	)

	it.effect('provides the decoding services of the schema', () =>
		Effect.gen(function* () {
			class Scale extends Context.Service<Scale, number>()('effect-csv/test/decode.test/Scale') {}
			const Scaled = Schema.FiniteFromString.pipe(
				Schema.decode({
					decode: SchemaGetter.transformEffect((n: number) =>
						Effect.map(Effect.service(Scale), (scale) => n * scale),
					),
					encode: SchemaGetter.passthrough(),
				}),
			)
			const values = yield* Stream.make('value\n2\n').pipe(
				Stream.pipeThroughChannel(Csv.decodeSchemaString(Schema.Struct({ value: Scaled }))()),
				Stream.runCollect,
				Effect.provideService(Scale, 10),
			)
			assert.deepStrictEqual(values, [{ value: 20 }])
		}),
	)

	it('selects the columns option from the encoded type of the schema', () => {
		expectTypeOf(Csv.decodeSchemaString(Person)()).toEqualTypeOf<
			Channel.Channel<
				Arr.NonEmptyReadonlyArray<{ readonly name: string; readonly age: number }>,
				Csv.CsvError | Schema.SchemaError,
				unknown,
				Arr.NonEmptyReadonlyArray<string>,
				never,
				unknown,
				never
			>
		>()
		expectTypeOf(Csv.decodeSchemaString(Point)({ columns: 'none' })).toEqualTypeOf<
			Channel.Channel<
				Arr.NonEmptyReadonlyArray<readonly [number, number]>,
				Csv.CsvError | Schema.SchemaError,
				unknown,
				Arr.NonEmptyReadonlyArray<string>,
				never,
				unknown,
				never
			>
		>()
		// @ts-expect-error a schema of rows requires `columns: "none"`
		Csv.decodeSchemaString(Point)()
		// @ts-expect-error a schema of rows cannot decode objects
		Csv.decodeSchemaString(Point)({ columns: 'header' })
		// @ts-expect-error a schema of objects cannot decode raw rows
		Csv.decodeSchemaString(Person)({ columns: 'none' })
	})
})

describe('decodeSchema', () => {
	const Person = Schema.Struct({ name: Schema.String, age: Schema.FiniteFromString })

	it.effect('decodes bytes into values of a schema', () =>
		Effect.gen(function* () {
			const people = yield* Stream.make(encodeText('name,age\nAda,36\n')).pipe(
				Stream.pipeThroughChannel(Csv.decodeSchema(Person)()),
				Stream.runCollect,
			)
			assert.deepStrictEqual(people, [{ name: 'Ada', age: 36 }])
		}),
	)

	it.effect('passes the decode options to the decoder', () =>
		Effect.gen(function* () {
			const people = yield* Stream.make(bytes(0xff, 0xfe, 0x41, 0x00, 0x09, 0x00, 0x37, 0x00)).pipe(
				Stream.pipeThroughChannel(
					Csv.decodeSchema(Person)({
						encoding: 'utf-16le',
						delimiter: '\t',
						columns: ['name', 'age'],
					}),
				),
				Stream.runCollect,
			)
			assert.deepStrictEqual(people, [{ name: 'A', age: 7 }])
		}),
	)

	it.effect('reports the input line of bytes after skipped lines', () =>
		Effect.gen(function* () {
			const { exit } = yield* collect(
				Stream.make(encodeText('\uFEFF# note\r\n\r\nname,\r\n')).pipe(
					Stream.pipeThroughChannel(
						Csv.decodeSchema(Person)({ comment: '#', skipEmptyLines: true }),
					),
				),
			)
			assertCsvError(exit, {
				_tag: 'InvalidHeader',
				line: 3,
				fieldIndex: 1,
				name: '',
				problem: 'Empty',
			})
		}),
	)

	it.effect('decodes raw rows with columns "none"', () =>
		Effect.gen(function* () {
			const Point = Schema.Tuple([Schema.String, Schema.FiniteFromString])
			const points = yield* Stream.make(encodeText('a,1\n'), encodeText('b,2')).pipe(
				Stream.pipeThroughChannel(Csv.decodeSchema(Point)({ columns: 'none' })),
				Stream.runCollect,
			)
			assert.deepStrictEqual(points, [
				['a', 1],
				['b', 2],
			])
		}),
	)

	it.effect('dies when it starts with invalid options', () =>
		Effect.gen(function* () {
			for (const options of [{ delimiter: '' }, { columns: [] }, { comment: '"' }]) {
				const exit = yield* Stream.make(encodeText('a')).pipe(
					Stream.pipeThroughChannel(Csv.decodeSchema(Person)(options)),
					Stream.runCollect,
					Effect.exit,
				)
				assertDefect(exit, Cause.isIllegalArgumentError)
			}
		}),
	)

	it('selects the columns option from the encoded type of the schema', () => {
		expectTypeOf(Csv.decodeSchema(Person)()).toEqualTypeOf<
			Channel.Channel<
				Arr.NonEmptyReadonlyArray<{ readonly name: string; readonly age: number }>,
				Csv.CsvError | Schema.SchemaError,
				unknown,
				Arr.NonEmptyReadonlyArray<Uint8Array>,
				never,
				unknown,
				never
			>
		>()
		// @ts-expect-error a schema of rows requires `columns: "none"`
		Csv.decodeSchema(Schema.Tuple([Schema.String]))()
		// @ts-expect-error a schema of objects cannot decode raw rows
		Csv.decodeSchema(Person)({ columns: 'none' })
	})
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

	it.effect('parses with the dialect options', () =>
		Effect.gen(function* () {
			const rows = yield* Csv.parse(';a\n\n "b" , c"d \n', {
				comment: ';',
				skipEmptyLines: true,
				trim: true,
				relaxQuotes: true,
			})
			assert.deepStrictEqual(rows, [['b', 'c"d']])
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
			new Csv.InvalidHeader({ line: 1, fieldIndex: 2, name: '', problem: 'Empty' }),
			new Csv.InvalidHeader({ line: 1, fieldIndex: 3, name: 'id', problem: 'Duplicate' }),
		].map((reason) => new Csv.CsvError({ reason }).message)
		assert.deepStrictEqual(messages, [
			'Unclosed quote in the record starting on line 4',
			'Invalid quote in field 1 of the record starting on line 2',
			'Expected 2 fields but found 1 in the record starting on line 3',
			'The record starting on line 1 exceeds the maximum size of 10 UTF-16 code units',
			'Empty column name in field 2 of the header on line 1',
			'Duplicate column name "id" in field 3 of the header on line 1',
		])
	})
})
