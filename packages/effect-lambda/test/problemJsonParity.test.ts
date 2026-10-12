import { HttpApiProblemDetail } from '@ballatech/effect-problem-json'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import type { HttpServerResponse } from 'effect/http'
import { badRequestFromSchemaError } from '../src/HttpResponse'
import { httpStatusMessages } from '../src/internal/http-status-codes'
import { makeInternalServerErrorResponse } from '../src/internal/problemDetail'

const decodeServerResponseBody = (response: HttpServerResponse.HttpServerResponse) => {
	if (response.body._tag !== 'Uint8Array') {
		throw new Error(`Expected a Uint8Array body, got ${response.body._tag}`)
	}
	return {
		contentType: response.body.contentType,
		body: JSON.parse(new TextDecoder().decode(response.body.body)),
	}
}

const makeSchemaError = Schema.decodeUnknownEffect(
	Schema.Struct({ n: Schema.Number, nested: Schema.Struct({ s: Schema.String }) }),
)({ n: 'not-a-number', nested: { s: 1 } }, { errors: 'all' }).pipe(Effect.flip)

describe('problem+json parity with @ballatech/effect-problem-json', () => {
	it('uses the same status titles', () => {
		for (const [status, title] of Object.entries(HttpApiProblemDetail.statusTitles)) {
			expect(httpStatusMessages[Number(status) as keyof typeof httpStatusMessages]).toBe(title)
		}
	})

	it.effect('emits validation problems with the same shape', () =>
		Effect.gen(function* () {
			const error = yield* makeSchemaError
			const lambda = yield* badRequestFromSchemaError(error)
			const reference = decodeServerResponseBody(
				HttpApiProblemDetail.ValidationProblem.toResponse(error),
			)
			const lambdaBody = JSON.parse(lambda.body)

			expect(lambda.headers?.['content-type']).toBe(reference.contentType)
			expect(Object.keys(lambdaBody).sort()).toEqual(Object.keys(reference.body).sort())
			// effect-problem-json uses a `/problems/schema-error` type; the Lambda helper keeps the RFC default.
			expect(lambdaBody.type).toBe('about:blank')
			expect(lambdaBody.title).toBe(reference.body.title)
			expect(lambdaBody.status).toBe(reference.body.status)
			expect(lambdaBody.detail).toBe(reference.body.detail)
			expect(lambdaBody.errors).toEqual(reference.body.errors)
		}),
	)

	it('emits the defect fallback with the same shape', () => {
		const reference = decodeServerResponseBody(
			HttpApiProblemDetail.makeResponse(500, 'An unexpected error occurred'),
		)
		const lambda = makeInternalServerErrorResponse()
		const lambdaBody = JSON.parse(lambda.body)

		expect(lambda.headers['content-type']).toBe(reference.contentType)
		expect(lambdaBody).toEqual(reference.body)
	})
})
