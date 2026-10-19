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

const collect = Effect.fnUntraced(function* <A, E>(stream: Stream.Stream<A, E>) {
	const values: Array<A> = []
	const exit = yield* stream.pipe(
		Stream.runForEach((value) =>
			Effect.sync(() => {
				values.push(value)
			}),
		),
		Effect.exit,
	)
	return { values, exit }
})

const assertDefect = <A, E>(exit: Exit.Exit<A, E>, isDefect: (u: unknown) => boolean) => {
	assert.isTrue(Exit.isFailure(exit))
	if (Exit.isFailure(exit)) {
		const defect = Cause.findDefect(exit.cause)
		assert.isTrue(Result.isSuccess(defect) && isDefect(defect.success), Cause.pretty(exit.cause))
	}
}

const concatBytes = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
	const out = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0))
	let offset = 0
	for (const chunk of chunks) {
		out.set(chunk, offset)
		offset += chunk.length
	}
	return out
}

const encodeRows = (rows: ReadonlyArray<Csv.Row>, options?: Csv.EncodeOptions) =>
	Stream.fromIterable(rows).pipe(
		Stream.pipeThroughChannel(Csv.encodeString(options)),
		Stream.mkString,
	)

describe('encodeString', () => {
	it.effect('encodes each upstream chunk of rows as one string', () =>
		Effect.gen(function* () {
			const chunks = yield* Stream.fromArrays(
				[
					['a', 'b'],
					['c', 'd'],
				],
				[['e', 'f']],
			).pipe(Stream.pipeThroughChannel(Csv.encodeString()), Stream.runCollect)
			assert.deepStrictEqual(chunks, ['a,b\r\nc,d\r\n', 'e,f\r\n'])
		}),
	)

	it.effect('quotes fields that contain the delimiter, the quote or a line break', () =>
		Effect.gen(function* () {
			const text = yield* encodeRows([['a,b', 'say "hi"', 'x\ny', 'x\rz', 'x\r\nz', 'plain', '']])
			assert.strictEqual(text, '"a,b","say ""hi""","x\ny","x\rz","x\r\nz",plain,\r\n')
		}),
	)

	it.effect('quotes a lone empty field, so that its record is not a blank line', () =>
		Effect.gen(function* () {
			const text = yield* encodeRows([[''], ['', ''], []])
			assert.strictEqual(text, '""\r\n,\r\n\r\n')
			assert.deepStrictEqual(yield* Csv.parse(text, { relaxColumnCount: true }), [
				[''],
				['', ''],
				[''],
			])
		}),
	)

	it.effect('quotes a field that starts with U+FEFF, so that decoding keeps it', () =>
		Effect.gen(function* () {
			const rows = [['\uFEFFa', 'b\uFEFF']]
			const text = yield* encodeRows(rows)
			assert.strictEqual(text, '"\uFEFFa",b\uFEFF\r\n')
			assert.deepStrictEqual(yield* Csv.parse(text), rows)
		}),
	)

	it.effect('quotes every field with quoteMode "all"', () =>
		Effect.gen(function* () {
			const text = yield* encodeRows(
				[
					['a', ''],
					['"', 'b'],
				],
				{ quoteMode: 'all' },
			)
			assert.strictEqual(text, '"a",""\r\n"""","b"\r\n')
		}),
	)

	it.effect('ends every record with recordDelimiter', () =>
		Effect.gen(function* () {
			const text = yield* encodeRows([['a'], ['b']], { recordDelimiter: '\n' })
			assert.strictEqual(text, 'a\nb\n')
		}),
	)

	it.effect('writes the dialect that decodes the output', () =>
		Effect.gen(function* () {
			const options = { delimiter: ';', quote: "'", escape: '\\' } as const
			const rows = [["it's", 'a\\b', 'c;d\\', 'e"f']]
			const text = yield* encodeRows(rows, options)
			assert.strictEqual(text, "'it\\'s';a\\b;'c;d\\\\';e\"f\r\n")
			assert.deepStrictEqual(yield* Csv.parse(text, options), rows)
		}),
	)

	it.effect('escapes with characters that are special in replacement strings', () =>
		Effect.gen(function* () {
			const rows = [['a$b', 'c,d', '$&']]
			const text = yield* encodeRows(rows, { quote: '$' })
			assert.strictEqual(text, '$a$$b$,$c,d$,$$$&$\r\n')
			assert.deepStrictEqual(yield* Csv.parse(text, { quote: '$' }), rows)
		}),
	)

	it.effect('starts the first chunk with U+FEFF with bom', () =>
		Effect.gen(function* () {
			const chunks = yield* Stream.fromArrays([['a']], [['b']]).pipe(
				Stream.pipeThroughChannel(Csv.encodeString({ bom: true })),
				Stream.runCollect,
			)
			assert.deepStrictEqual(chunks, ['\uFEFFa\r\n', 'b\r\n'])
		}),
	)

	it.effect('emits nothing without rows, even with bom', () =>
		Effect.gen(function* () {
			const chunks = yield* Stream.empty.pipe(
				Stream.pipeThroughChannel(Csv.encodeString({ bom: true })),
				Stream.runCollect,
			)
			assert.deepStrictEqual(chunks, [])
		}),
	)

	it.effect('prefixes fields that start a formula with escapeFormulae', () =>
		Effect.gen(function* () {
			const text = yield* encodeRows(
				[['=1+2', '+1', '-1', '@A1', '\tx', '\rx', '\nx', '＝1', '＋1', '－1', '＠x', 'a=1', '']],
				{ escapeFormulae: true },
			)
			assert.strictEqual(
				text,
				"'=1+2,'+1,'-1,'@A1,'\tx,\"'\rx\",\"'\nx\",'＝1,'＋1,'－1,'＠x,a=1,\r\n",
			)
		}),
	)

	it.effect('matches the escaped output of the OWASP examples', () =>
		Effect.gen(function* () {
			const text = yield* encodeRows([['=1+2";=1+2'], ['=1+2\'" ;,=1+2']], {
				escapeFormulae: true,
				recordDelimiter: '\n',
			})
			assert.strictEqual(text, '"\'=1+2"";=1+2"\n"\'=1+2\'"" ;,=1+2"\n')
		}),
	)

	it.effect('writes formulae as they are by default', () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* encodeRows([['=1+2', '@A1']]), '=1+2,@A1\r\n')
		}),
	)

	it.effect('propagates upstream failures after the rows encoded so far', () =>
		Effect.gen(function* () {
			const { values, exit } = yield* collect(
				Stream.concat(Stream.make(['a']), Stream.fail('boom' as const)).pipe(
					Stream.pipeThroughChannel(Csv.encodeString()),
				),
			)
			assert.deepStrictEqual(values, ['a\r\n'])
			assert.deepStrictEqual(exit, Exit.fail('boom'))
		}),
	)

	it.effect('propagates the upstream done value', () =>
		Effect.gen(function* () {
			const upstream = Channel.fromIterable(
				(function* () {
					yield Arr.of<Csv.Row>(['a', 'b'])
					return 'finished' as const
				})(),
			)
			const chunks: Array<string> = []
			const done = yield* Channel.pipeTo(upstream, Csv.encodeString()).pipe(
				Channel.runForEach((batch) =>
					Effect.sync(() => {
						chunks.push(...batch)
					}),
				),
			)
			assert.strictEqual(done, 'finished')
			assert.deepStrictEqual(chunks, ['a,b\r\n'])
		}),
	)

	it.effect('dies when it starts with invalid options', () =>
		Effect.gen(function* () {
			const invalid: ReadonlyArray<Csv.EncodeOptions> = [
				{ delimiter: '' },
				{ quote: ',' },
				// @ts-expect-error JavaScript callers can pass any value
				{ quoteMode: 'minimal' },
			]
			for (const options of invalid) {
				const exit = yield* Effect.exit(encodeRows([['a']], options))
				assertDefect(exit, Cause.isIllegalArgumentError)
			}
		}),
	)
})

