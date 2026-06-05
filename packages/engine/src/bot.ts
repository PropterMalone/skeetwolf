// pattern: Imperative Shell
// Re-exports from propter-bsky-kit — all Bluesky I/O now lives in the shared package.

export { createAgent, buildFacets, resolveHandle, extractRkey } from 'propter-bsky-kit';
export { graphemeLength, truncateToLimit, splitForPost } from 'propter-bsky-kit';
export {
	postMessage,
	postMessageChain,
	replyToPost,
	replyToPostChain,
	postWithQuote,
	postWithQuoteChain,
} from 'propter-bsky-kit';
export type { PostingOptions } from 'propter-bsky-kit';
export { pollMentions, pollAllMentions } from 'propter-bsky-kit';
export {
	createChatAgent,
	createBlueskyDmSender,
	createRelayDmSender,
	createConsoleDmSender,
	createConsoleRelayDmSender,
	pollInboundDms,
} from 'propter-bsky-kit';
export {
	createThreadgate,
	createMentionThreadgate,
	deleteThreadgate,
	createPostgate,
	deletePostgate,
} from 'propter-bsky-kit';
export { getThreadReplies } from 'propter-bsky-kit';
export type {
	BotConfig,
	PostRef,
	DmResult,
	DmSender,
	RelayDmSender,
	MentionNotification,
	InboundDm,
	ThreadReply,
} from 'propter-bsky-kit';
