# effect-csv implementation plan

**Status:** Phase 1 (core decoding), Phase 2 (objects and schema decoding), Phase 3 (encoding) and Phase 4 (dialect options) are done. The package is still `private: true`. It will be published to npm as [`effect-csv`](https://www.npmjs.com/package/effect-csv) (unscoped; the name was unclaimed on 2026-10-15).

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
5. **Bad data fails, bad options die.** Malformed input is a `CsvError` in the error channel. Invalid options are programmer errors and surface as `IllegalArgumentError` defects when the channel starts (inside `Channel.fromTransform`) or when `parse` runs. An option is invalid when `delimiter`, `quote`, `escape` or `comment` is not exactly one UTF-16 code unit, is `\r` or `\n`, when `quote` or `escape` equals `delimiter`, when `comment` equals `delimiter` or `quote`, or when `maxRecordSize` is not a positive integer or `Infinity`. When `quote` is `null`, `escape` is ignored. An `escape` equal to `delimiter` is rejected because it would turn the `,"` at the end of a field such as `"x,"` into an escaped quote.
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
  internal/options.ts  delimiter, quote and escape validation shared by the parser and the encoder
  internal/parser.ts   decoding state machine
  internal/objects.ts  column validation, row-to-object conversion for toObjects, object-to-row conversion for fromObjects
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
Csv.CsvError, Csv.isCsvError, the reason classes, Csv.DecodeOptions, Csv.DecodeBytesOptions, Csv.ToObjectsOptions, Csv.EncodeOptions, Csv.FromObjectsOptions, Csv.Row
```

Target usage:

```ts
import { Schema, Stream } from "effect"
import { Csv } from "effect-csv"

const Person = Schema.Struct({ name: Schema.String, age: Schema.FiniteFromString })

const people = Stream.make(new TextEncoder().encode("name,age\nAda,36\n")).pipe(
  Stream.pipeThroughChannel(Csv.decodeSchema(Person)()),
  Stream.runCollect,
) // Effect<Array<{ readonly name: string; readonly age: number }>, CsvError | SchemaError>
```

Typing notes:

- `toObjects` and `decodeSchema` take `columns: "header" | ReadonlyArray<string>`, defaulting to `"header"`. `"header"` consumes the first row as the header. An explicit list of names consumes no header row; to rename an existing header, `Stream.drop(1)` first. In both cases the schema receives `Readonly<Record<string, string>>`, so use `Schema.Struct`, and decoding goes through `ChannelSchema.decodeUnknown`.
- `decodeSchema` has a separate overload for `columns: "none"`, which passes raw `Row` values to the schema and requires `S["Encoded"]` to extend `Row` (use `Schema.Tuple`). Because the schema comes first in `decodeSchema(schema)(options)`, the overload is chosen by `S["Encoded"]` on the first call, and its options require `columns: "none"`. Pairing a `Schema.Struct` with raw rows, or a `Schema.Tuple` with objects, is then a type error rather than a runtime `SchemaError`.
- `decodeSchema` decodes each batch with `ChannelSchema.decodeUnknown`, so a value that fails the schema also drops the other values of its upstream chunk. `SchemaError` carries no CSV line; see the row-with-line decoder under [Later](#later).
- Rows carry no line numbers, so the standalone `toObjects` counts lines itself: one per row plus the line breaks inside its fields, with `\r\n` counted once as in the parser. The result is the input line when the rows come straight from `decode` or `decodeString` and no line was skipped by `comment` or `skipEmptyLines`. `decodeSchema` and `decodeSchemaString` do not go through the standalone `toObjects`: the parser hands each row to the object conversion together with the line on which it starts, so their errors carry the input line in every case. The conversion's errors fail the parser, so errors still arrive in input order.
- `toObjects` with explicit `columns` and `relaxColumnCount: false` fails with `FieldCountMismatch` when a row's field count differs from the number of names. Explicit names that are empty or repeated, or an empty list, are invalid options and die with `IllegalArgumentError`.
- A `__proto__` column becomes an own property of each object, not a change of prototype.
- `encodeSchema` has two overloads, chosen by `S["Encoded"]`. When it extends `Readonly<Record<string, string>>`, the options are `EncodeOptions & FromObjectsOptions` and the objects are converted as by `fromObjects`. When it extends `Row`, the options are `EncodeOptions` and each encoded value is written as a row. Unlike `decodeSchema`, the row overload does not need `columns: "none"`: the encoded values themselves tell rows from objects. Both overloads share one pipeline, `ChannelSchema.encode` then an internal converter whose input is `Readonly<Record<string, string>> | Row` (arrays pass through, objects become rows) then `encode`. Because the converter accepts the union, the implementation composes without a cast. `S["EncodingServices"]` goes on the channel's environment.
- Without `columns`, `fromObjects` and `encodeSchema` take the column names from the keys of the first object. Pass `columns` when an optional key may be missing from it. Missing keys and `undefined` values become empty fields, keys that are not columns are dropped, and only own properties are read.
- Non-string values have to be encoded by the schema (for example with `Schema.FiniteFromString`). That keeps the raw encoders total: they never fail.

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
| `trim` | `false` | 4 | Trim whitespace around unquoted fields and around quoted fields, but not inside the quotes: `  "a b" ,c` gives `["a b", "c"]`. Whitespace is what `String.prototype.trim` removes, except the delimiter and the quote character, so a tab delimiter is never trimmed. Text other than whitespace after a closing quote still fails with `InvalidQuote`. |
| `comment` | none | 4 | Skip lines that start with this character. Only the first character of a line counts, as with csv-parse's `comment_no_infix`; a line that continues a quoted field is never a comment. Comment lines are not records: they do not set the column count and do not count towards `maxRecordSize`, but they count in error lines. |
| `skipEmptyLines` | `false` | 4 | Skip lines that contain no characters. A line that holds only `""` is a record. Skipped lines count in error lines. |
| `relaxQuotes` | `false` | 4 | Keep a quote character inside an unquoted field instead of failing with `InvalidQuote`. A field that starts with a quote is still quoted, and text after its closing quote still fails. |

With `trim`, leading whitespace on a line is ignored as well, as in csv-parse: a line of only whitespace is empty for `skipEmptyLines`, and whitespace before the comment character still makes the line a comment. Whitespace that `trim` skips still counts towards `maxRecordSize` once the line turns out to be a record; it is checked at the next character that is not whitespace, at the line break, or at the end of the input, because a comment or empty line is not a record. Skipped whitespace is never buffered, so the check can wait without breaking the memory bound.

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
| `delimiter`, `quote`, `escape` | as for decoding | 3 | Validated by the same code as for decoding, except that `quote` cannot be `null`: a field containing the delimiter or a line break could not be written otherwise. |
| `comment` | none | 4 | Validated as for decoding. With `quoteMode: "needed"`, quotes fields that start with this character, also after leading whitespace, so that a decoder with the same `comment` keeps their rows, even with `trim`. |
| `recordDelimiter` | `"\r\n"` | 3 | `"\n"` or `"\r\n"`; ends every record, including the last. See the open questions. |
| `quoteMode` | `"needed"` | 3 | `"needed"` or `"all"`. |
| `columns`, `header` | keys of the first object, `true` | 3 | `fromObjects` and `encodeSchema` only. Explicit `columns` are validated like those of `toObjects`. With explicit `columns`, the header row is emitted even when there are no objects. |
| `bom` | `false` | 3 | Prefix U+FEFF to the first output chunk; `encode` turns it into the UTF-8 bytes `EF BB BF`. Helps Excel detect UTF-8. Without rows there is no output, so no BOM either. |
| `escapeFormulae` | `false` | 3 | Prefix `'` to fields that start with `=`, `+`, `-`, `@`, a tab, `\r`, `\n`, or the full-width `＝`, `＋`, `－` or `＠`, to prevent CSV formula injection. This is OWASP's current list, which added `\n` and the full-width forms to the original six. |

Invalid encode options die with `IllegalArgumentError` when the channel starts; `stringify` returns a plain string, so it throws the error instead.

With `quoteMode: "needed"`, a field is quoted when it contains the delimiter, the quote character, `\r` or `\n`, when it starts with U+FEFF, when it starts with the `comment` character after any whitespace, or when it is the only field in its row and is empty or only whitespace. The U+FEFF rule stops a decoder from removing a leading U+FEFF as a byte-order mark. The comment rule stops a decoder with the same `comment` from skipping the row; the whitespace covers decoders with `trim`, which ignore it. Like the U+FEFF rule, it applies to every field, not only to the first field of a row, because the rule is then the same for all fields. The last rule makes `[[""]]` encode as `""` instead of a blank line, and `[[" "]]` as `" "`, so the row survives `skipEmptyLines` (with or without `trim`) and other decoders that skip blank lines. `trim` stays lossy, since it removes whitespace around unquoted fields, but it never drops a row of encoded output. Inside a quoted field, a quote is doubled; with a different `escape`, both the quote and the escape character are prefixed with it. An escape character outside quotes is plain text, so it does not cause quoting. A row with no fields is written as a blank line, which decodes as one empty field, or as nothing with `skipEmptyLines`.

### Errors

```ts
class CsvError extends Data.TaggedError("CsvError")<{ readonly reason: CsvErrorReason }> {}

type CsvErrorReason =
  | UnclosedQuote       // { line }                       input ended inside a quoted field
  | InvalidQuote        // { line, fieldIndex }           text after a closing quote, or a quote in an unquoted field
  | FieldCountMismatch  // { line, expected, actual }
  | RecordTooLarge      // { line, maxRecordSize }
  | InvalidHeader       // { line, fieldIndex, name, problem: "Empty" | "Duplicate" }
```

`line` is the 1-based physical line where the record starts, counting line breaks inside quoted fields. Follow `HttpClientError`: each reason is its own `Data.TaggedError` class, `CsvError` carries a type ID with an `isCsvError` guard, and `message` delegates to the reason. That makes `Effect.catchReason("CsvError", "FieldCountMismatch", ...)` and `Stream.catchReason` work, as long as only `CsvError` (never a bare reason) reaches the error channel. Use `Data.TaggedError` rather than `Schema.TaggedError`, as upstream encoding modules do; these errors are never decoded. Encoding has no `CsvError`: only `encodeSchema` can fail, with `Schema.SchemaError`.

## Parser design

- **States:** `RecordStart` (nothing of the current line seen yet), `FieldStart` (a delimiter just ended a field, so an empty field is already pending; or no field of the line has been seen yet, apart from whitespace that `trim` skipped), `Unquoted`, `Quoted`, `QuoteInQuoted` (a quote was seen inside a quoted field, and the next character decides between an escaped quote and the closing quote), `AfterQuoted` (with `trim`, whitespace after a closing quote), `AfterCR` (a `\r` ended a line, so a following `\n` is swallowed even if it arrives in the next chunk) and `Comment` (a line that started with the comment character, skipped up to its line break). When `escape` differs from `quote`, add an `EscapeInQuoted` state. `FieldStart` with no field yet is where comments and empty lines are detected, so `trim` only has to skip whitespace there for both to see past it.
- **End of input:** `end()` in `RecordStart`, `AfterCR` or `Comment` emits nothing, so empty input and a trailing line break produce no extra record. In `FieldStart` it emits the record with a final empty field (`a,` gives `["a", ""]`), unless no field was seen and `skipEmptyLines` is on. In `Unquoted`, `QuoteInQuoted` or `AfterQuoted` it closes the field and emits the record. In `Quoted` or `EscapeInQuoted` it fails with `UnclosedQuote`.
- **Line breaks inside quotes:** `\r`, `\n` and `\r\n` inside a quoted field are kept in the field verbatim and are not record terminators, so `AfterCR` does not apply there. Line counting uses its own pending-`\r` flag so that a `\r\n` inside quotes counts as one line, even when it is split across chunks.
- **Fast path:** in `Unquoted` and `Quoted`, jump to the next special character with `indexOf` and copy the span with `slice`, instead of appending one character at a time. The next position of each special character is cached per chunk and looked up again only once it falls behind, so scanning stays linear. A field that spans chunks collects its parts and joins them once at the end of the field.
- **Interface:** `Parser.make(options, onRow)` returns `{ feed(chunk): CsvError | undefined; end(): CsvError | undefined }`, like `Sse.makeParser`. `onRow(row, line)` receives each record with the line on which it starts, and may return a `CsvError`, which fails the parser. That is how `decodeSchema` converts rows into objects with the parser's line numbers. Returning the wrapped `CsvError` keeps the channel wrapper a plain `Effect.fail(error)`. Once it fails, both methods keep returning the same error. The error classes live in `internal/errors.ts`, so the parser can construct them without importing `Csv.ts`.
- **Channel wrapper:** buffer the values emitted by `onRow` during each `feed` and emit them as one non-empty batch per upstream pull. When upstream finishes, call `end()`, flush and propagate `Done`. `decodeString` and the object conversion of `decodeSchema` share this wrapper.
- **Size guard:** check `maxRecordSize` while a record accumulates, not after it ends. The only deferred check is for whitespace that `trim` skips, as described under the decode options.

## Testing strategy

- **Parser tables:** pure input-to-rows and input-to-error cases for every state transition and option.
- **Chunk invariance (the key streaming test):** for any input, any combination of decode options and any set of split points, parsing the chunks gives the same rows or the same error as parsing the whole string. Generate inputs dense in delimiters, quotes, comment characters, whitespace, `\r` and `\n`. Generated well-formed documents with comment lines, empty lines and whitespace around fields also check the rows, the line of each row and the line of a final unclosed quote against the generated structure, for any split. Test the pure parser with the synchronous `it.prop`, and the channels with `it.effect.prop`. Both come from `@effect/vitest` and take `Schema` or `effect/Arbitrary` generators.
- **Round trip:** for any rectangular `ReadonlyArray<Row>` and any valid dialect, `parse(stringify(rows))` returns `rows`. `comment` (given to both sides), `skipEmptyLines` and `relaxQuotes` cannot change the rows of encoded output, so they are part of this property. `trim` is lossy, so a separate property checks only that it keeps every row and field of encoded output and changes a field at most by trimming it. Test `escapeFormulae`, which changes fields, with examples.
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
| `relax_quotes` | `relaxQuotes`, for quotes inside unquoted fields only; text after a closing quote always fails |
| `ltrim`, `rtrim`, `trim` | `trim` (both sides) |
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

- [x] `toObjects` with `columns`, and the `InvalidHeader` reason
- [x] `decodeSchema`, `decodeSchemaString`

### Phase 3: encoding

- [x] `internal/encoder.ts`, `encodeString`, `encode`, `stringify`
- [x] `fromObjects`, `encodeSchema`, `encodeSchemaString`
- [x] `quoteMode`, `recordDelimiter`, `bom`, `escapeFormulae`
- [x] The round-trip property, both for `stringify` then `parse` and for the channels (`encode` then `decode` with the bytes split anywhere, `fromObjects` then `toObjects`), plus chunk invariance of `encodeString`

### Phase 4: dialect options

- [x] `trim`, `comment`, `skipEmptyLines`, `relaxQuotes`
- [x] A `comment` encode option that quotes fields starting with the comment character, so commented-looking rows round-trip
- [x] The chunk-invariance property extended to every option
- [x] `decodeSchema` and `decodeSchemaString` take line numbers from the parser, so errors after skipped lines carry the input line

### Phase 5: release

- [x] Package README with API docs, and a quickstart in the root README
- [x] Add `effect-csv` to `fixtures/portability` (a dependency plus usage in `src/root.ts` and `src/subpath.ts`) so `pnpm pack:portability` checks its published types
- [x] Benchmark results in the README
- [x] Set `private: false` and add a `minor` changeset (0.0.0 to 0.1.0)
- [x] Configure npm trusted publishing for `effect-csv` (repository `successkrisz/effect-packages`, workflow `release.yml`). If npm still requires a package to exist before a trusted publisher can be added, do the first publish manually.

### Later

Multi-character delimiters, delimiter sniffing, a decoder that emits each row with its line number, and dialect presets such as `Csv.tsv` and `Csv.excel`.

## Open questions

1. **Encoder line ending:** `"\r\n"` (RFC 4180, papaparse) or `"\n"` (csv-stringify)? Phase 3 ships `"\r\n"` as the default; switching it changes one default and the tests that assert exact output.
2. **Skipping bad records:** a channel that fails ends the stream, so an equivalent of csv-parse's `skip_records_with_error` needs a separate decoder that emits a `Result<Row, CsvError>` per record for the recoverable reasons (`FieldCountMismatch`, `InvalidQuote`). Is that needed for v0.1?
3. **Sync API:** should `parse` return an `Effect` (as planned), a `Result` (like `Schema.decodeResult`), or both?
4. **Names:** `toObjects` and `fromObjects` are working names.
