// Node-side harness: opens a blank page on the dev server, injects pagelab.js, runs a scenario file.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const DIR = __dirname;

async function open() {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.route('**/strikers/blank', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>lab</body></html>' }));
  await page.goto('http://localhost:5183/strikers/blank');
  await page.addScriptTag({ content: fs.readFileSync(path.join(DIR, 'pagelab.js'), 'utf8') });
  await page.evaluate(() => window.LAB.load());
  return { browser, page, errors };
}
function saveWav(name, b64) {
  const dir = path.join(DIR, 'wav');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), Buffer.from(b64, 'base64'));
}
module.exports = { open, saveWav, DIR };
