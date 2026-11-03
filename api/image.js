
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const id = String(req.query.id || '');

        if (!/^\d+$/.test(id)) {
            return res.status(400).json({ error: 'Invalid card ID' });
        }

        const dbPath = path.join(process.cwd(), 'master_database.json');

        if (!fs.existsSync(dbPath)) {
            return res.status(500).json({ error: 'Database not found' });
        }

        const cards = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

        const card = cards.find(c =>
            String(c.id ?? c.card_id ?? '') === id
        );

        if (!card) {
            return res.status(404).json({ error: 'Card not found' });
        }

        const imageUrl = card.image || card.image_url;

        if (!imageUrl) {
            return res.status(404).json({ error: 'Image URL missing' });
        }

        const parsedUrl = new URL(imageUrl);

        if (
            parsedUrl.protocol !== 'https:' ||
            parsedUrl.hostname !== 'api.shoob.gg'
        ) {
            return res.status(400).json({ error: 'Invalid image source' });
        }

        const response = await fetch(parsedUrl.href, {
            signal: AbortSignal.timeout(20000)
        });

        if (!response.ok) {
            return res.status(502).json({
                error: 'Original image unavailable'
            });
        }

        const contentType = response.headers.get('content-type') || '';

        if (!contentType.startsWith('image/')) {
            return res.status(502).json({ error: 'Invalid image response' });
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
        res.setHeader('Content-Length', buffer.length);

        return res.status(200).send(buffer);

    } catch (error) {
        console.error('Image Proxy Error:', error);

        return res.status(500).json({
            error: 'Image proxy failed'
        });
    }
}
