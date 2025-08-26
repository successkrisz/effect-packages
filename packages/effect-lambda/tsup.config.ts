import { defineConfig } from 'tsup'

export default defineConfig({
	entry: [
		'src/index.ts',
		'src/CustomAuthorizer.ts',
		'src/DynamoDb.ts',
		'src/RestApi.ts',
		'src/HttpApi.ts',
		'src/Sns.ts',
		'src/Sqs.ts',
	],
	format: ['esm', 'cjs'],
	dts: true,
	sourcemap: true,
	clean: true,
	skipNodeModulesBundle: true,
	treeshake: true,
})
