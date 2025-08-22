import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['packages/**/*.test.ts'],
		globals: true,
		environment: 'node',
		setupFiles: [],
		watch: false,
	},
})