describe('encode', () => {
	const encodeBytes = (rows: ReadonlyArray<Csv.Row>, options?: Csv.EncodeOptions) =>
		Stream.fromIterable(rows).pipe(
			Stream.pipeThroughChannel(Csv.encode(options)),
			Stream.runCollect,
			Effect.map(concatBytes),
		)

	it.effect('encodes rows as UTF-8', () =>
		Effect.gen(function* () {
			const bytes = yield* encodeBytes([['é', '😀']])
			assert.deepStrictEqual(bytes, new TextEncoder().encode('é,😀\r\n'))
		}),
	)

	it.effect('starts with the UTF-8 byte-order mark with bom, which decode removes', () =>
		Effect.gen(function* () {
			const rows = [['\uFEFFa', 'b']]
			const bytes = yield* encodeBytes(rows, { bom: true })
			assert.deepStrictEqual([...bytes.subarray(0, 4)], [0xef, 0xbb, 0xbf, 0x22])
			const decoded = yield* Stream.make(bytes).pipe(
				Stream.pipeThroughChannel(Csv.decode()),
				Stream.runCollect,
			)
			assert.deepStrictEqual(decoded, rows)
		}),
	)

	it.effect('dies when it starts with invalid options', () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(encodeBytes([['a']], { quote: '\n' }))
			assertDefect(exit, Cause.isIllegalArgumentError)
		}),
	)
})

