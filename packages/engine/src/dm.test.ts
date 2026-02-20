import { describe, expect, it, vi } from 'vitest';
import { createConsoleDmSender } from './dm.js';

describe('createConsoleDmSender', () => {
	it('sends a DM to console', async () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const sender = createConsoleDmSender();

		await sender.sendDm('did:plc:alice', 'hello');

		expect(spy).toHaveBeenCalledWith('[DM → did:plc:alice] hello');
		spy.mockRestore();
	});

	it('creates and sends to relay group', async () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const sender = createConsoleDmSender();

		sender.createRelayGroup('mafia-1', ['did:plc:alice', 'did:plc:bob']);
		await sender.sendToRelayGroup('mafia-1', 'lets kill charlie');

		expect(spy).toHaveBeenCalledWith('[RELAY GROUP mafia-1] created: did:plc:alice, did:plc:bob');
		expect(spy).toHaveBeenCalledWith('[RELAY mafia-1 → did:plc:alice] lets kill charlie');
		expect(spy).toHaveBeenCalledWith('[RELAY mafia-1 → did:plc:bob] lets kill charlie');
		spy.mockRestore();
	});

	it('handles unknown relay group gracefully', async () => {
		const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const sender = createConsoleDmSender();

		// No members → no output
		await sender.sendToRelayGroup('nonexistent', 'hello');
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});
