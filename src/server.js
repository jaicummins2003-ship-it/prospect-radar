// Prospect Radar — Cloudflare Worker (single file)
// One-tap sweep: Google Places finds the businesses, then the Worker finds emails,
// owner names and ad tags on each business's own website, in the background.
// Bindings / settings (see wrangler.toml):
//   DB           D1 database binding
//   GOOGLE_KEY   Secret: Google Places API (New) key
//   MONTHLY_CAP  Variable (optional): max Google search requests per month, default 900
//   DAILY_CAP    Variable (optional): max Google search requests per day, default 150
// Cron: every minute (background email hunting + nightly cleanup). CSV import still works as a backup.
// No login: anyone with the link can open it. The caps keep Google usage inside the free allowance.

const APP_HTML = __APP_HTML__;
const ICON_B64 = __ICON_B64__;

const DAY = 86400000;
const PLACES = "https://places.googleapis.com/v1";

// ---------------------------------------------------------------- niches & cities
const NICHES = [
  { name: "Med Spas", q: "med spa", why: "High margin, cash-pay, ad-hungry, fast booking cycle" },
  { name: "Botox & Filler Clinics", q: "cosmetic injectables clinic", why: "High margin cash-pay aesthetic, strong ad response" },
  { name: "Medical Weight Loss Clinics", q: "weight loss clinic", why: "Recurring cash-pay, aggressive marketers, fast intake" },
  { name: "Body Sculpting / CoolSculpting", q: "body sculpting clinic", why: "High-ticket cash-pay, thrives on paid ads" },
  { name: "Laser Hair Removal Studios", q: "laser hair removal", why: "High-ticket packages, cash-pay, ad-driven" },
  { name: "Dentists", q: "dentist", why: "High per-patient value, big ad budgets, steady local demand" },
  { name: "Roofers", q: "roofing contractor", why: "High ticket, urgent demand, big local TAM" },
  { name: "HVAC (Heating & Air)", q: "air conditioning installer", why: "High ticket, urgent + seasonal, strong ad ROI" },
  { name: "Water Damage Restoration", q: "water damage restoration", why: "Urgent high-ticket, insurance-funded, fast close" },
  { name: "Solar Panel Installers", q: "solar panel installer", why: "Very high ticket, pure lead-gen play" },
  { name: "Orthodontists", q: "orthodontist", why: "High-ticket cases, strong marketing spend" },
  { name: "Kitchen & Bath / General Remodelers", q: "kitchen and bathroom renovations", why: "High ticket, strong margins, visual marketing" },
  { name: "Pool Installers & Maintenance", q: "pool builder", why: "High ticket install + recurring service" },
  { name: "Real Estate Agents", q: "real estate agency", why: "High commission per deal, marketing-hungry" },
  { name: "Chiropractors", q: "chiropractor", why: "Recurring visits, established ad playbooks" },
  { name: "Cosmetic / Teeth Whitening Studios", q: "teeth whitening", why: "Cash-pay aesthetic, quick close" },
];

const CITIES = [
  { name: "Gold Coast", state: "QLD", areas: ["Southport", "Surfers Paradise", "Burleigh Heads", "Robina", "Coomera", "Nerang", "Palm Beach", "Helensvale", "Mermaid Waters", "Coolangatta"] },
  { name: "Brisbane", state: "QLD", areas: ["Brisbane City", "Chermside", "Carindale", "Indooroopilly", "Mt Gravatt", "Aspley", "Wynnum", "Stafford", "Sunnybank", "Kenmore"] },
  { name: "Sunshine Coast", state: "QLD", areas: ["Maroochydore", "Caloundra", "Noosa Heads", "Buderim", "Nambour", "Kawana Waters", "Coolum Beach"] },
  { name: "Logan", state: "QLD", areas: ["Springwood", "Beenleigh", "Browns Plains", "Logan Central", "Shailer Park", "Jimboomba"] },
  { name: "Ipswich", state: "QLD", areas: ["Ipswich", "Springfield", "Goodna", "Booval", "Redbank Plains"] },
  { name: "Moreton Bay", state: "QLD", areas: ["Redcliffe", "North Lakes", "Caboolture", "Strathpine", "Morayfield"] },
  { name: "Toowoomba", state: "QLD", areas: ["Toowoomba", "Highfields", "Harristown", "Wilsonton"] },
  { name: "Cairns", state: "QLD", areas: ["Cairns City", "Smithfield", "Edmonton", "Earlville", "Redlynch"] },
  { name: "Townsville", state: "QLD", areas: ["Townsville City", "Aitkenvale", "Kirwan", "Hyde Park", "Condon"] },
  { name: "Sydney", state: "NSW", areas: ["Sydney CBD", "Parramatta", "Chatswood", "Bondi Junction", "Penrith", "Liverpool", "Castle Hill", "Hurstville", "Brookvale", "Sutherland"] },
  { name: "Newcastle", state: "NSW", areas: ["Newcastle", "Charlestown", "Maitland", "Kotara", "Cardiff"] },
  { name: "Melbourne", state: "VIC", areas: ["Melbourne CBD", "Richmond", "Box Hill", "Dandenong", "Frankston", "Ringwood", "Werribee", "Essendon", "Glen Waverley", "Epping"] },
  { name: "Perth", state: "WA", areas: ["Perth CBD", "Joondalup", "Fremantle", "Midland", "Rockingham", "Cannington", "Osborne Park", "Morley"] },
  { name: "Adelaide", state: "SA", areas: ["Adelaide CBD", "Norwood", "Marion", "Salisbury", "Modbury", "Glenelg", "Mount Barker"] },
  { name: "Canberra", state: "ACT", areas: ["Canberra City", "Belconnen", "Woden", "Tuggeranong", "Gungahlin"] },
  { name: "Hobart", state: "TAS", areas: ["Hobart", "Glenorchy", "Kingston", "Rosny Park"] },
  { name: "Darwin", state: "NT", areas: ["Darwin City", "Casuarina", "Palmerston"] },
];

