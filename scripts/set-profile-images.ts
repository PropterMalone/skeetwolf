/**
 * One-shot script: sets avatar and banner on the bot's Bluesky profile.
 * Run with: npx tsx scripts/set-profile-images.ts <avatar-path> <banner-path>
 * Requires BSKY_IDENTIFIER and BSKY_PASSWORD env vars.
 */
import { AtpAgent } from '@atproto/api';
import sharp from 'sharp';

const MAX_AVATAR_SIZE = 800; // px, square
const MAX_BANNER_WIDTH = 1500;
const MAX_BLOB_BYTES = 950_000; // ~950KB, under Bluesky's 976KB limit

async function resizeForUpload(
	filePath: string,
	maxWidth: number,
	maxHeight?: number,
): Promise<Buffer> {
	let buf = await sharp(filePath)
		.resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
		.png()
		.toBuffer();

	// If still too large, compress as JPEG
	if (buf.length > MAX_BLOB_BYTES) {
		buf = await sharp(filePath)
			.resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
			.jpeg({ quality: 85 })
			.toBuffer();
	}

	// Last resort: lower quality
	if (buf.length > MAX_BLOB_BYTES) {
		buf = await sharp(filePath)
			.resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
			.jpeg({ quality: 60 })
			.toBuffer();
	}

	return buf;
}

async function main() {
	const [avatarPath, bannerPath] = process.argv.slice(2);
	if (!avatarPath || !bannerPath) {
		console.error('Usage: npx tsx scripts/set-profile-images.ts <avatar.png> <banner.png>');
		process.exit(1);
	}

	const identifier = process.env.BSKY_IDENTIFIER;
	const password = process.env.BSKY_PASSWORD;
	if (!identifier || !password) {
		console.error('Set BSKY_IDENTIFIER and BSKY_PASSWORD');
		process.exit(1);
	}

	const agent = new AtpAgent({ service: 'https://bsky.social' });
	await agent.login({ identifier, password });
	console.log(`Logged in as ${agent.session?.handle}`);

	// Resize and upload avatar
	const avatarBuf = await resizeForUpload(avatarPath, MAX_AVATAR_SIZE, MAX_AVATAR_SIZE);
	const avatarEncoding = avatarBuf[0] === 0xff ? 'image/jpeg' : 'image/png';
	console.log(
		`Uploading avatar (${(avatarBuf.length / 1024).toFixed(0)} KB, ${avatarEncoding})...`,
	);
	const avatarBlob = await agent.uploadBlob(avatarBuf, { encoding: avatarEncoding });

	// Resize and upload banner
	const bannerBuf = await resizeForUpload(bannerPath, MAX_BANNER_WIDTH, 500);
	const bannerEncoding = bannerBuf[0] === 0xff ? 'image/jpeg' : 'image/png';
	console.log(
		`Uploading banner (${(bannerBuf.length / 1024).toFixed(0)} KB, ${bannerEncoding})...`,
	);
	const bannerBlob = await agent.uploadBlob(bannerBuf, { encoding: bannerEncoding });

	await agent.upsertProfile((existing) => ({
		...existing,
		displayName: existing.displayName || 'Skeetwolf',
		description: existing.description || 'Automated Werewolf/Mafia game bot for Bluesky',
		avatar: avatarBlob.data.blob,
		banner: bannerBlob.data.blob,
	}));

	console.log('Profile updated with new avatar and banner!');
}

main().catch((err) => {
	console.error('Fatal:', err);
	process.exit(1);
});
