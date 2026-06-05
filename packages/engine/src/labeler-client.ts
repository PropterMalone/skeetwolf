/**
 * HTTP client for propter-labeler service.
 * Labels game posts and registers threads for auto-labeling of player replies.
 */

export interface LabelerClient {
	/** Label a specific post (bot's own posts, thread roots) */
	labelPost(uri: string, val: string): Promise<void>;
	/** Register a thread for auto-labeling all replies */
	watchThread(threadUri: string, label: string): Promise<void>;
	/** Stop watching a thread */
	unwatchThread(threadUri: string): Promise<void>;
}

export function createLabelerClient(baseUrl: string, secret: string): LabelerClient {
	async function post(path: string, body: Record<string, string>): Promise<void> {
		try {
			const res = await fetch(`${baseUrl}${path}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${secret}`,
				},
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				console.error(`Labeler ${path} failed (${res.status}): ${await res.text()}`);
			}
		} catch (error) {
			console.error(`Labeler ${path} error:`, error);
		}
	}

	return {
		async labelPost(uri: string, val: string) {
			await post('/label', { uri, val });
		},
		async watchThread(threadUri: string, label: string) {
			await post('/watch', { threadUri, label });
		},
		async unwatchThread(threadUri: string) {
			try {
				const res = await fetch(`${baseUrl}/watch`, {
					method: 'DELETE',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${secret}`,
					},
					body: JSON.stringify({ threadUri }),
				});
				if (!res.ok) {
					console.error(`Labeler unwatch failed (${res.status}): ${await res.text()}`);
				}
			} catch (error) {
				console.error('Labeler unwatch error:', error);
			}
		},
	};
}
