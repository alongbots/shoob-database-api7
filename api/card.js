
import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed'
        });
    }

    const { key, random, id } = req.query;

    if (key !== process.env.API_KEY) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized API Key'
        });
    }

    try {
        const dbPath = path.join(
            process.cwd(),
            'master_database.json'
        );

        if (!fs.existsSync(dbPath)) {
            return res.status(500).json({
                success: false,
                error: 'Database file not found'
            });
        }

        const cards = JSON.parse(
            fs.readFileSync(dbPath, 'utf8')
        );

        if (!Array.isArray(cards) || cards.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Database is empty'
            });
        }

        let selectedCard = null;

        if (random === 'true') {
            const index = Math.floor(Math.random() * cards.length);
            selectedCard = cards[index];

        } else if (id !== undefined) {
            const searchId = String(id);

            selectedCard = cards.find(card =>
                String(card.id ?? card.card_id ?? '') === searchId
            );

        } else {
            return res.status(400).json({
                success: false,
                error: 'Provide an id or random=true'
            });
        }

        if (!selectedCard) {
            return res.status(404).json({
                success: false,
                error: 'Card not found'
            });
        }

        const realId = String(
            selectedCard.id ?? selectedCard.card_id
        );

        const protocol =
            req.headers['x-forwarded-proto'] || 'https';

        const host = req.headers.host;

        const proxyImageUrl =
            `${protocol}://${host}/api/image?id=${encodeURIComponent(realId)}`;

        return res.status(200).json({
            success: true,
            id: realId,
            name: selectedCard.name || selectedCard.character || 'Unknown',
            tier: selectedCard.tier || 'Unknown',
            series: selectedCard.series || 'Unknown',
            maker: selectedCard.maker || 'Official',
            image: proxyImageUrl,
            original_url: selectedCard.image || selectedCard.image_url || null
        });

    } catch (error) {
        console.error('Database Error:', error);

        return res.status(500).json({
            success: false,
            error: 'Database error'
        });
    }
}