describe('stringify', () => {
	it('encodes rows as a string', () => {
		const text = Csv.stringify([
			['name', 'note'],
			['Ada', 'said "hi", twice'],
		])
		assert.strictEqual(text, 'name,note\r\nAda,"said ""hi"", twice"\r\n')
	})

	it('returns an empty string without rows, even with bom', () => {
		assert.strictEqual(Csv.stringify([], { bom: true }), '')
	})

	describe('option validation', () => {
		const invalid: ReadonlyArray<readonly [string, Csv.EncodeOptions, RegExp]> = [
			['empty delimiter', { delimiter: '' }, /`delimiter` must be one/],
			['LF delimiter', { delimiter: '\n' }, /`delimiter` must be one/],
			['empty quote', { quote: '' }, /`quote` must be one/],
			['long quote', { quote: '""' }, /`quote` must be one/],
			// @ts-expect-error quoting cannot be disabled when encoding
			['null quote', { quote: null }, /`quote` must be one/],
			['quote equal to the delimiter', { quote: ',' }, /`quote` must differ/],
			['CR escape', { escape: '\r' }, /`escape` must be one/],
			['escape equal to the delimiter', { delimiter: ';', escape: ';' }, /`escape` must differ/],
			// @ts-expect-error a record delimiter of `\r` alone is not supported
			['CR recordDelimiter', { recordDelimiter: '\r' }, /`recordDelimiter`/],
			// @ts-expect-error JavaScript callers can pass any value
			['unknown quoteMode', { quoteMode: 'minimal' }, /`quoteMode`/],
		]

		it.each(invalid)('throws an IllegalArgumentError for %s', (_, options, message) => {
			assert.throws(() => Csv.stringify([['a']], options), Cause.IllegalArgumentError, message)
		})

		it('accepts an escape character equal to the quote', () => {
			assert.strictEqual(Csv.stringify([['"']], { quote: "'", escape: "'" }), '"\r\n')
		})
	})
})

