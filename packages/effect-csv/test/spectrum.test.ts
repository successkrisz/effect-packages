import { NodeFileSystem, NodePath } from '@effect/platform-node-shared'
import { assert, layer } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path, Schema, Stream } from 'effect'
import * as Csv from '../src/Csv.ts'
import { reasonFields } from './utils.ts'

// csv-spectrum (BSD-2-Clause) ships each fixture as `csvs/<name>.csv` with the expected records in `json/<name>.json`.
const fixtures = [
	'comma_in_quotes',
	'empty',
	'empty_crlf',
	'escaped_quotes',
	'json',
	'newlines',
	'newlines_crlf',
	'quotes_and_newlines',
	'simple',
	'simple_crlf',
	'utf8',
] as const

// Its CSV has a bare `"` inside an unquoted field, and its JSON does not describe the CSV (a different phone number,
// and an object instead of an array), so it is checked separately.
const invalidFixture = 'location_coordinates'

const Records = Schema.fromJsonString(Schema.Array(Schema.Record(Schema.String, Schema.String)))

const toRecords = (rows: ReadonlyArray<Csv.Row>) => {
	const [header = [], ...records] = rows
	return records.map((row) => Object.fromEntries(header.map((name, i) => [name, row[i]])))
}

const decodeChunks = (chunks: ReadonlyArray<Uint8Array>) =>
	Stream.fromIterable(chunks).pipe(
		Stream.rechunk(1),
		Stream.pipeThroughChannel(Csv.decode()),
		Stream.runCollect,
	)

const spectrum = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const root = yield* path.fromFileUrl(new URL('../node_modules/csv-spectrum/', import.meta.url))
	return {
		list: fs.readDirectory(path.join(root, 'csvs')),
		csv: (name: string) => fs.readFile(path.join(root, 'csvs', `${name}.csv`)),
		json: (name: string) => fs.readFileString(path.join(root, 'json', `${name}.json`)),
	}
})

layer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))('csv-spectrum', (it) => {
	it.effect('covers every fixture', () =>
		Effect.gen(function* () {
			const files = yield* (yield* spectrum).list
			assert.deepStrictEqual(
				[...files].sort(),
				[...fixtures, invalidFixture].map((name) => `${name}.csv`).sort(),
			)
		}),
	)

	it.effect.each(fixtures)('%s', (name) =>
		Effect.gen(function* () {
			const { csv, json } = yield* spectrum
			const bytes = yield* csv(name)
			const expected = yield* Effect.flatMap(json(name), Schema.decodeUnknownEffect(Records))
			const whole = yield* decodeChunks([bytes])
			const byteByByte = yield* decodeChunks(Array.from(bytes, (byte) => Uint8Array.of(byte)))
			assert.deepStrictEqual(toRecords(whole), expected)
			assert.deepStrictEqual(byteByByte, whole)
		}),
	)

	it.effect(`${invalidFixture} fails on its bare quote`, () =>
		Effect.gen(function* () {
			const bytes = yield* (yield* spectrum).csv(invalidFixture)
			const error = yield* Effect.flip(decodeChunks([bytes]))
			assert.deepStrictEqual(reasonFields(error), {
				_tag: 'InvalidQuote',
				line: 2,
				fieldIndex: 1,
			})
		}),
	)
})
