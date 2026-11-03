
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

const IDS_FILE = 'all_35k_ids.json';
const DB_FILE = 'master_database.json';

const BATCH_LIMIT = 8000;
const CONCURRENCY = 8;
const MAX_RETRIES = 2;

function saveDatabase(database) {
    const tempFile = DB_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(database, null, 2));
    fs.renameSync(tempFile, DB_FILE);
}

function normalizeId(item) {
    const value = typeof item === 'object' && item !== null
        ? item.id ?? item.card_id
        : item;

    return value == null ? '' : String(value).trim();
}

async function scrapeCard(browser, id) {
    const page = await browser.newPage();

    try {
        await page.setRequestInterception(true);

        page.on('request', req => {
            if (['image', 'media', 'font'].includes(req.resourceType())) {
                return req.abort().catch(() => {});
            }
            req.continue().catch(() => {});
        });

        const url = `https://shoob.gg/cards/info/${encodeURIComponent(id)}`;

        await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 45000
        });

        await page.waitForFunction(
            () => document.body &&
                /Tier\s+[1-6S]/i.test(document.body.innerText),
            { timeout: 12000 }
        ).catch(() => {});

        const data = await page.evaluate((cardId, cardUrl) => {
            const lines = document.body.innerText
                .split('\n')
                .map(x => x.trim())
                .filter(Boolean);

            const result = {
                id: String(cardId),
                name: 'Unknown',
                tier: 'Unknown',
                series: 'Unknown',
                maker: 'Official',
                image: `https://api.shoob.gg/site/api/cardr/${cardId}?size=original`,
                url: cardUrl
            };

            const tierIndex = lines.findIndex(x =>
                /^Tier\s+[1-6S]$/i.test(x)
            );

            if (tierIndex !== -1) {
                result.tier = lines[tierIndex]
                    .replace(/\s+/g, ' ')
                    .toUpperCase();

                const next = lines
                    .slice(tierIndex + 1, tierIndex + 12)
                    .filter(x => x !== '>');

                if (next.length >= 2) {
                    result.series = next[0];
                    result.name = next[1];
                }
            }

            const maker = lines.find(x =>
                x.toLowerCase().startsWith('card maker:')
            );

            if (maker) {
                result.maker = maker
                    .replace(/Card Maker:/i, '')
                    .replace(/See the Maker/i, '')
                    .trim() || 'Official';
            }

            if (result.name === 'Unknown') {
                const title = document.title || '';

                if (title) {
                    result.name = title
                        .replace(/\s*[-|]\s*Shoob.*$/i, '')
                        .trim() || 'Unknown';
                }
            }

            return result;
        }, id, url);

        if (data.tier === 'Unknown' && data.name === 'Unknown') {
            throw new Error('Card information not found');
        }

        return data;

    } finally {
        await page.close().catch(() => {});
    }
}

(async () => {
    let browser;

    try {
        console.log('\n🔥 SHOOB MASTER DATABASE BUILDER');
        console.log('================================\n');

        if (!fs.existsSync(IDS_FILE)) {
            throw new Error(`${IDS_FILE} not found`);
        }

        const rawIds = JSON.parse(fs.readFileSync(IDS_FILE, 'utf8'));

        if (!Array.isArray(rawIds)) {
            throw new Error('IDs file must contain a JSON array');
        }

        const allIds = [...new Set(rawIds.map(normalizeId).filter(Boolean))];

        let database = [];

        if (fs.existsSync(DB_FILE)) {
            try {
                database = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

                if (!Array.isArray(database)) {
                    database = [];
                }
            } catch {
                console.log('⚠️ Existing database is invalid. Starting fresh.');
                database = [];
            }
        }

        const completedIds = new Set(
            database.map(card => String(card.id ?? card.card_id))
        );

        const pendingIds = allIds.filter(id => !completedIds.has(id));

        console.log(`📦 Total IDs: ${allIds.length}`);
        console.log(`✅ Already scraped: ${completedIds.size}`);

        const targetIds = pendingIds.slice(0, BATCH_LIMIT);

        console.log(`🚀 This run: ${targetIds.length}`);
        console.log(`⏳ Remaining after this batch: ${Math.max(0, pendingIds.length - targetIds.length)}\n`);

        if (!targetIds.length) {
            console.log('🎉 DATABASE IS COMPLETE!');
            return;
        }

        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });

        let success = 0;
        let failed = 0;

        for (let i = 0; i < targetIds.length; i += CONCURRENCY) {
            const batch = targetIds.slice(i, i + CONCURRENCY);

            const results = await Promise.all(
                batch.map(async id => {
                    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
                        try {
                            const card = await scrapeCard(browser, id);

                            console.log(
                                `✅ ${card.id} | ${card.name} | ${card.tier} | ${card.series}`
                            );

                            return card;
                        } catch (error) {
                            if (attempt <= MAX_RETRIES) {
                                console.log(`🔄 Retry ${attempt}: ${id}`);
                            } else {
                                console.log(`❌ Failed: ${id} | ${error.message}`);
                            }
                        }
                    }

                    return null;
                })
            );

            for (const card of results) {
                if (card) {
                    database.push(card);
                    completedIds.add(card.id);
                    success++;
                } else {
                    failed++;
                }
            }

            saveDatabase(database);

            console.log(
                `\n📊 Progress: ${Math.min(i + batch.length, targetIds.length)}/${targetIds.length}` +
                ` | Success: ${success} | Failed: ${failed} | Database: ${database.length}\n`
            );
        }

        console.log('\n================================');
        console.log('🏆 BATCH COMPLETED');
        console.log(`✅ Successful: ${success}`);
        console.log(`❌ Failed: ${failed}`);
        console.log(`📦 Total database cards: ${database.length}`);
        console.log('💾 Database saved successfully.');

    } catch (error) {
        console.error('🔥 SCRAPER ERROR:', error);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
})();
