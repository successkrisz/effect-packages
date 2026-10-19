import type * as Csv from '../src/Csv.ts'
import * as Parser from '../src/internal/parser.ts'

export type ReasonFields = { readonly _tag: Csv.CsvErrorReason['_tag'] } & Readonly<
	Record<string, unknown>
>

export interface Outcome {
	readonly rows: ReadonlyArray<Csv.Row>
	readonly error: ReasonFields | undefined
}

export const reasonFields = (error: Csv.CsvError): ReasonFields => ({ ...error.reason })

/** Runs the pure parser over `chunks`, keeping the rows decoded before any error. */
export const parseChunks = (chunks: Iterable<string>, options?: Csv.DecodeOptions): Outcome => {
	const rows: Array<Csv.Row> = []
	const parser = Parser.make(options, (row) => {
		rows.push(row)
	})
	let error: Csv.CsvError | undefined
	for (const chunk of chunks) {
		error = parser.feed(chunk)
		if (error !== undefined) break
	}
	error ??= parser.end()
	return { rows, error: error === undefined ? undefined : reasonFields(error) }
}