describe('fromObjects', () => {
	const fromObjects = (
		objects: ReadonlyArray<Readonly<Record<string, string>>>,
		options?: Csv.FromObjectsOptions,
	) =>
		collect(Stream.fromIterable(objects).pipe(Stream.pipeThroughChannel(Csv.fromObjects(options))))

	it.effect('names the columns with the keys of the first object', () =>
		Effect.gen(function* () {
			const { values, exit } = yield* fromObjects([
				{ name: 'Ada', age: '36' },
				{ age: '41', name: 'Alan' },
			])
			assert.deepStrictEqual(exit, Exit.void)
			assert.deepStrictEqual(values, [
				['name', 'age'],
				['Ada', '36'],
				['Alan', '41'],
			])
		}),
	)

	it.effect('writes explicit columns in order and drops other keys', () =>
		Effect.gen(function* () {
			const { values } = yield* fromObjects([{ a: '1', b: '2', c: '3' }], { columns: ['c', 'a'] })
			assert.deepStrictEqual(values, [
				['c', 'a'],
				['3', '1'],
			])
		}),
	)

	it.effect('writes missing keys as empty fields', () =>
		Effect.gen(function* () {
			const { values } = yield* fromObjects([{ a: '1', b: '2' }, { b: '3' }, { c: '4' }])
			assert.deepStrictEqual(values, [
				['a', 'b'],
				['1', '2'],
				['', '3'],
				['', ''],
			])
		}),
	)

	it.effect('reads only own properties', () =>
		Effect.gen(function* () {
			const withProto: Record<string, string> = {}
			Object.defineProperty(withProto, '__proto__', { value: 'p', enumerable: true })
			const { values } = yield* fromObjects([{ a: '1' }, withProto], {
				columns: ['toString', '__proto__', 'a'],
			})
			assert.deepStrictEqual(values, [
				['toString', '__proto__', 'a'],
				['', '', '1'],
				['', 'p', ''],
			])
		}),
	)

	it.effect('emits a header row that does not share the inferred columns', () =>
		Effect.gen(function* () {
			const rows = yield* Stream.fromArrays([{ a: '1', b: '2' }], [{ a: '3', b: '4' }]).pipe(
				Stream.pipeThroughChannel(Csv.fromObjects()),
				Stream.map((row, i) => {
					// The type forbids changing a row; this checks that doing it anyway is harmless.
					if (i === 0) (row as Array<string>).reverse()
					return row
				}),
				Stream.runCollect,
			)
			assert.deepStrictEqual(rows, [
				['b', 'a'],
				['1', '2'],
				['3', '4'],
			])
		}),
	)

	it.effect('omits the header row with header: false', () =>
		Effect.gen(function* () {
			const { values } = yield* fromObjects([{ a: '1' }, { a: '2' }], { header: false })
			assert.deepStrictEqual(values, [['1'], ['2']])
		}),
	)

	it.effect('emits the header row of explicit columns without objects', () =>
		Effect.gen(function* () {
			assert.deepStrictEqual((yield* fromObjects([], { columns: ['a', 'b'] })).values, [['a', 'b']])
			assert.deepStrictEqual((yield* fromObjects([])).values, [])
			assert.deepStrictEqual((yield* fromObjects([], { columns: ['a'], header: false })).values, [])
		}),
	)

	it.effect('emits the rows of each upstream chunk as one batch, the header with the first', () =>
		Effect.gen(function* () {
			const batches = yield* Stream.fromArrays([{ a: '1' }, { a: '2' }], [{ a: '3' }]).pipe(
				Stream.pipeThroughChannel(Csv.fromObjects()),
				Stream.chunks,
				Stream.runCollect,
			)
			assert.deepStrictEqual(batches, [[['a'], ['1'], ['2']], [['3']]])
		}),
	)

	it.effect('propagates upstream failures after the rows converted so far', () =>
		Effect.gen(function* () {
			const { values, exit } = yield* collect(
				Stream.concat(Stream.make({ a: '1' }), Stream.fail('boom' as const)).pipe(
					Stream.pipeThroughChannel(Csv.fromObjects({ columns: ['a'] })),
				),
			)
			assert.deepStrictEqual(values, [['a'], ['1']])
			assert.deepStrictEqual(exit, Exit.fail('boom'))
		}),
	)

	it.effect('propagates the upstream done value after the header row', () =>
		Effect.gen(function* () {
			const rows: Array<Csv.Row> = []
			const done = yield* Channel.pipeTo(
				Channel.end('finished' as const),
				Csv.fromObjects({ columns: ['a'] }),
			).pipe(
				Channel.runForEach((batch) =>
					Effect.sync(() => {
						rows.push(...batch)
					}),
				),
			)
			assert.strictEqual(done, 'finished')
			assert.deepStrictEqual(rows, [['a']])
		}),
	)

	it.effect('dies when it starts with invalid columns', () =>
		Effect.gen(function* () {
			const channels = [
				Csv.fromObjects({ columns: [] }),
				Csv.fromObjects({ columns: ['a', ''] }),
				Csv.fromObjects({ columns: ['a', 'b', 'a'] }),
				// @ts-expect-error JavaScript callers can pass any value
				Csv.fromObjects({ columns: 'header' }),
			]
			for (const channel of channels) {
				const exit = yield* Stream.make({ a: '1' }).pipe(
					Stream.pipeThroughChannel(channel),
					Stream.runCollect,
					Effect.exit,
				)
				assertDefect(exit, Cause.isIllegalArgumentError)
			}
		}),
	)
})

