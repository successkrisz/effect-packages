import { describe, expect, it } from '@effect/vitest'
import helmet from 'helmet'
import { applyMiddleware } from '../src/applyMiddleware'

describe('applyMiddleware', () => {
	it('should work with helmet', () => {
		const middleware = helmet({
			xXssProtection: true,
		})
		const result = applyMiddleware(middleware)({ headers: {} })

		expect(result.headers).toEqual(expect.objectContaining({ 'X-XSS-Protection': '0' }))
	})
})
