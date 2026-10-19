import type { EncodeOptions, Row } from '../Csv.ts'
import { invalidOption, resolveDialect } from './options.ts'

/** @internal */
export interface Encoder {
	/**
	 * Formats rows, each followed by the record delimiter. With `bom`, the
	 * first call that receives a row starts with U+FEFF.
	 */
	readonly encode: (rows: ReadonlyArray<Row>) => string
}

const BOM = '\uFEFF'

// Characters that make a spreadsheet evaluate a cell as a formula, as listed by OWASP (CSV injection),
// including the full-width variants of `=`, `+`, `-` and `@`.
const formulaStart = /^[=+\-@\t\r\n\uFF1D\uFF0B\uFF0D\uFF20]/

/** A regular expression source that matches the UTF-16 code unit `char` literally. */
const codeUnit = (char: string): string => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`

const resolveOptions = (options: EncodeOptions | undefined) => {
	const { delimiter, quote, escapeChar } = resolveDialect(options, false)
	const recordDelimiter = options?.recordDelimiter ?? '\r\n'
	if (recordDelimiter !== '\r\n' && recordDelimiter !== '\n') {
		invalidOption('`recordDelimiter` must be "\\n" or "\\r\\n"')
	}
	const quoteMode = options?.quoteMode ?? 'needed'
	if (quoteMode !== 'needed' && quoteMode !== 'all') {
		invalidOption('`quoteMode` must be "needed" or "all"')
	}
	return {
		delimiter,
		quote,
		escapeChar,
		recordDelimiter,
		quoteAll: quoteMode === 'all',
		bom: options?.bom ?? false,
		escapeFormulae: options?.escapeFormulae ?? false,
	}
}

/**
 * Creates a CSV encoder. Encoding never fails; invalid options throw an
 * `IllegalArgumentError` here.
 *
 * @internal
 */
export const make = (options: EncodeOptions | undefined): Encoder => {
	const { delimiter, quote, escapeChar, recordDelimiter, quoteAll, bom, escapeFormulae } =
		resolveOptions(options)
	// A leading U+FEFF is quoted because decoders remove a byte-order mark at the start of the input.
	const needsQuotes = new RegExp(`[${codeUnit(delimiter)}${codeUnit(quote)}\\r\\n]|^\\uFEFF`)
	const escapable = new RegExp(
		escapeChar === quote ? codeUnit(quote) : `[${codeUnit(quote)}${codeUnit(escapeChar)}]`,
		'g',
	)
	// A replacer function, because a replacement string would interpret `$` in the escape character.
	const prefixEscape = (char: string) => escapeChar + char
	let bomPending = bom

	const field = (value: string, alone: boolean): string => {
		const text = escapeFormulae && formulaStart.test(value) ? `'${value}` : value
		// A lone empty field is quoted, so that decoders that skip blank lines keep its record.
		return quoteAll || needsQuotes.test(text) || (alone && text === '')
			? quote + text.replace(escapable, prefixEscape) + quote
			: text
	}

	const encode = (rows: ReadonlyArray<Row>): string => {
		let out = ''
		if (bomPending && rows.length > 0) {
			bomPending = false
			out = BOM
		}
		for (const row of rows) {
			const alone = row.length === 1
			for (let i = 0; i < row.length; i++) {
				if (i > 0) out += delimiter
				out += field(row[i], alone)
			}
			out += recordDelimiter
		}
		return out
	}

	return { encode }
}