// ---------------------------------------------------------------- schema (self-migrating)
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sweeps (id INTEGER PRIMARY KEY AUTOINCREMENT, niche TEXT, city TEXT, state TEXT, query TEXT, areas TEXT, pages INTEGER, cursor INTEGER DEFAULT 0, status TEXT DEFAULT 'running', found INTEGER DEFAULT 0, requests INTEGER DEFAULT 0, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS leads (place_id TEXT PRIMARY KEY, name TEXT, address TEXT, suburb TEXT, phone TEXT, phone_intl TEXT, website TEXT, rating REAL, reviews INTEGER, google_at INTEGER,
     email TEXT, site_phone TEXT, owner TEXT, owner_source TEXT, owner_checked INTEGER DEFAULT 0, gads INTEGER, meta INTEGER, gtm INTEGER, builder TEXT,
     enrich_state TEXT DEFAULT 'pending', enrich_claimed INTEGER, enriched_at INTEGER, enrich_note TEXT,
     status TEXT DEFAULT 'new', notes TEXT DEFAULT '', follow_up TEXT, contacted_at INTEGER, updated_at INTEGER, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sweep_leads (sweep_id INTEGER, place_id TEXT, PRIMARY KEY (sweep_id, place_id))`,
  `CREATE TABLE IF NOT EXISTS usage (month TEXT, kind TEXT, count INTEGER DEFAULT 0, PRIMARY KEY (month, kind))`,
  `CREATE INDEX IF NOT EXISTS idx_leads_enrich ON leads(enrich_state)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`,
];
let migrated = false;
async function migrate(env) {
  if (migrated) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  for (const col of ["enrich_tries INTEGER DEFAULT 0", "email_ok INTEGER", "contact_url TEXT", "has_form INTEGER"]) {
    try { await env.DB.prepare("ALTER TABLE leads ADD COLUMN " + col).run(); } catch (e) { /* already there */ }
  }
  migrated = true;
}

// ---------------------------------------------------------------- helpers
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" } });
const err = (message, status = 400) => json({ error: message }, status);
const monthKey = () => new Date(Date.now() + 10 * 3600000).toISOString().slice(0, 7);
const dayKey = () => new Date(Date.now() + 10 * 3600000).toISOString().slice(0, 10); // Brisbane day
const cap = (env) => parseInt(env.MONTHLY_CAP || "900", 10) || 900;
const dayCap = (env) => parseInt(env.DAILY_CAP || "150", 10) || 150;
async function usage(env) {
  const { results } = await env.DB.prepare("SELECT month, kind, count FROM usage WHERE month IN (?, ?)").bind(monthKey(), dayKey()).all();
  const u = { search: 0, daySearch: 0 };
  for (const r of results) {
    if (r.kind !== "search") continue;
    if (r.month === monthKey()) u.search = r.count; else u.daySearch = r.count;
  }
  const mcap = cap(env), dcap = dayCap(env);
  return { month: monthKey(), search: u.search, cap: mcap, today: u.daySearch, dayCap: dcap,
    left: Math.max(0, Math.min(mcap - u.search, dcap - u.daySearch)), limitBy: mcap - u.search <= dcap - u.daySearch ? "month" : "day" };
}
async function addUsage(env, kind, n = 1) {
  const q = "INSERT INTO usage (month, kind, count) VALUES (?, ?, ?) ON CONFLICT(month, kind) DO UPDATE SET count = count + excluded.count";
  await env.DB.batch([env.DB.prepare(q).bind(monthKey(), kind, n), env.DB.prepare(q).bind(dayKey(), kind, n)]);
}

// ---------------------------------------------------------------- Google Places (reviews come back in the same call, so owner names cost nothing extra)
async function placesSearch(env, textQuery, pageToken) {
  const body = { textQuery, pageSize: 20, regionCode: "AU", languageCode: "en" };
  if (pageToken) body.pageToken = pageToken;
  const r = await fetch(`${env.PLACES_BASE || PLACES}/places:searchText`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": String(env.GOOGLE_KEY).trim(),
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.types,places.reviews,nextPageToken",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || `Google returned ${r.status}`;
    throw new Error(/API key not valid/i.test(msg) ? "Google says the API key isn't valid. Check the GOOGLE_KEY secret." : /not been used|disabled|PERMISSION_DENIED/i.test(msg) ? "Google refused the key. Check that Places API (New) is enabled and the key isn't restricted to websites or IPs." : msg);
  }
  return data;
}
function suburbOf(place) {
  const c = (place.addressComponents || []).find((x) => (x.types || []).includes("locality"));
  return c?.longText || c?.shortText || "";
}

// ---------------------------------------------------------------- does the email's domain accept mail? (MX lookup over DNS-over-HTTPS)
const mxCache = new Map();
async function domainTakesMail(email) {
  const dom = String(email || "").split("@")[1];
  if (!dom) return null;
  if (/^(gmail|outlook|hotmail|yahoo|icloud|bigpond|live|optusnet)\./.test(dom)) return 1;
  if (mxCache.has(dom)) return mxCache.get(dom);
  let ok = null;
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(dom)}&type=MX`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(4000) });
    const d = await r.json();
    ok = d.Status === 0 && (d.Answer || []).some((a) => a.type === 15) ? 1 : 0;
  } catch { ok = null; }
  mxCache.set(dom, ok);
  return ok;
}