describe('encodeSchemaString', () => {
	const Person = Schema.Struct({ name: Schema.String, age: Schema.FiniteFromString })
	const Point = Schema.Tuple([Schema.FiniteFromString, Schema.FiniteFromString])

	it.effect('encodes objects after a header row', () =>
		Effect.gen(function* () {
			const text = yield* Stream.make(
				{ name: 'Ada', age: 36 },
				{ name: 'Turing, Alan', age: 41 },
			).pipe(Stream.pipeThroughChannel(Csv.encodeSchemaString(Person)()), Stream.mkString)
			assert.strictEqual(text, 'name,age\r\nAda,36\r\n"Turing, Alan",41\r\n')
		}),
	)

	it.effect('encodes tuples as rows', () =>
		Effect.gen(function* () {
			const text = yield* Stream.make([1, 2] as const, [3, 4.5] as const).pipe(
				Stream.pipeThroughChannel(Csv.encodeSchemaString(Point)({ delimiter: ';' })),
				Stream.mkString,
			)
			assert.strictEqual(text, '1;2\r\n3;4.5\r\n')
		}),
	)

	it.effect('passes the options to fromObjects and the encoder', () =>
		Effect.gen(function* () {
			const text = yield* Stream.make({ name: 'Ada', age: 36 }).pipe(
				Stream.pipeThroughChannel(
					Csv.encodeSchemaString(Person)({
						columns: ['age', 'name'],
						header: false,
						quoteMode: 'all',
						recordDelimiter: '\n',
					}),
				),
				Stream.mkString,
			)
			assert.strictEqual(text, '"36","Ada"\n')
		}),
	)

	it.effect('writes absent optional keys as empty fields', () =>
		Effect.gen(function* () {
			const Entry = Schema.Struct({
				key: Schema.String,
				note: Schema.optionalKey(Schema.String),
				tag: Schema.optional(Schema.String),
			})
			const text = yield* Stream.make(
				{ key: 'a' },
				{ key: 'b', note: 'x', tag: undefined },
				{ key: 'c', tag: 'y' },
			).pipe(
				Stream.pipeThroughChannel(
					Csv.encodeSchemaString(Entry)({ columns: ['key', 'note', 'tag'], recordDelimiter: '\n' }),
				),
				Stream.mkString,
			)
			assert.strictEqual(text, 'key,note,tag\na,,\nb,x,\nc,,y\n')
		}),
	)

	it.effect('decodes to the same values with decodeSchemaString', () =>
		Effect.gen(function* () {
			const people = [
				{ name: 'Ada "the first"', age: 36 },
				{ name: 'Alan\r\nTuring', age: 41 },
			]
			const decoded = yield* Stream.fromIterable(people).pipe(
				Stream.pipeThroughChannel(Csv.encodeSchemaString(Person)({ delimiter: '\t' })),
				Stream.pipeThroughChannel(Csv.decodeSchemaString(Person)({ delimiter: '\t' })),
				Stream.runCollect,
			)
			assert.deepStrictEqual(decoded, people)
		}),
	)

	it.effect('fails with a SchemaError for a value that the schema cannot encode', () =>
		Effect.gen(function* () {
			const Name = Schema.Struct({ name: Schema.String.check(Schema.isNonEmpty()) })
			const { values, exit } = yield* collect(
				Stream.fromArrays([{ name: 'Ada' }], [{ name: 'Alan' }, { name: '' }]).pipe(
					Stream.pipeThroughChannel(Csv.encodeSchemaString(Name)()),
				),
			)
			assert.deepStrictEqual(values, ['name\r\nAda\r\n'])
			assert.isTrue(Exit.isFailure(exit))
			if (Exit.isFailure(exit)) {
				const error = Cause.findError(exit.cause)
				assert.isTrue(Result.isSuccess(error) && Schema.isSchemaError(error.success))
			}
		}),
	)

	it.effect('provides the encoding services of the schema', () =>
		Effect.gen(function* () {
			class Scale extends Context.Service<Scale, number>()('effect-csv/test/encode.test/Scale') {}
			const Scaled = Schema.FiniteFromString.pipe(
				Schema.decode({
					decode: SchemaGetter.passthrough(),
					encode: SchemaGetter.transformEffect((n: number) =>
						Effect.map(Effect.service(Scale), (scale) => n * scale),
					),
				}),
			)
			const text = yield* Stream.make({ value: 2 }).pipe(
				Stream.pipeThroughChannel(Csv.encodeSchemaString(Schema.Struct({ value: Scaled }))()),
				Stream.mkString,
				Effect.provideService(Scale, 10),
			)
			assert.strictEqual(text, 'value\r\n20\r\n')
		}),
	)

	it('selects the overload from the encoded type of the schema', () => {
		expectTypeOf(Csv.encodeSchemaString(Person)()).toEqualTypeOf<
			Channel.Channel<
				Arr.NonEmptyReadonlyArray<string>,
				Schema.SchemaError,
				unknown,
				Arr.NonEmptyReadonlyArray<{ readonly name: string; readonly age: number }>,
				never,
				unknown,
				never
			>
		>()
		expectTypeOf(Csv.encodeSchemaString(Point)()).toEqualTypeOf<
			Channel.Channel<
				Arr.NonEmptyReadonlyArray<string>,
				Schema.SchemaError,
				unknown,
				Arr.NonEmptyReadonlyArray<readonly [number, number]>,
				never,
				unknown,
				never
			>
		>()
		// @ts-expect-error a schema of rows has no columns
		Csv.encodeSchemaString(Point)({ columns: ['x', 'y'] })
		// @ts-expect-error a schema whose encoded fields are not strings cannot be encoded as CSV
		Csv.encodeSchemaString(Schema.Struct({ age: Schema.Finite }))
		// @ts-expect-error a schema whose encoded elements are not strings cannot be encoded as CSV
		Csv.encodeSchemaString(Schema.Tuple([Schema.Finite]))
	})
})

