import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	resolve: {
		alias: {
			'@skeetwolf/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
		},
	},
	test: {
		passWithNoTests: true,
		coverage: {
			provider: 'v8',
		},
	},
});
