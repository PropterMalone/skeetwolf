/**
 * Thin wrapper around @skyware/labeler.
 * Runs in-process with the engine — labels game posts so non-players can filter them.
 */
import { LabelerServer } from '@skyware/labeler';

export function createLabeler(did: string, signingKey: string, port: number): LabelerServer {
	const server = new LabelerServer({ did, signingKey });
	server.start(port, (error, address) => {
		if (error) {
			console.error('Labeler server failed to start:', error);
		} else {
			console.log(`Labeler server listening at ${address}`);
		}
	});
	return server;
}

export async function labelPost(
	server: LabelerServer,
	postUri: string,
	labelVal: string,
): Promise<void> {
	try {
		await server.createLabel({ uri: postUri, val: labelVal });
	} catch (error) {
		console.error(`Failed to label post ${postUri}:`, error);
	}
}
