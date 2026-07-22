const puppeteer = require('puppeteer');
const fs = require('fs');

const SITE_URL = 'https://nft-battle-production-fa3e.up.railway.app';
const BOT_COUNT = 1000;
const BATCH = 20;

function randomString(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < len; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

(async () => {
    console.log(`Creating ${BOT_COUNT} accounts...`);
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const bots = [];

    for (let i = 0; i < BOT_COUNT; i += BATCH) {
        const promises = [];
        for (let j = 0; j < BATCH && i + j < BOT_COUNT; j++) {
            const idx = i + j;
            const username = `acc${idx}_${randomString(4)}`;
            const password = randomString(8);

            promises.push((async () => {
                const ctx = await browser.createBrowserContext();
                const page = await ctx.newPage();
                try {
                    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    await page.waitForSelector('#authOverlay', { timeout: 10000 });

                    // Register via UI
                    await page.evaluate((u, p) => {
                        document.getElementById('regUser').value = u;
                        document.getElementById('regPass').value = p;
                        document.getElementById('regPass2').value = p;
                        doRegister();
                    }, username, password);

                    await new Promise(r => setTimeout(r, 200));

                    // Login via UI
                    await page.evaluate((p) => {
                        document.getElementById('loginPass').value = p;
                        doLogin();
                    }, password);

                    await new Promise(r => setTimeout(r, 300));

                    console.log(`[${idx + 1}/${BOT_COUNT}] ${username}`);
                    return { username, password, ok: true };
                } catch (e) {
                    console.log(`[${idx + 1}/${BOT_COUNT}] ${username} FAILED`);
                    return { username, password, ok: false };
                } finally {
                    await ctx.close();
                }
            })());
        }
        const results = await Promise.allSettled(promises);
        for (const r of results) {
            if (r.status === 'fulfilled' && r.value?.ok) bots.push({ username: r.value.username, password: r.value.password });
        }
    }

    await browser.close();
    fs.writeFileSync('bots.json', JSON.stringify(bots, null, 2));
    console.log(`\nDone: ${bots.length} accounts registered. Saved to bots.json`);
})();
