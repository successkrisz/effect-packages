# effect-csv

[![NPM Version](https://img.shields.io/npm/v/effect-csv)](https://www.npmjs.com/package/effect-csv) [![Checked with Biome](https://img.shields.io/badge/Checked_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)

Streaming CSV decoding and encoding for [Effect v4](https://github.com/Effect-TS/effect). Rows stay strings until a `Schema` decodes them, malformed input fails with a typed `CsvError` that carries the line number, and the only peer dependency is `effect`.

> [!WARNING]
> **This package targets [Effect v4](https://github.com/Effect-TS/effect) (`effect@4.x`).** It uses v4 `Stream`, `Channel` and `Schema`. If you are on Effect v3, it will not typecheck.
>
> See the [Effect 4.0 announcement](https://effect.website/blog/releases/effect/40/) for details.

The parser follows [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180) by default: fields are separated by `,`, quoted with `"`, and a quote inside a quoted field is written as `""`. Records may end with `\n`, `\r\n` or `\r`. `trim`, `comment`, `skipEmptyLines`, `relaxQuotes` and `relaxColumnCount` are opt-in. The source never touches `Buffer`, `process` or `node:*`, so the same code runs on Node, Bun, Deno, browsers and edge runtimes.

```ts
import { Csv } from "effect-csv"
// or: import * as Csv from "effect-csv/Csv"
```

## Installation

```bash
pnpm add effect-csv effect
```

`effect` v4 is a peer dependency. There are no runtime dependencies.

## Quick start

```ts
import { Schema, Stream } from "effect"
import { Csv } from "effect-csv"

const Person = Schema.Struct({ name: Schema.String, age: Schema.FiniteFromString })

const people = Stream.make(new TextEncoder().encode("name,age\nAda,36\n")).pipe(
  Stream.pipeThroughChannel(Csv.decodeSchema(Person)()),
  Stream.runCollect,
)
// Effect<Array<{ readonly name: string; readonly age: number }>, Csv.CsvError | Schema.SchemaError>
```

`decodeSchema` reads bytes. `decodeSchemaString` reads strings that are already decoded. Both consume a header row by default and decode each object with the schema. Non-string fields have to be encoded by the schema (`Schema.FiniteFromString` and the like): the raw row and object channels only ever see strings, and they never fail for a type mismatch.

## Decoding

| Function | Input | Output |
| --- | --- | --- |
| `decode(options?)` | chunks of `Uint8Array` | chunks of `Row` |
| `decodeString(options?)` | chunks of `string` | chunks of `Row` |
| `parse(input, options?)` | one `string` | `Effect<ReadonlyArray<Row>, CsvError>` |
| `toObjects(options?)` | chunks of `Row` | chunks of `Readonly<Record<string, string>>` |
| `decodeSchema(schema)(options?)` | chunks of `Uint8Array` | chunks of `S["Type"]` |
| `decodeSchemaString(schema)(options?)` | chunks of `string` | chunks of `S["Type"]` |

`Row` is `ReadonlyArray<string>`. The channel functions are curried the same way as `effect/encoding/Ndjson`: options in, a `Channel` out. Records, fields and line breaks may span chunks. A line break at the end of the input does not add an empty record. Rows decoded before a bad record are emitted, then the channel fails.

```ts
import { Stream } from "effect"
import { Csv } from "effect-csv"

const rows = Stream.make("# exported\nname, age\n\nAda , 36\n").pipe(
  Stream.pipeThroughChannel(
    Csv.decodeString({ comment: "#", skipEmptyLines: true, trim: true }),
  ),
  Stream.runCollect,
)
// [["name", "age"], ["Ada", "36"]]
```

`decode` turns bytes into text with a streaming `TextDecoder` (`encoding` defaults to `"utf-8"`) and then parses as `decodeString` does. A leading U+FEFF is removed once, including when it arrives as text rather than as UTF-8 bytes.

```ts
import { Effect } from "effect"
import { Csv } from "effect-csv"

const rows = Csv.parse('a;"b;c"\r\n1;2', { delimiter: ";" }).pipe(
  Effect.catchReason("CsvError", "FieldCountMismatch", (reason) =>
    Effect.die(`line ${reason.line} has ${reason.actual} fields`),
  ),
)
// [["a", "b;c"], ["1", "2"]]
```

### Objects and schemas

`toObjects` names keys from the first row (`columns: "header"`, the default) or from an explicit list. An explicit list consumes no row; drop an existing header with `Stream.drop(1)` before renaming it. Empty names, repeated names and an empty list are invalid options and die with `IllegalArgumentError` when the channel starts. A `__proto__` column becomes an own property, not a prototype change.

```ts
import { Stream } from "effect"
import { Csv } from "effect-csv"

const people = Stream.make("name,age\nAda,36\n").pipe(
  Stream.pipeThroughChannel(Csv.decodeString()),
  Stream.pipeThroughChannel(Csv.toObjects()),
  Stream.runCollect,
)
// [{ name: "Ada", age: "36" }]
```

`decodeSchema` and `decodeSchemaString` have two overloads, chosen by the schema's encoded type:

- A `Schema.Struct` (encoded type is an object of strings) receives one object per row. `columns` defaults to `"header"`.
- A `Schema.Tuple` (encoded type is a `Row`) receives the raw row. Pass `columns: "none"`. Pairing a struct with raw rows, or a tuple with objects, is a type error.

```ts
import { Schema, Stream } from "effect"
import { Csv } from "effect-csv"

const Point = Schema.Tuple([Schema.FiniteFromString, Schema.FiniteFromString])

const points = Stream.make("1,2\n3,4\n").pipe(
  Stream.pipeThroughChannel(Csv.decodeSchemaString(Point)({ columns: "none" })),
  Stream.runCollect,
)
// [[1, 2], [3, 4]]
```

A `SchemaError` carries no CSV line: schema decoding runs per upstream chunk, and a value that fails the schema drops the other values of that chunk. `CsvError`s from `decodeSchema` and `decodeSchemaString` do carry the input line, including lines skipped by `comment` or `skipEmptyLines`. The standalone `toObjects` counts lines from the rows it is given, so that count is the input line only when those rows come straight from `decode` or `decodeString` and no line was skipped.

## Encoding

| Function | Input | Output |
| --- | --- | --- |
| `stringify(rows, options?)` | rows | `string` |
| `encodeString(options?)` | chunks of `Row` | chunks of `string` |
| `encode(options?)` | chunks of `Row` | chunks of `Uint8Array` (UTF-8) |
| `fromObjects(options?)` | objects of strings | chunks of `Row`, header first |
| `encodeSchemaString(schema)(options?)` | `S["Type"]` | chunks of `string` |
| `encodeSchema(schema)(options?)` | `S["Type"]` | chunks of `Uint8Array` |

Encoding rows does not fail. Invalid options throw from `stringify` and die with `IllegalArgumentError` when an encoding channel starts. `encodeSchema` and `encodeSchemaString` can still fail with `SchemaError`.

With `quoteMode: "needed"` (the default), a field is quoted when it contains the delimiter, the quote, `\r` or `\n`, when it starts with U+FEFF, when it starts with the `comment` character after any whitespace, or when it is the only field in its row and is empty or only whitespace. The last rule makes `[[""]]` encode as `""\r\n` rather than a blank line, so a decoder with `skipEmptyLines` keeps the row. `quoteMode: "all"` quotes every field. Inside a quoted field, a quote is doubled; with a different `escape`, both the quote and the escape character are prefixed with it.

```ts
import { Stream } from "effect"
import { Csv } from "effect-csv"

const text = Stream.make(["name", "note"], ["Ada", 'said "hi", twice']).pipe(
  Stream.pipeThroughChannel(Csv.encodeString()),
  Stream.mkString,
)
// 'name,note\r\nAda,"said ""hi"", twice"\r\n'
```

`fromObjects` takes column names from the keys of the first object, unless `columns` is set. Pass `columns` when an optional key may be missing from that first object. Missing keys and `undefined` values become empty fields, keys that are not columns are dropped, and only own properties are read. With explicit `columns`, the header row is emitted even when there are no objects. `header: false` omits it.

```ts
import { Stream } from "effect"
import { Csv } from "effect-csv"

const text = Stream.make({ name: "Ada", age: "36" }, { name: "Alan", age: "41" }).pipe(
  Stream.pipeThroughChannel(Csv.fromObjects()),
  Stream.pipeThroughChannel(Csv.encodeString({ recordDelimiter: "\n" })),
  Stream.mkString,
)
// "name,age\nAda,36\nAlan,41\n"
```

`encodeSchema` chooses its overload from the encoded type, the same way `decodeSchema` does. An object of strings is converted as by `fromObjects`. A `Row` is written as a row. `columns` and `header` apply only to the object overload.

```ts
import { Schema, Stream } from "effect"
import { Csv } from "effect-csv"

const Person = Schema.Struct({ name: Schema.String, age: Schema.FiniteFromString })

const text = Stream.make({ name: "Ada", age: 36 }).pipe(
  Stream.pipeThroughChannel(Csv.encodeSchemaString(Person)()),
  Stream.mkString,
)
// "name,age\r\nAda,36\r\n"
```

`stringify` is the whole-string form of `encodeString`.

```ts
import { Csv } from "effect-csv"

Csv.stringify(
  [
    ["id", "note"],
    ["1", "tab\tinside"],
  ],
  { delimiter: "\t", recordDelimiter: "\n" },
)
// 'id\tnote\n1\t"tab\tinside"\n'
```

`bom: true` prefixes U+FEFF to the first output chunk (`EF BB BF` from `encode`). With no rows there is no output, so no byte-order mark either. `escapeFormulae: true` prefixes `'` to fields that start with `=`, `+`, `-`, `@`, a tab, `\r`, `\n`, or the full-width `＝`, `＋`, `－` or `＠`, so a spreadsheet shows them as text. The prefix is part of the field when the output is decoded.

## Options

`delimiter`, `quote`, `escape` and `comment` must each be exactly one UTF-16 code unit other than `\r` and `\n`. `quote` and `escape` must differ from `delimiter`. `comment` must differ from `delimiter` and `quote`. `maxRecordSize` must be a positive integer or `Infinity`. `quote` cannot be `null` while encoding. Anything else is a defect, not a `CsvError`.

### Decode options

| Option | Default | Behaviour |
| --- | --- | --- |
| `delimiter` | `","` | Single character. `"\t"` is TSV. |
| `quote` | `'"'` | Single character, or `null` to disable quoting. When `quote` is `null`, `escape` is ignored. |
| `escape` | same as `quote` | Escapes a quote inside a quoted field. The default is RFC 4180 `""`. `"\\"` is the backslash dialect: the escape also escapes itself, is kept as text before any other character, and makes `""` invalid. It has no effect outside quoted fields. |
| `relaxColumnCount` | `false` | When `false`, a row whose field count differs from the first row fails with `FieldCountMismatch`. |
| `maxRecordSize` | 10 MiB | Maximum UTF-16 code units in one record. Quotes, delimiters and line breaks inside quotes count; the line break that ends the record does not. `Infinity` disables the limit. |
| `encoding` | `"utf-8"` | `decode` and `decodeSchema` only. Passed to `TextDecoder`. |
| `columns` | `"header"` | `toObjects` and the schema decoders. `"header"` or a non-empty list of unique names. `columns: "none"` is the raw-row schema overload. |
| `trim` | `false` | Trim whitespace around unquoted fields and around quoted fields, but not inside the quotes. Whitespace is what `String.prototype.trim` removes, except the delimiter and the quote, so a tab delimiter is never trimmed. |
| `comment` | none | Skip lines whose first character is this one. A line that continues a quoted field is never a comment. Comment lines do not set the column count and do not count towards `maxRecordSize`, but they count in error lines. |
| `skipEmptyLines` | `false` | Skip lines that contain no characters. A line that holds only `""` is a record. With `trim`, a line of only whitespace is empty. |
| `relaxQuotes` | `false` | Keep a quote inside an unquoted field. A field that starts with a quote is still quoted, and text after its closing quote still fails with `InvalidQuote`. |

With `trim`, leading whitespace on a line is ignored too: a line of only whitespace is empty for `skipEmptyLines`, and whitespace before the comment character still makes the line a comment. Text other than whitespace after a closing quote still fails with `InvalidQuote`.

With `relaxColumnCount: true`, `toObjects` omits keys for missing fields and drops extra fields.

### Encode options

| Option | Default | Behaviour |
| --- | --- | --- |
| `delimiter`, `quote`, `escape` | as for decoding | `quote` is required. |
| `comment` | none | With `quoteMode: "needed"`, fields that start with this character are quoted, also after leading whitespace, so a decoder with the same `comment` keeps the row. |
| `recordDelimiter` | `"\r\n"` | `"\n"` or `"\r\n"`. Ends every record, including the last. |
| `quoteMode` | `"needed"` | `"needed"` or `"all"`. |
| `columns` | keys of the first object | `fromObjects` and the object overload of `encodeSchema`. |
| `header` | `true` | Emit a header row of the column names. |
| `bom` | `false` | Prefix U+FEFF to the first output chunk. |
| `escapeFormulae` | `false` | Prefix `'` to fields a spreadsheet might treat as formulas. |

`trim` is lossy on the way back: it removes whitespace around unquoted fields. It does not drop a row of encoded output. `comment`, `skipEmptyLines` and `relaxQuotes` do not change the rows of encoded output when the same options are used to decode it.

## Errors

Every decoding failure is a `CsvError`. The `reason` is its own tagged error, so `Effect.catchReason("CsvError", "FieldCountMismatch", ...)` and `Stream.catchReason` select one case. `Csv.isCsvError` is the guard. Encoding has no `CsvError`.

`line` is the 1-based physical line where the record starts, counting line breaks inside quoted fields.

| Reason | Fields | When |
| --- | --- | --- |
| `UnclosedQuote` | `line` | The input ended inside a quoted field. |
| `InvalidQuote` | `line`, `fieldIndex` | Text after a closing quote, or a quote in an unquoted field. |
| `FieldCountMismatch` | `line`, `expected`, `actual` | A record's field count differs from the first record, or from the columns of `toObjects`, and `relaxColumnCount` is off. |
| `RecordTooLarge` | `line`, `maxRecordSize` | A record grew past `maxRecordSize` UTF-16 code units. Checked while the record accumulates, so an unclosed quote cannot buffer the whole input. |
| `InvalidHeader` | `line`, `fieldIndex`, `name`, `problem` | A header name is empty (`"Empty"`) or repeated (`"Duplicate"`). |

## Benchmarks

Parsing one 100 MiB string into rows, on Node.js 24.21.0, Apple M1 Max, with an 8 GB heap. The file is 104,857,619 bytes and 2,162,627 records of six columns. Every fifth record quotes a field that contains a comma and a doubled quote. There is no header. The figure is the median of five runs after a discarded warmup, with a garbage collection between runs, measured on 19 October 2026. This is not run in CI.

| Parser | Median | Throughput |
| --- | --- | --- |
| `Csv.parse` | 803 ms | 125 MB/s |
| Papa Parse 5.7.0 | 700 ms | 143 MB/s |
| `csv-parse/sync` 7.0.3 | 2,846 ms | 35 MB/s |

Papa Parse was called with `skipEmptyLines: true`, because it otherwise turns the trailing newline into an extra empty row. `Csv.parse` and `csv-parse/sync` already omit that row. All three agreed on the row count and on the first, middle and last row. The input was a JavaScript string, which is what `Csv.parse` takes. Streaming the same bytes through `decode` adds chunking around this parser.

## License

MIT