function hashKey(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}
// A stable id per business: Google place id or Maps cid if the link has one, else name + phone.
function leadKey(row) {
  const prof = String(row.profile || "");
  const pid = prof.match(/place_id[:=]([A-Za-z0-9_-]{10,})/) || prof.match(/!19s([A-Za-z0-9_-]{10,})/);
  if (pid) return pid[1];
  const cid = prof.match(/[?&]cid=(\d+)/) || prof.match(/!1s0x[0-9a-f]+:(0x[0-9a-f]+)/i);
  if (cid) return "cid:" + cid[1];
  const phone = String(row.phone || "").replace(/\D/g, "").slice(-9);
  return "k:" + hashKey(String(row.name || "").toLowerCase().replace(/[^a-z0-9]/g, "") + "|" + phone);
}
function num(v) { const n = parseFloat(String(v ?? "").replace(/[^\d.]/g, "")); return isNaN(n) ? null : n; }
function normPhone(p) {
  let d = String(p || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+61")) d = "0" + d.slice(3);
  else if (d.startsWith("61") && d.length === 11) d = "0" + d.slice(2);
  if (/^04\d{8}$/.test(d)) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (/^0[2378]\d{8}$/.test(d)) return `(${d.slice(0, 2)}) ${d.slice(2, 6)} ${d.slice(6)}`;
  return String(p || "").trim();
}
function intlPhone(p) {
  const d = String(p || "").replace(/[^\d+]/g, "");
  if (/^0\d{9}$/.test(d)) return "+61" + d.slice(1);
  return d;
}

// ---------------------------------------------------------------- owner name from reviews
const NOT_NAMES = new Set(("the a an and but so we i he she they it this that these those our my his her their you your me us them great highly excellent amazing fantastic " +
  "thanks thank very would will could should just really also after before when then from with within without team service services job work roof roofs roofing roofer roofers " +
  "gutter gutters tiles tile repair repairs restoration quote quotes price prices professional friendly recommend recommended definitely absolutely " +
  "communication quality workmanship company business guys boys crew staff owner manager clinic dentist doctor dr nurse reception receptionist front desk " +
  "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december " +
  "gold coast brisbane sydney melbourne perth adelaide queensland qld nsw vic australia google maps five star stars everything nothing everyone anyone someone " +
  "overall first second last next again once today yesterday week weeks month months year years day days hour hours time times what why how who where which " +
  "not no yes all any some every each both few more most much many other another such only own same than too can did do does done had has have having is are was were be been " +
  "if as at by for in into of off on onto or out over to up upon about above across along around because between during through under until while " +
  "very well good best better nice lovely wonderful awesome outstanding brilliant super top happy pleased impressed extremely incredibly honestly genuinely " +
  "after sales customer customers client clients home house property new old big small").split(/\s+/));

const PLACE_WORDS = /^(Waters|Beach|Heads|Park|Coast|Island|Islands|Hill|Hills|Creek|Valley|Point|Bay|Street|St|Road|Rd|Roofing|Roofers|Roof|Repairs|Restorations|Plumbing|Electrical|Dental|Clinic|Group|Services|Solutions|City|Central|North|South|East|West|Lakes|Waters|Gardens|Vale|Downs|Plains|Ridge|Grove|Paradise|Springs)$/;
export function ownerFromReviews(reviews, businessName = "", address = "") {
  const banned = new Set(NOT_NAMES);
  for (const t of (businessName + " " + address).toLowerCase().split(/[^a-z]+/)) if (t) banned.add(t);
  const hits = new Map();
  const cue = /(?:\b(?:from|thanks|thank you|thankyou|with|to|by|called|contacted|and)\s+)$/i;
  const after = /^\s*(?:and (?:the|his|her) (?:team|crew|boys|guys)|and co\b|was|is|from|did|came|arrived|at\b|and team|'s team|’s team|,? (?:the owner|owner))/i;
  reviews.forEach((text, idx) => {
    const re = /\b([A-Z][a-z]{2,11})\b/g;
    let m;
    const seen = new Set();
    while ((m = re.exec(text))) {
      const w = m[1];
      if (banned.has(w.toLowerCase())) continue;
      const before = text.slice(Math.max(0, m.index - 16), m.index);
      const post = text.slice(m.index + w.length, m.index + w.length + 20);
      const nextCap = post.match(/^\s+([A-Z][a-z]+)/);
      if (nextCap && PLACE_WORDS.test(nextCap[1])) continue;
      const cued = cue.test(before) || after.test(post);
      const h = hits.get(w) || { reviews: new Set(), cued: 0 };
      if (!seen.has(w)) { h.reviews.add(idx); seen.add(w); }
      if (cued) h.cued++;
      hits.set(w, h);
    }
  });
  let best = null;
  for (const [name, h] of hits) {
    const n = h.reviews.size;
    const score = n * 2 + Math.min(h.cued, 3);
    if (n >= 2 && h.cued >= 1 && (!best || score > best.score)) best = { name, count: n, score };
  }
  return best ? { name: best.name, count: best.count, of: reviews.length } : null;
}

// ---------------------------------------------------------------- website enrichment (v2: finds hidden emails, follows contact links, reports blocks)
function siteDomain(u) {
  try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}
function decodeCfEmail(hex) {
  try {
    const key = parseInt(hex.slice(0, 2), 16);
    let out = "";
    for (let i = 2; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    return out;
  } catch { return ""; }
}
function decodeEntities(s) {
  return s.replace(/&#(\d{2,4});?/g, (m, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]{2,4});?/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
}
const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi;
const BAD_EMAIL = /(noreply|no-reply|donotreply|sentry|wixpress|@wordpress|@sentry|example\.(com|org)|@(domain|email|yourdomain|yoursite|website|company|test|sample)\.|\.(png|jpe?g|gif|webp|svg|css|js|pdf)$|@\dx\.)/i;
const PLACEHOLDER = /^(email|youremail|your-email|yourname|name|firstname|lastname|first\.last|firstname\.lastname|user|username|test|sample|demo|john|jane|johndoe|someone)@/i;
const PLATFORM_DOMAINS = /@(wix|squarespace|godaddy|shopify|weebly|mailchimp|hubspot|sendgrid|zendesk|wpengine|cloudflare|google|facebook|apple|microsoft|hotdoc|healthengine|centaurportal|1300smiles|dentally)\./i;
const FREE_MAIL = /@(gmail|bigpond|outlook|hotmail|yahoo|icloud|optusnet|live|me|iinet|tpg|internode)\./i;

function cleanEmail(e) {
  e = String(e || "").trim().toLowerCase();
  e = e.replace(/^(mailto:|%20|u003e|u0022|x22|3e|20)+/g, "").replace(/[.)\]>'"]+$/, "");
  return /^[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(e) ? e : "";
}

// Returns [{email, ctx, mailto}] — ctx is the text just before the email (for spotting "website by" credits).
export function collectEmails(html) {
  const out = [];
  const add = (raw, ctx, mailto) => {
    const e = cleanEmail(raw);
    if (e && !BAD_EMAIL.test(e) && !PLACEHOLDER.test(e)) out.push({ email: e, ctx: (ctx || "").toLowerCase(), mailto: !!mailto });
  };
  const lower = html.toLowerCase();
  // 1. Cloudflare email protection
  for (const anchor of ['data-cfemail="', "email-protection#"]) {
    let i = -1, n = 0;
    while ((i = lower.indexOf(anchor, i + 1)) !== -1 && n++ < 50) {
      const hex = (lower.slice(i + anchor.length, i + anchor.length + 200).match(/^[0-9a-f]+/) || [""])[0];
      if (hex.length >= 8) add(decodeCfEmail(hex), html.slice(Math.max(0, i - 250), i), true);
    }
  }
  // 2. Windows around anything that looks like an @ (plain, entity-encoded, url-encoded, [at])
  for (const anchor of ["@", "&#64", "&#x40", "%40", "[at]", "(at)", " at "]) {
    let i = -1, n = 0;
    while ((i = lower.indexOf(anchor, i + 1)) !== -1 && n < 600) {
      if (anchor === " at " && !/\s(dot|\[dot\]|\(dot\))\s/.test(lower.slice(i, i + 80))) continue;
      if (anchor === "@") {
        if (!/[a-z0-9._%+-]/.test(lower[i - 1] || "")) continue;
        const after = lower.slice(i + 1, i + 70).match(/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.([a-z]{2,24})/);
        if (!after || /^(png|jpe?g|gif|webp|svg|css|js|avif|ico|pdf|mp4|woff2?)$/.test(after[1])) continue;
      }
      n++;
      const start = Math.max(0, i - 200), end = Math.min(html.length, i + 400);
      let w = decodeEntities(html.slice(start, end));
      w = w.replace(/%40/gi, "@").replace(/\s*[\[\(]\s*at\s*[\]\)]\s*/gi, "@").replace(/\s*[\[\(]\s*dot\s*[\]\)]\s*/gi, ".")
        .replace(/(\w)\s+at\s+(\w[\w-]*)\s+dot\s+/gi, "$1@$2.").replace(/\s+dot\s+/gi, ".")
        .replace(/["']\s*;\s*(\w+)\s*=\s*\1\s*\+\s*["']/g, "").replace(/["']\s*\+\s*["']/g, "").replace(/["']\s*\+\s*\w+\s*\+\s*["']/g, "");
      for (const m of w.matchAll(EMAIL_RE)) if (!(end < html.length && m.index + m[0].length >= w.length - 1) && !(start > 0 && m.index === 0)) add(m[0], html.slice(Math.max(0, i - 250), i), /mailto:?$/i.test(w.slice(0, m.index).trim()) || w.slice(Math.max(0, m.index - 8), m.index).toLowerCase().includes("mailto"));
    }
  }
  // 3. JavaScript that builds the email: char arrays ['i','n','f','o','@',...] and String.fromCharCode(...)
  if (lower.includes("<script")) {
    for (const m of html.matchAll(/\[\s*(['"])[^'"\n]{0,2}\1(?:\s*,\s*(['"])[^'"\n]{0,2}\2){5,120}\s*\]/g)) {
      const s = [...m[0].matchAll(/(['"])([^'"\n]{0,2})\1/g)].map((x) => x[2]).join("");
      if (s.includes("@")) { add(s, html.slice(Math.max(0, m.index - 250), m.index), true); add(s.split("").reverse().join(""), "", true); }
    }
    for (const m of html.matchAll(/fromCharCode\(\s*((?:\d{2,3}\s*,\s*){5,}\d{2,3})\s*\)/g)) {
      const s = m[1].split(/\s*,\s*/).map((n) => String.fromCharCode(+n)).join("");
      if (s.includes("@")) add(s, "", true);
    }
    if (lower.includes("reverse()")) {
      let i = -1, n = 0;
      while ((i = lower.indexOf("reverse()", i + 1)) !== -1 && n++ < 20) {
        for (const lit of html.slice(Math.max(0, i - 300), i).matchAll(/(['"])([^'"\n]{6,80})\1/g)) {
          const r = lit[2].split("").reverse().join("");
          if (r.includes("@")) add(r, "", true);
        }
      }
    }
  }
  return out;
}

// Picks the best business email. "No email beats the wrong email."
export function pickEmail(cands, siteUrl, lead = {}) {
  if (!cands || !cands.length) return "";
  const dom = siteDomain(siteUrl);
  const credit = /(website|site|web design|designed|developed|built|powered|hosted|marketing|seo|digital agency|made)\s*(by|:)[^<]{0,80}$/;
  const tokens = [lead.suburb, ...(String(lead.name || "").split(/\s+/))].map((t) => String(t || "").toLowerCase().replace(/[^a-z]/g, "")).filter((t) => t.length >= 4 && !/dental|dentist|clinic|family|centre|center|care|group|studio|smile|smiles|gold|coast|roofing|roofers|repairs/.test(t));
  const suburbTok = String(lead.suburb || "").toLowerCase().replace(/[^a-z]/g, "");
  const scores = new Map();
  for (const c of cands) {
    const ed = c.email.split("@")[1];
    const same = dom && (ed === dom || ed.endsWith("." + dom) || dom.endsWith("." + ed));
    if (!same && (PLATFORM_DOMAINS.test(c.email) || credit.test(c.ctx.replace(/<[^>]*$/, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()))) continue; // web designer / platform credit
    let s = scores.get(c.email) ?? 0;
    if (!scores.has(c.email)) {
      const local = c.email.split("@")[0];
      if (same) s += 50;
      if (FREE_MAIL.test(c.email)) s += 4;
      if (/^(info|reception|hello|admin|contact|enquiries|enquiry|office|bookings?|appointments|frontdesk|team|practice|dental|smile|care)\b/.test(local)) s += 8;
      if (suburbTok && suburbTok.length >= 4 && (local.includes(suburbTok) || ed.includes(suburbTok))) s += 30;
      else if (tokens.some((t) => local.includes(t) || ed.includes(t))) s += 6;
    }
    s += c.mailto ? 6 : 2; // repeated sightings add up
    scores.set(c.email, s);
  }
  let best = "", bestS = -1;
  for (const [e, s] of scores) if (s > bestS) { best = e; bestS = s; }
  return best;
}

export function ownerFromSite(html) {
  const nameTok = "([A-Z][a-z]+(?:\\s+[A-Z]\\.?)?\\s+[A-Z][a-z]+)";
  const ci = (w) => w.replace(/\b([a-z])/g, (c) => `[${c.toUpperCase()}${c}]`);
  const pats = [
    new RegExp(ci("(?:owner|founder|co-?founder|proprietor|director|managing director|principal dentist|principal)") + "\\s*[:\\-–]\\s*(?:Dr\\.?\\s+)?" + nameTok),
    new RegExp(ci("(?:owned|founded|run|operated)") + "\\s+by\\s+(?:Dr\\.?\\s+)?" + nameTok),
    new RegExp("(?:Dr\\.?\\s+)?" + nameTok + "\\s*[,\\-–|]\\s*(?:[Oo]wner|[Ff]ounder|[Cc]o-?founder|[Pp]roprietor|[Dd]irector|[Pp]rincipal)\\b"),
  ];
  const lower = html.toLowerCase();
  let n = 0;
  const re = /owner|founder|proprietor|director|principal|owned by|run by|operated by/g;
  let m;
  while ((m = re.exec(lower)) && n++ < 60) {
    const w = html.slice(Math.max(0, m.index - 160), m.index + 160).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
    for (const p of pats) {
      const x = w.match(p);
      if (x && x[1] && !/\b(The|Our|Team|Company|Pty|Ltd|First|Last|John Doe|Jane Doe|Gold Coast|Dental|Clinic|Practice|Principal|Director|Owner)\b/.test(x[1])) return x[1].trim();
    }
  }
  return "";
}
export function adSignals(html) {
  return {
    gads: /AW-\d{6,}|googleadservices\.com\/pagead\/conversion|google_conversion_id/i.test(html) ? 1 : 0,
    meta: /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(\s*['"]init/i.test(html) ? 1 : 0,
    gtm: /GTM-[A-Z0-9]{4,}/.test(html) ? 1 : 0,
    builder: /wixstatic|wix\.com/i.test(html) ? "Wix" : /squarespace/i.test(html) ? "Squarespace" : /cdn\.shopify|shopify\.com/i.test(html) ? "Shopify" : /wp-content|wordpress/i.test(html) ? "WordPress" : /godaddy|img1\.wsimg/i.test(html) ? "GoDaddy" : "",
  };
}
export function sitePhone(html) {
  const m = html.match(/href=["']tel:([+\d\s()-]{8,20})["']/i);
  if (!m) return "";
  let d = m[1].replace(/[^\d+]/g, "");
  if (d.startsWith("+61")) d = "0" + d.slice(3);
  return /^0\d{9}$/.test(d) || /^1[38]00\d{6}$/.test(d) || /^13\d{4}$/.test(d) ? d : "";
}
// Same-site links that probably lead to contact details, best first.
export function contactLinks(html, pageUrl) {
  let base;
  try { base = new URL(pageUrl); } catch { return []; }
  const host = base.hostname.replace(/^www\./, "");
  const seen = new Set(), pri = [], sec = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#\s>]+)["']/gi)) {
    let u;
    try { u = new URL(decodeEntities(m[1]), base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== host) continue;
    if (/\.(jpe?g|png|gif|webp|svg|pdf|css|js|xml|ico|mp4|zip)$/i.test(u.pathname)) continue;
    u.hash = ""; u.search = "";
    const key = u.pathname.replace(/\/$/, "");
    if (seen.has(key) || key === base.pathname.replace(/\/$/, "")) continue;
    seen.add(key);
    if (/contact|enquir|get-in-touch|reach-us|find-us|talk-to-us/i.test(u.pathname)) pri.push(u.href);
    else if (/about|our-team|meet|location|book|appointment/i.test(u.pathname)) sec.push(u.href);
    if (pri.length >= 6) break;
  }
  return [...pri.slice(0, 3), ...sec.slice(0, 2)];
}

const BROWSER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-AU,en;q=0.9",
  "upgrade-insecure-requests": "1",
};
const CHALLENGE = /sgcaptcha|cf-browser-verification|challenge-platform|cf_chl_|just a moment\.\.\.|checking your browser|imunify360|bot protection|are you a robot|access denied|attention required|ddos protection|captcha/i;

async function fetchPage(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow", signal: AbortSignal.timeout(10000) });
    const type = r.headers.get("content-type") || "";
    let html = "";
    if (!type || type.includes("html") || type.includes("text")) {
      html = await r.text();
      if (html.length > 1500000) html = html.slice(0, 1500000);
    }
    const small = html.length < 40000;
    const blocked = [202, 401, 403, 406, 429, 503].includes(r.status) || (small && CHALLENGE.test(html.slice(0, 40000)));
    return { url: r.url || url, status: r.status, html: r.ok && !blocked ? html : "", len: html.length, blocked, down: r.status >= 500 && r.status !== 503, ms: Date.now() - t0 };
  } catch (e) {
    return { url, status: 0, html: "", len: 0, blocked: false, down: false, error: String(e && e.message || e).slice(0, 80), ms: Date.now() - t0 };
  }
}

async function enrichLead(lead, trace = null) {
  const out = { email: "", site_phone: "", owner: "", gads: null, meta: null, gtm: null, builder: "", note: "", contact_url: "", has_form: 0 };
  if (!lead.website) { out.note = "no website"; return out; }
  let home;
  try { home = new URL(lead.website); } catch { out.note = "bad website"; return out; }
  if (/facebook\.com|instagram\.com|linktr\.ee/i.test(home.hostname)) { out.note = "no website (social page only)"; return out; }
  const queue = [home.href];
  const done = new Set();
  let cands = [], fetched = 0, blocked = 0, down = 0, homeSeen = false;
  while (queue.length && done.size < 5) {
    const url = queue.shift();
    if (done.has(url)) continue;
    done.add(url);
    const p = await fetchPage(url);
    if (trace) trace.push({ url, status: p.status, len: p.len, blocked: p.blocked, ms: p.ms, error: p.error });
    if (p.blocked) blocked++;
    if (p.down) down++;
    if (!p.html) {
      if (!homeSeen && done.size === 1) { // homepage failed: still try the usual contact paths
        for (const path of ["/contact", "/contact-us"]) queue.push(`${home.protocol}//${home.host}${path}`);
      }
      continue;
    }
    fetched++;
    if (!homeSeen) {
      homeSeen = true;
      Object.assign(out, adSignals(p.html));
      const links = contactLinks(p.html, p.url);
      if (trace) trace.push({ links });
      queue.push(...links);
      if (!links.some((l) => /contact|enquir/i.test(l))) for (const path of ["/contact", "/contact-us", "/about"]) queue.push(`${home.protocol}//${home.host}${path}`);
    }
    const isContact = /contact|enquir|get-in-touch|reach-us|find-us/i.test(p.url);
    const form = /<form[\s\S]{0,4000}?(<textarea|type=["']?email)/i.test(p.html) || /wpcf7|gform_wrapper|elementor-form|nf-form|hs-form|wix-form|formspree|jotform|typeform/i.test(p.html);
    if (form && (!out.has_form || (isContact && !/contact|enquir/i.test(out.contact_url)))) { out.has_form = 1; out.contact_url = p.url; }
    else if (isContact && !out.contact_url) out.contact_url = p.url;
    const found = collectEmails(p.html);
    if (trace && found.length) trace.push({ found: [...new Set(found.map((f) => f.email))].slice(0, 8) });
    cands.push(...found);
    if (!out.site_phone) out.site_phone = sitePhone(p.html);
    if (!out.owner) out.owner = ownerFromSite(p.html);
    const best = pickEmail(cands, lead.website, lead);
    const dom = siteDomain(lead.website);
    if (best && (best.endsWith("@" + dom) || best.endsWith("." + dom) || done.size >= 2) && (out.owner || done.size >= 2)) break;
  }
  out.email = pickEmail(cands, lead.website, lead);
  if (!fetched) out.note = blocked ? "site blocks the email finder" : down ? "site is down" : "site didn't load";
  else if (!out.email) out.note = blocked ? "no email found (some pages blocked)" : "no email on site";
  return out;
}

async function enrichNext(env, max = 1, sweepId = null) {
  const now = Date.now();
  // A lead whose scan crashed 3 times (usually a huge page) is given up on instead of retried forever.
  await env.DB.prepare("UPDATE leads SET enrich_state = 'done', enrich_note = 'site too heavy to scan' WHERE enrich_state = 'working' AND enrich_claimed < ? AND enrich_tries >= 3").bind(now - 3 * 60000).run();
  await env.DB.prepare("UPDATE leads SET enrich_state = 'pending' WHERE enrich_state = 'working' AND enrich_claimed < ?").bind(now - 3 * 60000).run();
  const where = sweepId ? "AND place_id IN (SELECT place_id FROM sweep_leads WHERE sweep_id = ?)" : "";
  const stmt = env.DB.prepare(`UPDATE leads SET enrich_state = 'working', enrich_claimed = ?, enrich_tries = COALESCE(enrich_tries, 0) + 1 WHERE place_id IN (SELECT place_id FROM leads WHERE enrich_state = 'pending' ${where} ORDER BY created_at LIMIT ?) RETURNING place_id, name, website, suburb`);
  const { results } = await (sweepId ? stmt.bind(now, sweepId, max) : stmt.bind(now, max)).all();
  await Promise.all(results.map(async (lead) => {
    const r = await enrichLead(lead);
    const emailOk = r.email ? await domainTakesMail(r.email) : null;
    await env.DB.prepare(`UPDATE leads SET enrich_state = 'done', enrich_tries = 0, enriched_at = ?, enrich_note = CASE WHEN ? LIKE 'no email%' AND email != '' THEN '' ELSE ? END, email = CASE WHEN ? != '' THEN ? ELSE email END,
        email_ok = CASE WHEN ? != '' THEN ? ELSE email_ok END, contact_url = ?, has_form = ?, site_phone = ?, gads = ?, meta = ?, gtm = ?, builder = ?,
        owner = CASE WHEN (owner IS NULL OR owner = '') AND ? != '' THEN ? ELSE owner END,
        owner_source = CASE WHEN (owner IS NULL OR owner = '') AND ? != '' THEN 'website' ELSE owner_source END
        WHERE place_id = ?`)
      .bind(Date.now(), r.note, r.note, r.email, r.email, r.email, emailOk, r.contact_url || null, r.has_form, r.site_phone, r.gads, r.meta, r.gtm, r.builder, r.owner, r.owner, r.owner, lead.place_id).run();
  }));
  let q = "SELECT COUNT(*) AS n FROM leads WHERE enrich_state != 'done'";
  const remaining = sweepId
    ? await env.DB.prepare(q + " AND place_id IN (SELECT place_id FROM sweep_leads WHERE sweep_id = ?)").bind(sweepId).first("n")
    : await env.DB.prepare(q).first("n");
  return { processed: results.length, remaining };
}

// ---------------------------------------------------------------- cleanup (untouched leads expire after 30 days)
async function cleanup(env) {
  const cutoff = Date.now() - 30 * DAY;
  // Untouched leads older than 30 days are removed entirely.
  await env.DB.prepare("DELETE FROM sweep_leads WHERE place_id IN (SELECT place_id FROM leads WHERE status = 'new' AND (notes IS NULL OR notes = '') AND google_at < ?)").bind(cutoff).run();
  await env.DB.prepare("DELETE FROM leads WHERE status = 'new' AND (notes IS NULL OR notes = '') AND google_at < ?").bind(cutoff).run();
  // Leads you've worked keep your own data; Google-sourced fields are cleared (refresh re-pulls them).
  await env.DB.prepare("UPDATE leads SET address = NULL, phone = NULL, phone_intl = NULL, rating = NULL, reviews = NULL WHERE google_at < ? AND address IS NOT NULL").bind(cutoff).run();
}

// ---------------------------------------------------------------- API
const LEAD_COLS = "l.place_id, l.name, l.address, l.suburb, l.phone, l.phone_intl, l.website, l.rating, l.reviews, l.google_at, l.email, l.email_ok, l.contact_url, l.has_form, l.site_phone, l.owner, l.owner_source, l.owner_checked, l.gads, l.meta, l.gtm, l.builder, l.enrich_state, l.enrich_note, l.status, l.notes, l.follow_up, l.contacted_at, l.updated_at";

async function api(request, env, path) {
  const method = request.method;
  let m;

  if (path === "/api/config" && method === "GET") {
    return json({ niches: NICHES, cities: CITIES, usage: await usage(env), hasKey: !!env.GOOGLE_KEY });
  }

  if (path === "/api/sweeps" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, niche, city, state, status, found, requests, created_at, (SELECT COUNT(*) FROM sweep_leads s WHERE s.sweep_id = sweeps.id) AS leads FROM sweeps ORDER BY id DESC LIMIT 30").all();
    return json({ sweeps: results });
  }

  if (path === "/api/sweeps" && method === "POST") {
    if (!env.GOOGLE_KEY) return err("The Google key isn't set yet. Add GOOGLE_KEY as a secret on the Worker.", 400);
    const b = await request.json().catch(() => ({}));
    const niche = NICHES.find((n) => n.name === b.niche);
    const city = CITIES.find((c) => c.name === b.city) || (b.city ? { name: String(b.city).slice(0, 60), state: String(b.state || "").slice(0, 10), areas: [] } : null);
    const areas = [...new Set((Array.isArray(b.areas) ? b.areas : []).map((a) => String(a).trim().slice(0, 60)).filter(Boolean))].slice(0, 15);
    const pages = Math.min(3, Math.max(1, parseInt(b.pages, 10) || 2));
    if (!niche || !city || !areas.length) return err("Pick a niche, a city and at least one area.");
    const u = await usage(env);
    const need = areas.length * pages;
    if (need > u.left) return err(`This sweep could use up to ${need} Google requests, and only ${u.left} are left ${u.limitBy === "day" ? "today" : "this month"}. Pick fewer areas or less depth.`);
    const r = await env.DB.prepare("INSERT INTO sweeps (niche, city, state, query, areas, pages, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(niche.name, city.name, city.state, niche.q, JSON.stringify(areas), pages, Date.now()).first();
    return json({ id: r.id, areas: areas.length });
  }

  if ((m = path.match(/^\/api\/sweeps\/(\d+)\/step$/)) && method === "POST") {
    const id = +m[1];
    const s = await env.DB.prepare("SELECT * FROM sweeps WHERE id = ?").bind(id).first();
    if (!s) return err("Sweep not found", 404);
    const areas = JSON.parse(s.areas || "[]");
    if (s.status !== "running" || s.cursor >= areas.length) {
      if (s.status === "running") await env.DB.prepare("UPDATE sweeps SET status = 'done' WHERE id = ?").bind(id).run();
      return json({ done: true, cursor: areas.length, total: areas.length, found: s.found, usage: await usage(env) });
    }
    // claim this area so two open tabs can't search it twice
    const claim = await env.DB.prepare("UPDATE sweeps SET cursor = cursor + 1 WHERE id = ? AND cursor = ? RETURNING cursor").bind(id, s.cursor).first();
    if (!claim) return json({ done: false, busy: true, cursor: s.cursor, total: areas.length, found: s.found, usage: await usage(env) });
    const area = areas[s.cursor];
    const textQuery = `${s.query} in ${area}${s.state ? " " + s.state : ""}`;
    let token = null, page = 0, requests = 0, added = 0, stoppedForCap = false, googleError = "";
    const now = Date.now();
    do {
      const u = await usage(env);
      if (u.left <= 0) { stoppedForCap = true; break; }
      let data;
      try { data = await placesSearch(env, textQuery, token); }
      catch (e) { googleError = e.message; break; }
      finally { requests++; await addUsage(env, "search"); }
      const places = (data.places || []).filter((p) => p.id && p.businessStatus !== "CLOSED_PERMANENTLY");
      const stmts = [];
      for (const p of places) {
        const name = p.displayName?.text || "Unnamed";
        const reviews = (p.reviews || []).map((rv) => rv?.text?.text || rv?.originalText?.text || "").filter(Boolean);
        const own = ownerFromReviews(reviews, name, p.formattedAddress || "");
        const owner = own ? own.name : "", ownerSrc = own ? `named in ${own.count} of ${own.of} reviews` : "";
        stmts.push(env.DB.prepare(`INSERT INTO leads (place_id, name, address, suburb, phone, phone_intl, website, rating, reviews, google_at, owner, owner_source, owner_checked, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(place_id) DO UPDATE SET name = excluded.name, address = excluded.address, suburb = excluded.suburb, phone = excluded.phone, phone_intl = excluded.phone_intl,
              website = excluded.website, rating = excluded.rating, reviews = excluded.reviews, google_at = excluded.google_at,
              owner = CASE WHEN leads.owner IS NULL OR leads.owner = '' THEN excluded.owner ELSE leads.owner END,
              owner_source = CASE WHEN leads.owner IS NULL OR leads.owner = '' THEN excluded.owner_source ELSE leads.owner_source END,
              enrich_state = CASE WHEN leads.website IS NOT excluded.website THEN 'pending' ELSE leads.enrich_state END`)
          .bind(p.id, name, p.formattedAddress || "", suburbOf(p), p.nationalPhoneNumber || "", p.internationalPhoneNumber || "", p.websiteUri || "",
            p.rating ?? null, p.userRatingCount ?? null, now, owner, ownerSrc, now, now));
        stmts.push(env.DB.prepare("INSERT OR IGNORE INTO sweep_leads (sweep_id, place_id) VALUES (?, ?)").bind(id, p.id));
      }
      if (stmts.length) await env.DB.batch(stmts);
      added += places.length;
      token = data.nextPageToken || null;
      page++;
    } while (token && page < s.pages);

    const found = await env.DB.prepare("SELECT COUNT(*) AS n FROM sweep_leads WHERE sweep_id = ?").bind(id).first("n");
    const cursor = s.cursor + 1;
    const fatal = !!googleError && added === 0 && s.cursor === 0;
    const done = cursor >= areas.length || stoppedForCap || fatal;
    await env.DB.prepare("UPDATE sweeps SET found = ?, requests = requests + ?, status = ? WHERE id = ?").bind(found, requests, done ? "done" : "running", id).run();
    return json({ done, area, cursor, total: areas.length, found, added, stoppedForCap, googleError, usage: await usage(env) });
  }

  if (path === "/api/import" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    const niche = String(b.niche || "Leads").slice(0, 80);
    const city = String(b.city || "").slice(0, 60);
    const state = String(b.state || "").slice(0, 10);
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 2000).filter((r) => r && String(r.name || "").trim());
    if (!rows.length) return err("No businesses found in that file. It needs at least a Name column.");
    const now = Date.now();
    const sw = await env.DB.prepare("INSERT INTO sweeps (niche, city, state, query, areas, pages, status, created_at) VALUES (?, ?, ?, 'import', '[]', 0, 'done', ?) RETURNING id")
      .bind(niche, city, state, now).first();
    const seen = new Set();
    let stmts = [];
    const flush = async () => { if (stmts.length) { await env.DB.batch(stmts); stmts = []; } };
    for (const r of rows) {
      const key = leadKey(r);
      if (seen.has(key)) continue;
      seen.add(key);
      let website = String(r.website || "").trim();
      if (/google\.[a-z.]+\/aclk/i.test(website)) website = "";
      if (website && !/^https?:\/\//i.test(website)) website = "https://" + website;
      const phone = normPhone(r.phone);
      const email = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(String(r.email || "").trim()) ? String(r.email).trim().toLowerCase() : "";
      const owner = String(r.owner || "").trim().slice(0, 60);
      stmts.push(env.DB.prepare(`INSERT INTO leads (place_id, name, address, suburb, phone, phone_intl, website, rating, reviews, google_at, email, owner, owner_source, owner_checked, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(place_id) DO UPDATE SET name = excluded.name,
            address = COALESCE(NULLIF(excluded.address, ''), leads.address), suburb = COALESCE(NULLIF(excluded.suburb, ''), leads.suburb),
            phone = COALESCE(NULLIF(excluded.phone, ''), leads.phone), phone_intl = COALESCE(NULLIF(excluded.phone_intl, ''), leads.phone_intl),
            website = COALESCE(NULLIF(excluded.website, ''), leads.website), rating = COALESCE(excluded.rating, leads.rating), reviews = COALESCE(excluded.reviews, leads.reviews),
            google_at = excluded.google_at, email = COALESCE(NULLIF(excluded.email, ''), leads.email),
            owner = COALESCE(NULLIF(excluded.owner, ''), leads.owner), owner_source = COALESCE(NULLIF(excluded.owner_source, ''), leads.owner_source),
            enrich_state = CASE WHEN leads.website IS NOT COALESCE(NULLIF(excluded.website, ''), leads.website) THEN 'pending' ELSE leads.enrich_state END`)
        .bind(key, String(r.name).trim().slice(0, 120), String(r.address || "").slice(0, 200), String(r.suburb || "").slice(0, 60), phone, intlPhone(phone), website,
          num(r.rating), r.reviews === "" || r.reviews == null ? null : Math.round(num(r.reviews) ?? 0), now, email, owner, owner ? String(r.owner_source || "from import").slice(0, 80) : "", now, now));
      stmts.push(env.DB.prepare("INSERT OR IGNORE INTO sweep_leads (sweep_id, place_id) VALUES (?, ?)").bind(sw.id, key));
      if (stmts.length >= 80) await flush();
    }
    await flush();
    await env.DB.prepare("UPDATE sweeps SET found = ? WHERE id = ?").bind(seen.size, sw.id).run();
    return json({ id: sw.id, imported: seen.size });
  }

  if ((m = path.match(/^\/api\/sweeps\/(\d+)\/leads$/)) && method === "GET") {
    const { results } = await env.DB.prepare(`SELECT ${LEAD_COLS} FROM leads l JOIN sweep_leads s ON s.place_id = l.place_id WHERE s.sweep_id = ?`).bind(+m[1]).all();
    const sweep = await env.DB.prepare("SELECT id, niche, city, state, status, found, created_at FROM sweeps WHERE id = ?").bind(+m[1]).first();
    return json({ sweep, leads: results });
  }

  if ((m = path.match(/^\/api\/sweeps\/(\d+)$/)) && method === "DELETE") {
    const id = +m[1];
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sweep_leads WHERE sweep_id = ?").bind(id),
      env.DB.prepare("DELETE FROM sweeps WHERE id = ?").bind(id),
      env.DB.prepare("DELETE FROM leads WHERE status = 'new' AND (notes IS NULL OR notes = '') AND place_id NOT IN (SELECT place_id FROM sweep_leads)"),
    ]);
    return json({ ok: true });
  }

  if ((m = path.match(/^\/api\/sweeps\/(\d+)\/rehunt$/)) && method === "POST") {
    const r = await env.DB.prepare("UPDATE leads SET enrich_state = 'pending', enrich_tries = 0 WHERE (email IS NULL OR email = '') AND website != '' AND place_id IN (SELECT place_id FROM sweep_leads WHERE sweep_id = ?)").bind(+m[1]).run();
    return json({ queued: r.meta?.changes ?? 0 });
  }

  if (path === "/api/google-test" && method === "GET") {
    // Diagnoses the Google key without revealing it: tries a tiny search with a few field sets.
    if (!env.GOOGLE_KEY) return err("No GOOGLE_KEY secret");
    const out = { keyLength: env.GOOGLE_KEY.length, keyShape: /^AIza[0-9A-Za-z_-]{35}$/.test(env.GOOGLE_KEY.trim()) ? "looks like a Google key" : "unexpected format", trimmedDiffers: env.GOOGLE_KEY !== env.GOOGLE_KEY.trim() };
    for (const mask of ["places.id", "places.id,places.rating,places.websiteUri", "places.id,places.reviews"]) {
      const r = await fetch(`${PLACES}/places:searchText`, { method: "POST", headers: { "content-type": "application/json", "X-Goog-Api-Key": env.GOOGLE_KEY.trim(), "X-Goog-FieldMask": mask }, body: JSON.stringify({ textQuery: "dentist in Southport QLD", pageSize: 1 }) });
      const d = await r.json().catch(() => ({}));
      out[mask] = r.ok ? { ok: true, count: (d.places || []).length } : { status: r.status, message: d?.error?.message, reason: (d?.error?.details || []).map((x) => x.reason || x["@type"]).join(","), meta: (d?.error?.details || []).map((x) => x.metadata).filter(Boolean) };
    }
    await addUsage(env, "search", 3);
    return json(out);
  }

  if (path === "/api/debug" && method === "GET") {
    // Shows what the email finder sees for one of YOUR leads (only websites already in your list).
    const id = new URL(request.url).searchParams.get("lead") || "";
    const lead = await env.DB.prepare("SELECT place_id, name, website, suburb FROM leads WHERE place_id = ?").bind(id).first();
    if (!lead) return err("Lead not found", 404);
    const trace = [];
    const r = await enrichLead(lead, trace);
    return json({ lead: lead.name, website: lead.website, result: r, trace });
  }

  if (path === "/api/enrich-next" && method === "POST") {
    const url = new URL(request.url);
    const sweep = parseInt(url.searchParams.get("sweep") || "", 10) || null;
    return json(await enrichNext(env, 1, sweep));
  }

  if ((m = path.match(/^\/api\/leads\/([^/]+)$/)) && method === "PATCH") {
    const id = decodeURIComponent(m[1]);
    const b = await request.json().catch(() => ({}));
    const allowed = ["new", "contacted", "replied", "booked", "dead"];
    const cur = await env.DB.prepare("SELECT status, contacted_at FROM leads WHERE place_id = ?").bind(id).first();
    if (!cur) return err("Lead not found", 404);
    const status = allowed.includes(b.status) ? b.status : cur.status;
    const notes = typeof b.notes === "string" ? b.notes.slice(0, 4000) : null;
    const follow = b.follow_up === null || b.follow_up === "" ? "" : typeof b.follow_up === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.follow_up) ? b.follow_up : undefined;
    const contacted = status !== "new" && !cur.contacted_at ? Date.now() : cur.contacted_at;
    await env.DB.prepare(`UPDATE leads SET status = ?, notes = COALESCE(?, notes), follow_up = CASE WHEN ? THEN ? ELSE follow_up END, contacted_at = ?, updated_at = ? WHERE place_id = ?`)
      .bind(status, notes, follow === undefined ? 0 : 1, follow ?? null, contacted ?? null, Date.now(), id).run();
    return json(await env.DB.prepare(`SELECT ${LEAD_COLS} FROM leads l WHERE place_id = ?`).bind(id).first());
  }

  if (path === "/api/pipeline" && method === "GET") {
    const url = new URL(request.url);
    const today = url.searchParams.get("today") || new Date().toISOString().slice(0, 10);
    const { results: counts } = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM leads GROUP BY status").all();
    const { results: due } = await env.DB.prepare(`SELECT ${LEAD_COLS} FROM leads l WHERE follow_up IS NOT NULL AND follow_up != '' AND follow_up <= ? AND status NOT IN ('booked','dead') ORDER BY follow_up LIMIT 100`).bind(today).all();
    const { results: recent } = await env.DB.prepare(`SELECT ${LEAD_COLS} FROM leads l WHERE status != 'new' ORDER BY updated_at DESC LIMIT 50`).all();
    return json({ counts, due, recent, today });
  }

  return err("Not found", 404);
}

// ---------------------------------------------------------------- entry points
function setupPage() {
  return new Response(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Prospect Radar</title><body style="margin:0;background:#14100C;color:#EDE4D8;font:16px system-ui;padding:32px"><h1 style="font-size:20px;letter-spacing:.1em">PROSPECT <span style="color:#E0793F">RADAR</span></h1><p>Almost there. Connect the D1 database to this Worker with the variable name DB, then reload.</p></body>`,
    { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/manifest.webmanifest") {
      return new Response(JSON.stringify({ name: "Prospect Radar", short_name: "Radar", start_url: "/", display: "standalone", background_color: "#14100C", theme_color: "#14100C", icons: [{ src: "/icon.png", sizes: "128x128", type: "image/png" }] }), { headers: { "content-type": "application/manifest+json" } });
    }
    if (url.pathname === "/icon.png") {
      return new Response(Uint8Array.from(atob(ICON_B64), (c) => c.charCodeAt(0)), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
    }
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain" } });
    if (!env.DB) return url.pathname.startsWith("/api/") ? err("The D1 database isn't bound. Add a D1 binding named DB.", 503) : setupPage();
    await migrate(env);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(request, env, url.pathname); }
      catch (e) { return err(e.message || "Something went wrong", 500); }
    }
    return new Response(APP_HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" } });
  },

  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    await migrate(env);
    const d = new Date();
    if (d.getUTCHours() === 17 && d.getUTCMinutes() === 0) await cleanup(env);
    await enrichNext(env, 3);
  },
};