describe('encodeSchema', () => {
	const Person = Schema.Struct({ name: Schema.String, age: Schema.FiniteFromString })

	it.effect('encodes values as UTF-8 bytes', () =>
		Effect.gen(function* () {
			const chunks = yield* Stream.make({ name: 'Zoë', age: 7 }).pipe(
				Stream.pipeThroughChannel(Csv.encodeSchema(Person)({ bom: true })),
				Stream.runCollect,
			)
			assert.deepStrictEqual(
				concatBytes(chunks),
				new TextEncoder().encode('\uFEFFname,age\r\nZoë,7\r\n'),
			)
		}),
	)

	it.effect('encodes tuples as rows', () =>
		Effect.gen(function* () {
			const Point = Schema.Tuple([Schema.String, Schema.FiniteFromString])
			const chunks = yield* Stream.make(['a', 1] as const).pipe(
				Stream.pipeThroughChannel(Csv.encodeSchema(Point)()),
				Stream.runCollect,
			)
			assert.deepStrictEqual(concatBytes(chunks), new TextEncoder().encode('a,1\r\n'))
		}),
	)

	it.effect('dies when it starts with invalid options', () =>
		Effect.gen(function* () {
			for (const options of [{ delimiter: '"' }, { columns: [] }]) {
				const exit = yield* Stream.make({ name: 'Ada', age: 36 }).pipe(
					Stream.pipeThroughChannel(Csv.encodeSchema(Person)(options)),
					Stream.runCollect,
					Effect.exit,
				)
				assertDefect(exit, Cause.isIllegalArgumentError)
			}
		}),
	)

	it('selects the overload from the encoded type of the schema', () => {
		expectTypeOf(Csv.encodeSchema(Person)()).toEqualTypeOf<
			Channel.Channel<
				Arr.NonEmptyReadonlyArray<Uint8Array>,
				Schema.SchemaError,
				unknown,
				Arr.NonEmptyReadonlyArray<{ readonly name: string; readonly age: number }>,
				never,
				unknown,
				never
			>
		>()
		// @ts-expect-error a schema of rows has no header
		Csv.encodeSchema(Schema.Tuple([Schema.String]))({ header: false })
	})
})
