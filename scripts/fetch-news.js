// Fetches BBC/NPR/CBC RSS feeds server-side (no CORS involved — this runs on
// GitHub's runners, not in a browser) and writes the result to news.json at
// the repo root. That file is then served statically by GitHub Pages and
// read directly by index.html, same-origin, no proxy needed.
const fs = require('fs');
const path = require('path');

const FEEDS = {
  world: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  US: 'https://feeds.npr.org/1001/rss.xml',
  Canada: 'https://rss.cbc.ca/lineup/topstories.xml'
};

const OUTPUT_PATH = path.join(__dirname, '..', 'news.json');
const MAX_ITEMS = 15;

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!m) return '';
  let val = m[1].trim();
  const cdata = val.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  if (cdata) val = cdata[1];
  return val.trim();
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, '').trim();
}

function parseItems(xml, limit) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) && items.length < limit) {
    const block = m[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    if (!title || !link) continue;
    items.push({
      title: stripHtml(title),
      link: link,
      pubDate: extractTag(block, 'pubDate') || new Date().toISOString(),
      description: stripHtml(extractTag(block, 'description')).slice(0, 200)
    });
  }
  return items;
}

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DispatchNewsBot/1.0)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const xml = await res.text();
  const items = parseItems(xml, MAX_ITEMS);
  if (!items.length) throw new Error(`No items parsed from ${url}`);
  return items;
}

function loadExisting() {
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  } catch (e) {
    return { updated: null, world: [], regions: {} };
  }
}

async function main() {
  const existing = loadExisting();
  const output = {
    updated: new Date().toISOString(),
    world: existing.world || [],
    regions: existing.regions || {}
  };

  for (const [key, url] of Object.entries(FEEDS)) {
    try {
      const items = await fetchFeed(url);
      if (key === 'world') {
        output.world = items;
      } else {
        output.regions[key] = items;
      }
      console.log(`OK: ${key} (${items.length} items)`);
    } catch (e) {
      // Keep whatever was there before rather than wiping it out on a
      // transient failure of one feed.
      console.error(`FAILED: ${key} — ${e.message} (keeping previous data)`);
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log('Wrote', OUTPUT_PATH);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
