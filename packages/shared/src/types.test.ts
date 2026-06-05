import { describe, expect, it } from 'vitest';
import { alignmentOf } from './types.js';

describe('alignmentOf', () => {
	it('mafia roles return mafia', () => {
		expect(alignmentOf('mafioso')).toBe('mafia');
		expect(alignmentOf('godfather')).toBe('mafia');
	});

	it('town roles return town', () => {
		expect(alignmentOf('villager')).toBe('town');
		expect(alignmentOf('cop')).toBe('town');
		expect(alignmentOf('doctor')).toBe('town');
	});

	it('jester returns neutral', () => {
		expect(alignmentOf('jester')).toBe('neutral');
	});
});
