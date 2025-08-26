import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['compat/**/*.test.ts'],
		globals: true,
		environment: 'node',
		watch: false,
	},
})
