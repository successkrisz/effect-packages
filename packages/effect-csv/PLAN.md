# effect-csv implementation plan

**Status:** Phase 1 (core decoding) is done. The package is still `private: true`. It will be published to npm as [`effect-csv`](https://www.npmjs.com/package/effect-csv) (unscoped; the name was unclaimed on 2026-10-15).

## Goal

A streaming CSV decoder and encoder for Effect v4 that:

- has no runtime dependencies (`effect` is the only peer dependency);
- runs on any JavaScript runtime (Node, Bun, Deno, browsers, Workers), because the source never touches `Buffer`, `process` or `node:*` modules;
- plugs into `Stream` and `Channel` the same way `effect/encoding/Ndjson` does;
- reports malformed input as a typed `CsvError` with a line number;
- decodes rows into typed values with `Schema` instead of ad-hoc casting options.

## Why not wrap csv-parse

`csv-parse` (v7.0.3) already has zero runtime dependencies, so dependency count is not the reason. Its source is about 2,200 lines: a 970-line byte-level state machine, about 760 lines of option normalization, and a Node `stream.Transform` wrapper. It uses Node's `Buffer` throughout (its browser builds inline a polyfill), and its web-streams entry point imports `node:stream/web`. A thin wrapper would keep that coupling and its loosely typed options object.

Most of its options map onto things Effect already does (see [Mapping from csv-parse](#mapping-from-csv-parse)), so a fresh implementation only needs the parsing core.

## Design principles

1. **Parse strings, not bytes.** Bytes become strings through `Channel.decodeText` (a streaming `TextDecoder`), which also handles multi-byte characters split across chunks and strips a UTF-8 byte-order mark. Delimiter, quote and escape are single characters in v0.1, so the parser never needs lookahead across chunk boundaries; it only carries its state from one chunk to the next.
2. **Pure core, Effect at the edges.** The state machine in `src/internal/` is plain synchronous TypeScript that returns errors as values and never throws. `Channel.fromTransform` wraps it once per stream and feeds it whole chunks, the same way `Sse.decode` wraps `Sse.makeParser`.
3. **Follow upstream naming.** Mirror `effect/encoding/Ndjson`: `decode`, `decodeString`, `decodeSchema`, `decodeSchemaString` and the matching `encode*` functions, with the same curried `<IE, Done>` channel signatures.
4. **RFC 4180 by default.** Relaxations are opt-in options.
5. **Bad data fails, bad options die.** Malformed input is a `CsvError` in the error channel. Invalid options are programmer errors and surface as `IllegalArgumentError` defects when the channel starts (inside `Channel.fromTransform`) or when `parse` runs. An option is invalid when `delimiter`, `quote` or `escape` is not exactly one UTF-16 code unit, is `\r` or `\n`, when `quote` or `escape` equals `delimiter`, or when `maxRecordSize` is not a positive integer or `Infinity`. When `quote` is `null`, `escape` is ignored. An `escape` equal to `delimiter` is rejected because it would turn the `,"` at the end of a field such as `"x,"` into an escaped quote.
6. **Bounded memory.** `maxRecordSize` is on by default, so an unclosed quote in a large input fails fast instead of buffering the whole input.
7. **Synthetic test data only.** Fixtures come from `csv-spectrum` or are generated in tests. Never commit real exports.

## Upstream references

| File in `.repos/effect/packages/effect/src` | Use it for |
| --- | --- |
| `encoding/Ndjson.ts` | Public API layout, channel signatures, `ChannelSchema` composition |
| `encoding/Sse.ts` | Wrapping a stateful parser in `Channel.fromTransform`; the `maxEventSize` guard |
| `Channel.ts` (`splitLines`) | Handling a `\r\n` that is split across two chunks |
| `ChannelSchema.ts` | The `decodeUnknown` and `encode` schema stages |
| `http/HttpClientError.ts` | One error class with a tagged `reason` union, which works with `Effect.catchReason` |

## Package layout

```
src/
  index.ts             export * as Csv from "./Csv.ts"
  Csv.ts               public API
  internal/errors.ts   CsvError and its reasons, re-exported from Csv.ts
  internal/parser.ts   decoding state machine
  internal/encoder.ts  field quoting and row formatting
test/
  utils.ts             runs the pure parser over chunks
  parser.test.ts       table-driven tests of the pure parser
  decode.test.ts       channels, schema decoding, errors
  encode.test.ts       channels, quoting, schema encoding
  properties.test.ts   chunk-invariance and round-trip properties
  spectrum.test.ts     csv-spectrum fixtures
```

`tsconfig.json` sets `"types": []` and `"lib": ["ES2022", "DOM"]`, like upstream Effect. Code in `src` can use `TextDecoder` and `TextEncoder`, but referencing `Buffer` or importing `node:*` fails `pnpm typecheck`. The DOM lib also admits `document` and `window`, so code review still has to catch those. `tsconfig.dev.json` adds Node types back so tests can read fixture files; the `typecheck` script runs `tsconfig.json` first so the guard applies to `src`.

## Public API (draft)

Everything is exported from the `Csv` namespace: `import { Csv } from "effect-csv"` or `import * as Csv from "effect-csv/Csv"`.

```ts
type Row = ReadonlyArray<string>
type NonEmpty<A> = Arr.NonEmptyReadonlyArray<A>

// Decoding
Csv.decodeString(options?)   // Channel<NonEmpty<Row>, CsvError | IE, Done, NonEmpty<string>, IE, Done>
Csv.decode(options?)         // same, but the input is NonEmpty<Uint8Array>; options is DecodeBytesOptions
Csv.toObjects(options?)      // Channel<NonEmpty<Readonly<Record<string, string>>>, CsvError | IE, Done, NonEmpty<Row>, IE, Done>
Csv.decodeSchema(schema)(options?)        // bytes -> S["Type"]; adds Schema.SchemaError and S["DecodingServices"]
Csv.decodeSchemaString(schema)(options?)  // strings -> S["Type"]
Csv.parse(input, options?)   // Effect<ReadonlyArray<Row>, CsvError>

// Encoding
Csv.encodeString(options?)   // Channel<NonEmpty<string>, IE, Done, NonEmpty<Row>, IE, Done>
Csv.encode(options?)         // same, but the output is NonEmpty<Uint8Array> (UTF-8)
Csv.fromObjects(options?)    // Readonly<Record<string, string>> -> rows, emitting the header row first
Csv.encodeSchema(schema)(options?)        // S["Type"] -> bytes
Csv.encodeSchemaString(schema)(options?)  // S["Type"] -> strings
Csv.stringify(rows, options?) // string

// Errors and types
Csv.CsvError, Csv.isCsvError, the reason classes, Csv.DecodeOptions, Csv.DecodeBytesOptions, Csv.EncodeOptions, Csv.Row
```

Target usage:

```ts
import { Schema, Stream } from "effect"
import { Csv } from "effect-csv"

const Person = Schema.Struct({ name: Schema.String, age: Schema.NumberFromString })

const people = Stream.make(new TextEncoder().encode("name,age\nAda,36\n")).pipe(
  Stream.pipeThroughChannel(Csv.decodeSchema(Person)()),
  Stream.runCollect,
) // Effect<Array<{ readonly name: string; readonly age: number }>, CsvError | SchemaError>
```

Typing notes:

- `toObjects` and `decodeSchema` take `columns: "header" | ReadonlyArray<string>`, defaulting to `"header"`. `"header"` consumes the first row as the header. An explicit list of names consumes no header row; to rename an existing header, `Stream.drop(1)` first. In both cases the schema receives `Readonly<Record<string, string>>`, so use `Schema.Struct`, and decoding goes through `ChannelSchema.decodeUnknown`.
- `decodeSchema` has a separate overload for `columns: "none"`, which passes raw `Row` values to the schema and requires `S["Encoded"]` to extend `Row` (use `Schema.Tuple`). Pairing a `Schema.Struct` with raw rows is then a type error rather than a runtime `SchemaError`.
- `encodeSchema` has two overloads, chosen by `S["Encoded"]`. When it extends `Readonly<Record<string, string>>`, the pipeline is `ChannelSchema.encode` then `fromObjects` then `encode`. When it extends `Row`, it is `ChannelSchema.encode` then `encode`. A single signature constrained to the union of the two does not compose without a cast, because channel inputs are contravariant. `S["EncodingServices"]` goes on the channel's environment.
- Non-string values have to be encoded by the schema (for example with `Schema.NumberFromString`). That keeps the raw encoders total: they never fail.

### Decode options

| Option | Default | Phase | Behaviour |
| --- | --- | --- | --- |
| `delimiter` | `","` | 1 | Single character. Use `"\t"` for TSV. |
| `quote` | `'"'` | 1 | Single character, or `null` to disable quoting. |
| `escape` | same as `quote` | 1 | Escapes a quote inside a quoted field. The default gives RFC 4180 `""` doubling; `"\\"` supports backslash dialects. A non-quote escape also escapes itself, is kept as text before any other character, and makes `""` invalid. It has no effect outside quoted fields. |
| `relaxColumnCount` | `false` | 1 | When `false`, a row whose field count differs from the first row fails with `FieldCountMismatch`. |
| `maxRecordSize` | 10 MiB | 1 | Maximum UTF-16 code units in one record, matching the `Sse` `maxEventSize` default. Quotes, delimiters and line breaks inside quotes count; the line break that ends the record does not. `Infinity` disables the limit. |
| `encoding` | `"utf-8"` | 1 | `decode` only (`DecodeBytesOptions`); passed to `TextDecoder`. |
| `columns` | `"header"` | 2 | `toObjects` and `decodeSchema` only; see the typing notes. |
| `trim` | `false` | 4 | Trim whitespace around unquoted fields and around quoted fields. |
| `comment` | none | 4 | Skip lines that start with this character. |
| `skipEmptyLines` | `false` | 4 | Skip lines that contain no characters. |
| `relaxQuotes` | `false` | 4 | Keep a quote character inside an unquoted field instead of failing with `InvalidQuote`. |

Behaviour that is not configurable:

- Records may end with `\n`, `\r\n` or `\r`, mixed freely, as in `Channel.splitLines`.
- A U+FEFF that is the first character of the stream is removed, even if earlier chunks were empty strings. This covers `decodeString` input that was decoded with `ignoreBOM`. `decode` itself passes `ignoreBOM: true` to `TextDecoder`, so exactly one byte-order mark is removed in both cases.
- Rows decoded before a malformed record are emitted before the channel fails. An upstream failure does not flush a partial record.
- A line break at the very end of the input does not produce an extra empty record.
- With `skipEmptyLines: false`, a blank line is a record with one empty field, so it fails the column-count check on multi-column input. This matches csv-parse.
- `toObjects` with `relaxColumnCount: true` omits keys for missing fields and drops extra fields.

### Encode options

| Option | Default | Phase | Behaviour |
| --- | --- | --- | --- |
| `delimiter`, `quote`, `escape` | as for decoding | 3 | |
| `recordDelimiter` | `"\r\n"` | 3 | `"\n"` or `"\r\n"`; see the open questions. |
| `quoteMode` | `"needed"` | 3 | `"needed"` or `"all"`. |
| `columns`, `header` | keys of the first object, `true` | 3 | `fromObjects` and `encodeSchema` only. |
| `bom` | `false` | 3 | Prefix U+FEFF to the first output chunk; `encode` turns it into the UTF-8 bytes `EF BB BF`. Helps Excel detect UTF-8. |
| `escapeFormulae` | `false` | 3 | Prefix fields that start with `=`, `+`, `-`, `@`, a tab or a carriage return with `'`, to prevent CSV formula injection (OWASP). |

With `quoteMode: "needed"`, a field is quoted when it contains the delimiter, the quote character, `\r` or `\n`, when it starts with the comment character, or when it is the only field in its row and is empty. The last rule makes `[[""]]` encode as `""` instead of a blank line, so it round-trips.

### Errors

```ts
class CsvError extends Data.TaggedError("CsvError")<{ readonly reason: CsvErrorReason }> {}

type CsvErrorReason =
  | UnclosedQuote       // { line }                       input ended inside a quoted field
  | InvalidQuote        // { line, fieldIndex }           text after a closing quote, or a quote in an unquoted field
  | FieldCountMismatch  // { line, expected, actual }
  | RecordTooLarge      // { line, maxRecordSize }
  | InvalidHeader       // { line, name, problem: "Empty" | "Duplicate" }
```

`line` is the 1-based physical line where the record starts, counting line breaks inside quoted fields. Follow `HttpClientError`: each reason is its own `Data.TaggedError` class, `CsvError` carries a type ID with an `isCsvError` guard, and `message` delegates to the reason. That makes `Effect.catchReason("CsvError", "FieldCountMismatch", ...)` and `Stream.catchReason` work, as long as only `CsvError` (never a bare reason) reaches the error channel. Use `Data.TaggedError` rather than `Schema.TaggedError`, as upstream encoding modules do; these errors are never decoded. Encoding has no `CsvError`: only `encodeSchema` can fail, with `Schema.SchemaError`.

## Parser design

- **States:** `RecordStart` (no field of the current record seen yet), `FieldStart` (a delimiter just ended a field, so an empty field is already pending), `Unquoted`, `Quoted`, `QuoteInQuoted` (a quote was seen inside a quoted field, and the next character decides between an escaped quote and the closing quote) and `AfterCR` (a `\r` ended a record, so a following `\n` is swallowed even if it arrives in the next chunk). When `escape` differs from `quote`, add an `EscapeInQuoted` state.
- **End of input:** `end()` in `RecordStart` emits nothing, so empty input and a trailing line break produce no extra record. In `FieldStart` it emits the record with a final empty field (`a,` gives `["a", ""]`). In `Unquoted` or `QuoteInQuoted` it closes the field and emits the record. In `Quoted` or `EscapeInQuoted` it fails with `UnclosedQuote`.
- **Line breaks inside quotes:** `\r`, `\n` and `\r\n` inside a quoted field are kept in the field verbatim and are not record terminators, so `AfterCR` does not apply there. Line counting uses its own pending-`\r` flag so that a `\r\n` inside quotes counts as one line, even when it is split across chunks.
- **Fast path:** in `Unquoted` and `Quoted`, jump to the next special character with `indexOf` and copy the span with `slice`, instead of appending one character at a time. The next position of each special character is cached per chunk and looked up again only once it falls behind, so scanning stays linear. A field that spans chunks collects its parts and joins them once at the end of the field.
- **Interface:** `Parser.make(options, onRow)` returns `{ feed(chunk): CsvError | undefined; end(): CsvError | undefined }`, like `Sse.makeParser`. Returning the wrapped `CsvError` keeps the channel wrapper a plain `Effect.fail(error)`. Once it fails, both methods keep returning the same error. The error classes live in `internal/errors.ts`, so the parser can construct them without importing `Csv.ts`.
- **Channel wrapper:** buffer the rows from each `feed` and emit them as one non-empty batch per upstream pull. When upstream finishes, call `end()`, flush and propagate `Done`.
- **Size guard:** check `maxRecordSize` while a record accumulates, not after it ends.

## Testing strategy

- **Parser tables:** pure input-to-rows and input-to-error cases for every state transition and option.
- **Chunk invariance (the key streaming test):** for any input and any set of split points, parsing the chunks gives the same rows or the same error as parsing the whole string. Generate inputs dense in delimiters, quotes, `\r` and `\n`. Test the pure parser with the synchronous `it.prop`, and the channels with `it.effect.prop`. Both come from `@effect/vitest` and take `Schema` or `effect/Arbitrary` generators.
- **Round trip:** for any rectangular `ReadonlyArray<Row>` and any valid dialect, `parse(stringify(rows))` returns `rows`. Exclude lossy options (`trim`, `escapeFormulae`, `comment`, `skipEmptyLines`) from this property and test them with examples instead.
- **Option validation:** each invalid option from the design principles dies with a defect.
- **csv-spectrum:** add `csv-spectrum` (BSD-2-Clause) as a devDependency and read its fixtures in tests instead of copying them into the repo. They are read through Effect's `FileSystem` with `@effect/platform-node-shared`, because the `nodeBuiltinImport` rule rejects `node:fs` even in tests. The `location_coordinates` fixture is asserted to fail with `InvalidQuote`: its CSV has a bare `"` in an unquoted field, and its JSON does not describe the CSV.
- **Errors:** each reason with the correct `line`, including records that come after multi-line quoted fields.
- **Differential (optional):** compare against `csv-parse`, as a devDependency only, on generated inputs.
- **Benchmarks (not in CI):** a generated 100 MB file against `csv-parse/sync` and `papaparse`. Aim for the same order of magnitude as csv-parse, and profile before optimizing.

## Mapping from csv-parse

| csv-parse option | effect-csv |
| --- | --- |
| `delimiter`, `quote`, `escape` | Same names; single characters in v0.1 |
| `record_delimiter` | Always auto-detected; no option |
| `bom`, `encoding` | `Channel.decodeText` and the U+FEFF rule |
| `columns` | `columns` on `toObjects` and `decodeSchema` |
| `group_columns_by_name` | Dropped; duplicate headers fail with `InvalidHeader` |
| `cast`, `cast_date`, `auto_parse`, `on_record` | `Schema` |
| `from`, `to`, `from_line`, `to_line` | `Stream.drop`, `Stream.take` |
| `objname` | `Stream.runFold` |
| `skip_records_with_empty_values` | `Stream.filter` |
| `skip_records_with_error`, `on_skip` | Not in v0.1; see the open questions |
| `relax_column_count` (and `_less`, `_more`) | `relaxColumnCount` |
| `relax_quotes` | `relaxQuotes` |
| `ltrim`, `rtrim`, `trim` | `trim` |
| `comment`, `comment_no_infix` | `comment` (start of line only) |
| `skip_empty_lines` | `skipEmptyLines` |
| `max_record_size` | `maxRecordSize`, on by default |
| `raw`, `info`, `ignore_last_delimiters`, `delimiter_auto` | Not planned for v0.1 |

## Phases

Each phase ends with `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm format` passing, followed by the QA agent review described in `AGENTS.md`.

### Phase 0: skeleton (done)

- [x] Package layout, `tsconfig.json` with the no-Node-types guard, `tsconfig.dev.json` for tests
- [x] `private: true`, so `changeset publish` skips the package
- [x] This plan

### Phase 1: core decoding

- [x] `internal/parser.ts` with `delimiter`, `quote`, `escape`, `relaxColumnCount` and `maxRecordSize`
- [x] `CsvError` with the `UnclosedQuote`, `InvalidQuote`, `FieldCountMismatch` and `RecordTooLarge` reasons
- [x] `decodeString`, `decode`, `parse`
- [x] Parser tables, the chunk-invariance property and the csv-spectrum tests

### Phase 2: objects and schema decoding

- [ ] `toObjects` with `columns`, and the `InvalidHeader` reason
- [ ] `decodeSchema`, `decodeSchemaString`

### Phase 3: encoding

- [ ] `internal/encoder.ts`, `encodeString`, `encode`, `stringify`
- [ ] `fromObjects`, `encodeSchema`, `encodeSchemaString`
- [ ] `quoteMode`, `recordDelimiter`, `bom`, `escapeFormulae`
- [ ] The round-trip property

### Phase 4: dialect options

- [ ] `trim`, `comment`, `skipEmptyLines`, `relaxQuotes`
- [ ] The chunk-invariance property extended to every option

### Phase 5: release

- [ ] Package README with API docs, and a quickstart in the root README
- [ ] Add `effect-csv` to `fixtures/portability` (a dependency plus usage in `src/root.ts` and `src/subpath.ts`) so `pnpm pack:portability` checks its published types
- [ ] Benchmark results in the README
- [ ] Set `private: false` and add a `minor` changeset (0.0.0 to 0.1.0)
- [ ] Configure npm trusted publishing for `effect-csv` (repository `successkrisz/effect-packages`, workflow `release.yml`). If npm still requires a package to exist before a trusted publisher can be added, do the first publish manually.

### Later

Multi-character delimiters, delimiter sniffing, a decoder that emits each row with its line number, and dialect presets such as `Csv.tsv` and `Csv.excel`.

## Open questions

1. **Encoder line ending:** `"\r\n"` (RFC 4180, papaparse) or `"\n"` (csv-stringify)? The plan assumes `"\r\n"`.
2. **Skipping bad records:** a channel that fails ends the stream, so an equivalent of csv-parse's `skip_records_with_error` needs a separate decoder that emits a `Result<Row, CsvError>` per record for the recoverable reasons (`FieldCountMismatch`, `InvalidQuote`). Is that needed for v0.1?
3. **Sync API:** should `parse` return an `Effect` (as planned), a `Result` (like `Schema.decodeResult`), or both?
4. **Names:** `toObjects` and `fromObjects` are working names.
