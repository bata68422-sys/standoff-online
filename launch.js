const puppeteer = require('puppeteer');
const fs = require('fs');

const SITE_URL = 'https://nft-battle-production-fa3e.up.railway.app';
const BATCH = 50;

(async () => {
    const bots = JSON.parse(fs.readFileSync('bots.json', 'utf8'));
    console.log(`Launching ${bots.length} bots in batches of ${BATCH}...`);

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-gpu']
    });

    let launched = 0;
    for (let i = 0; i < bots.length; i += BATCH) {
        const batch = bots.slice(i, i + BATCH);
        const promises = batch.map(async (bot, idx) => {
            const { username, password } = bot;
            const ctx = await browser.createBrowserContext();
            const page = await ctx.newPage();

            try {
                await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await page.waitForSelector('#authOverlay', { timeout: 10000 });

                // Inject account into localStorage
                await page.evaluate((u, p) => {
                    const accounts = JSON.parse(localStorage.getItem('nftbattle_accounts') || '{}');
                    accounts[u] = p;
                    localStorage.setItem('nftbattle_accounts', JSON.stringify(accounts));
                }, username, password);

                await page.type('#loginUser', username, { delay: 5 });
                await page.type('#loginPass', password, { delay: 5 });
                await page.evaluate(() => doLogin());
                await new Promise(r => setTimeout(r, 200));

                console.log(`[${i + idx + 1}/${bots.length}] ${username} online`);
                launched++;
            } catch (e) {
                console.log(`[${i + idx + 1}/${bots.length}] ${username} failed: ${e.message}`);
            }
        });

        await Promise.allSettled(promises);
    }

    console.log(`\n${launched} bots are online! Browser stays open.`);
})();
