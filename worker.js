// Prospect Radar — Cloudflare Worker (single file)
// One-tap sweep: Google Places finds the businesses, then the Worker finds emails,
// owner names and ad tags on each business's own website, in the background.
// Bindings / settings (see wrangler.toml):
//   DB           D1 database binding
//   GOOGLE_KEY   Secret: Google Places API (New) key
//   MONTHLY_CAP  Variable (optional): max Google search requests per month, default 3300 (about US$100 a month past the free 1,000)
//   DAILY_CAP    Variable (optional): max Google search requests per day, default 1200
// Cron: every minute (background email hunting + nightly cleanup). CSV import still works as a backup.
// No login: anyone with the link can open it. The caps keep Google usage inside the free allowance.

const APP_HTML = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">\n<meta name=\"theme-color\" content=\"#14100C\">\n<meta name=\"robots\" content=\"noindex,nofollow\">\n<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">\n<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"black-translucent\">\n<meta name=\"apple-mobile-web-app-title\" content=\"Radar\">\n<link rel=\"manifest\" href=\"/manifest.webmanifest\">\n<link rel=\"apple-touch-icon\" href=\"/icon.png\">\n<link rel=\"icon\" href=\"/icon.png\">\n<title>Prospect Radar</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap\" rel=\"stylesheet\">\n<style>\n:root{--bg:#14100C;--panel:#1E1813;--panel2:#271F17;--line:#3A2E22;--ink:#EDE4D8;--ghost:#A39280;--faint:#8A7A68;--radar:#E0793F;--radar-d:#C8622A;--steel:#8FAAC2;--bad:#E57A6A;\n--disp:'Oswald',sans-serif;--body:'IBM Plex Sans',system-ui,sans-serif;--mono:'JetBrains Mono',ui-monospace,monospace;--safe-b:env(safe-area-inset-bottom,0px);--safe-t:env(safe-area-inset-top,0px)}\n*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}\nhtml,body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);font-size:15px}\nbody{min-height:100vh;padding-top:var(--safe-t)}\na{color:inherit;text-decoration:none}\nbutton{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}\ninput,select,textarea{font:inherit;color:var(--ink)}\n.wrap{max-width:560px;margin:0 auto;padding:0 16px calc(96px + var(--safe-b))}\n.mono{font-family:var(--mono)}\n.lbl{font-family:var(--mono);font-size:10px;letter-spacing:.18em;color:var(--ghost);text-transform:uppercase;margin:0 0 8px}\n.muted{color:var(--ghost);font-size:12px;line-height:1.45}\nheader.top{display:flex;align-items:center;justify-content:space-between;padding:20px 4px 14px}\n.brand{font-family:var(--disp);font-weight:700;font-size:19px;letter-spacing:.14em;text-transform:uppercase}\n.brand span{color:var(--radar)}\n.sub{font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--ghost);text-transform:uppercase;margin-top:3px}\n.scope{width:34px;height:34px;border-radius:50%;border:1.5px solid #6E4A32;position:relative;overflow:hidden;flex-shrink:0}\n.scope::before{content:\"\";position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,rgba(224,121,63,.55),transparent 60%);animation:sw 3s linear infinite}\n@keyframes sw{to{transform:rotate(360deg)}}\n@media (prefers-reduced-motion:reduce){.scope::before,.radar::before{animation:none}}\n.field{width:100%;min-height:52px;border:1px solid var(--line);background:var(--panel);border-radius:6px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 14px;text-align:left;font-size:15px}\n.field .ph{color:var(--ghost)}\n.stack{display:flex;flex-direction:column;gap:20px}\n.chips{display:flex;flex-wrap:wrap;gap:8px}\n.chip{display:inline-flex;align-items:center;min-height:38px;padding:0 14px;border-radius:19px;font-size:13px;border:1px solid var(--line);white-space:nowrap}\n.chip[aria-pressed=true]{background:var(--radar-d);border-color:var(--radar-d);color:var(--bg);font-weight:600}\n.scroll-x{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}\n.scroll-x::-webkit-scrollbar{display:none}\n.row{display:flex;gap:8px;align-items:center}\n.input{flex:1;min-height:44px;border:1px solid var(--line);background:var(--bg);border-radius:6px;padding:0 12px;font-size:14px;min-width:0}\n.btn-sm{min-height:44px;padding:0 16px;border:1px solid var(--line);border-radius:6px;background:var(--panel2);font-size:13px}\n.seg{display:flex;gap:6px}\n.seg button{flex:1;min-height:42px;border-radius:6px;border:1px solid var(--line);font-size:13px}\n.seg button[aria-pressed=true]{background:var(--radar-d);border-color:var(--radar-d);color:var(--bg);font-weight:600}\n.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 16px}\n.meter{height:4px;border-radius:2px;background:var(--line);overflow:hidden}\n.meter>div{height:100%;background:var(--radar);border-radius:2px;transition:width .3s}\n.cta{width:100%;min-height:56px;border-radius:6px;background:var(--radar);color:var(--bg);font-family:var(--disp);font-weight:700;font-size:17px;letter-spacing:.2em;text-transform:uppercase}\n.cta:disabled{opacity:.45}\n.cta.ghost{background:transparent;border:1px solid var(--radar);color:var(--radar);font-size:15px;min-height:52px}\n.err{border:1px solid #7A3B30;background:rgba(229,122,106,.08);color:#F2B3A8;border-radius:6px;padding:10px 12px;font-size:13px;line-height:1.4}\n.stats{display:flex;gap:8px}\n.stat{flex:1;min-width:0}\n.stat .n{font-family:var(--disp);font-weight:700;font-size:26px;line-height:1}\n.stat .k{font-family:var(--mono);font-size:9px;letter-spacing:.14em;color:var(--ghost);text-transform:uppercase;margin-top:5px}\n.stat.prime .n{color:var(--radar)}.stat.leader .n{color:var(--steel)}\n.cards{display:flex;flex-direction:column;gap:10px}\n.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 14px 12px 16px}\n.card.prime{box-shadow:inset 3px 0 0 var(--radar-d)}\n.card.dim{opacity:.74}\n.card .hd{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;width:100%;text-align:left}\n.card .nm{font-weight:600;font-size:15px;line-height:1.25}\n.metaline{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px;font-family:var(--mono);font-size:11px;color:var(--ghost)}\n.metaline .v{color:var(--ink)}\n.band{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;padding:4px 8px;border-radius:3px;white-space:nowrap}\n.band.prime{background:var(--radar-d);color:var(--bg);font-weight:700}\n.band.work{border:1px solid var(--ghost)}\n.band.leader{border:1px solid var(--steel);color:var(--steel)}\n.band.thin{border:1px dashed var(--ghost);color:var(--ghost)}\n.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px}\n.tag{font-size:11px;padding:3px 8px;border-radius:12px;border:1px solid var(--line);color:var(--ghost);white-space:nowrap}\n.tag.opp{color:var(--radar);border-color:#6E4A32;background:rgba(224,121,63,.08)}\n.askfor{font-size:12px;color:var(--ghost);margin-top:6px}.askfor b{color:var(--ink)}\n.bar{position:relative;height:5px;border-radius:3px;background:var(--line);margin:12px 0 4px}\n.bar .f{position:absolute;left:0;top:0;bottom:0;border-radius:3px}\n.bar .t{position:absolute;top:-3px;width:2px;height:11px;background:var(--ink)}\n.barlbl{display:flex;justify-content:space-between;font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:var(--ghost);text-transform:uppercase}\n.acts{display:flex;gap:8px;margin-top:12px;align-items:center}\n.ib{width:44px;height:44px;border-radius:6px;border:1px solid var(--line);background:var(--panel2);display:flex;align-items:center;justify-content:center;flex-shrink:0}\n.ib[aria-disabled=true]{opacity:.35;pointer-events:none}\n.acts .st{font-family:var(--mono);font-size:10px;color:var(--ghost);letter-spacing:.06em;margin-left:4px;flex:1;min-width:0}\n.acts .more{min-width:44px;height:44px;display:flex;align-items:center;justify-content:center;color:var(--ghost)}\nnav.tabs{position:fixed;left:0;right:0;bottom:0;background:var(--panel);border-top:1px solid var(--line);display:flex;padding:0 12px var(--safe-b);z-index:5}\nnav.tabs button{flex:1;height:68px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;color:var(--ghost)}\nnav.tabs button[aria-current=page]{color:var(--radar)}\nnav.tabs span{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase}\n.overlay{position:fixed;inset:0;background:rgba(10,7,4,.72);z-index:10;display:flex;align-items:flex-end;justify-content:center}\n.sheet{width:100%;max-width:560px;max-height:calc(100vh - 48px);overflow-y:auto;background:var(--panel);border-top:1px solid #4A3826;border-radius:16px 16px 0 0;padding:10px 20px calc(24px + var(--safe-b));overscroll-behavior:contain}\n.grab{width:40px;height:4px;border-radius:2px;background:var(--line);margin:0 auto 12px}\n.sheethd{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}\n.sheethd h2{margin:0;font-family:var(--disp);font-weight:600;font-size:17px;letter-spacing:.12em;text-transform:uppercase}\n.x{width:44px;height:44px;display:flex;align-items:center;justify-content:center;color:var(--ghost)}\n.opt{width:100%;display:flex;align-items:center;gap:14px;padding:11px 4px;min-height:58px;border-bottom:1px solid var(--line);text-align:left}\n.opt .dot{width:22px;height:22px;border-radius:50%;border:1.5px solid var(--line);flex-shrink:0;display:flex;align-items:center;justify-content:center}\n.opt[aria-selected=true] .dot{background:var(--radar-d);border-color:var(--radar-d)}\n.big{display:flex;gap:8px;margin:16px 0 6px}\n.big a,.big button{flex:1;height:58px;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;font-size:11px;border:1px solid var(--line);background:var(--panel2)}\n.big .p{background:var(--radar);color:var(--bg);border-color:var(--radar);font-weight:600}\n.big [aria-disabled=true]{opacity:.35;pointer-events:none}\n.kv{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--line);font-size:13px}\n.kv .k{font-family:var(--mono);font-size:10px;letter-spacing:.14em;color:var(--ghost);text-transform:uppercase;padding-top:2px;flex-shrink:0}\n.kv .v{text-align:right;word-break:break-word}\ntextarea.input{min-height:84px;padding:10px 12px;resize:vertical;width:100%}\ninput[type=date].input{color-scheme:dark}\n.attr{font-size:11px;color:var(--faint);margin-top:12px}\n.radar{width:190px;height:190px;border-radius:50%;border:1.5px solid #6E4A32;position:relative;overflow:hidden;background:radial-gradient(circle,transparent 55%,rgba(224,121,63,.1) 100%);margin:10px auto 0}\n.radar::before{content:\"\";position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,rgba(224,121,63,.55),transparent 55%);animation:sw 3s linear infinite}\n.radar i{position:absolute;border-radius:50%;border:1px solid #4A3826}\n.radar b{position:absolute;width:6px;height:6px;border-radius:50%;background:var(--radar);box-shadow:0 0 8px var(--radar)}\n.big-n{font-family:var(--disp);font-weight:700;font-size:56px;line-height:1.1;color:var(--radar);text-align:center}\n.step{display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid var(--line)}\n.step .m{width:22px;height:22px;border-radius:50%;border:1.5px solid var(--line);flex-shrink:0;display:flex;align-items:center;justify-content:center}\n.step.done .m{background:var(--radar-d);border-color:var(--radar-d)}\n.step.on .m{border-color:var(--radar)}\n.step .t{flex:1;font-size:14px;color:var(--ghost)}\n.step.done .t{color:var(--ink)}.step.on .t{color:var(--radar)}\n.step .r{font-family:var(--mono);font-size:11px;color:var(--ghost)}\n.plist{display:flex;flex-direction:column;gap:8px}\n.prow{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 12px 10px 14px;display:flex;align-items:center;gap:12px}\n.prow .main{flex:1;min-width:0;text-align:left}\n.prow .main div:first-child{font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.prow .main div:last-child{font-family:var(--mono);font-size:10px;color:var(--ghost);letter-spacing:.06em;margin-top:4px}\n.late{color:var(--bad)!important}\n.empty{text-align:center;color:var(--ghost);padding:40px 16px;font-size:14px;line-height:1.5}\n.toast{position:fixed;left:50%;bottom:calc(88px + var(--safe-b));transform:translateX(-50%);background:var(--panel2);border:1px solid var(--line);padding:10px 16px;border-radius:6px;font-size:13px;z-index:20;max-width:90vw}\nselect.input{appearance:none;-webkit-appearance:none}\n.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}\n</style>\n</head>\n<body>\n<div id=\"app\"></div>\n<script>\n\"use strict\";\n// ------------------------------------------------------------------ icons\nconst P = {\n  radar:'<circle cx=\"12\" cy=\"12\" r=\"9\"/><circle cx=\"12\" cy=\"12\" r=\"4.5\"/><path d=\"M12 12l6-6\"/>',\n  list:'<path d=\"M4 6h16M4 12h16M4 18h10\"/>',\n  flow:'<rect x=\"3\" y=\"4\" width=\"5\" height=\"16\" rx=\"1\"/><rect x=\"10\" y=\"4\" width=\"5\" height=\"10\" rx=\"1\"/><rect x=\"17\" y=\"4\" width=\"4\" height=\"6\" rx=\"1\"/>',\n  phone:'<path d=\"M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z\"/>',\n  sms:'<path d=\"M4 5h16v11H9l-5 4z\"/>',\n  mail:'<rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2\"/><path d=\"M3 7l9 6 9-6\"/>',\n  globe:'<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18\"/>',\n  pin:'<path d=\"M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z\"/><circle cx=\"12\" cy=\"10\" r=\"2.5\"/>',\n  star:'<path d=\"M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.3l1-6.2L3 9.7l6.2-.9z\"/>',\n  chev:'<path d=\"M9 5l7 7-7 7\"/>', down:'<path d=\"M6 9l6 6 6-6\"/>', check:'<path d=\"M5 12l5 5 9-10\"/>',\n  close:'<path d=\"M6 6l12 12M18 6L6 18\"/>', dl:'<path d=\"M12 4v11M7 11l5 5 5-5M5 20h14\"/>', map:'<path d=\"M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2z\"/><path d=\"M9 4v14M15 6v14\"/>',\n  plus:'<path d=\"M12 5v14M5 12h14\"/>', trash:'<path d=\"M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13\"/>'\n};\nconst ic = (n, s = 20, c = \"currentColor\") => `<svg width=\"${s}\" height=\"${s}\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"${c}\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">${P[n]}</svg>`;\nconst esc = (s) => String(s ?? \"\").replace(/[&<>\"']/g, (c) => ({ \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", '\"': \"&quot;\", \"'\": \"&#39;\" }[c]));\n\n// ------------------------------------------------------------------ ranking (ported from the extension)\nconst THIN_MULT = 0.3, DOMINANT_PCT = 90, DOMINANT_MEDIAN_FLOOR = 2.0;\nfunction pctl(a, p) { if (!a.length) return 0; const k = (a.length - 1) * (p / 100), f = Math.floor(k), c = Math.ceil(k); return f === c ? a[k] : a[f] * (c - k) + a[c] * (k - f); }\nfunction marketStats(leads) {\n  const c = leads.map((l) => parseInt(l.reviews, 10)).filter((n) => !isNaN(n) && n >= 0).sort((a, b) => a - b);\n  if (!c.length) return { median: 0, domLine: Infinity, max: 0 };\n  const mid = Math.floor(c.length / 2), median = c.length % 2 ? c[mid] : (c[mid - 1] + c[mid]) / 2;\n  return { median, domLine: Math.max(pctl(c, DOMINANT_PCT), median * DOMINANT_MEDIAN_FLOOR), max: c[c.length - 1] };\n}\nfunction band(reviews, s) {\n  const r = parseInt(reviews, 10);\n  if (isNaN(r)) return \"\";\n  if (!s || !s.median || s.median < 1) return \"work\";\n  if (r < s.median * THIN_MULT) return \"thin\";\n  if (r >= s.domLine) return \"leader\";\n  return r >= s.median ? \"prime\" : \"work\";\n}\nconst BAND = { prime: \"Prime\", work: \"Workable\", leader: \"Leader\", thin: \"Thin\", \"\": \"\" };\nconst BAND_WHY = { prime: \"At or above the market median, below the leader line. Best first-client targets.\", work: \"Real and workable, on the lighter side of this market.\", leader: \"Top of this market. Likely has marketing handled, so lower priority.\", thin: \"Well below the market median. May be inactive, new or very small.\", \"\": \"No reviews yet.\" };\nconst ORDER = { prime: 0, work: 1, leader: 2, thin: 3, \"\": 4 };\n\n// ------------------------------------------------------------------ state\nconst S = {\n  view: \"sweep\", cfg: null, niche: null, city: null, areas: [], picked: new Set(), pages: 2, target: 25, err: \"\", busy: false,\n  sweepId: null, run: null, sweeps: [], leads: [], sweep: null, filter: \"all\", sheet: null, lead: null, pipeline: null, enriching: false,\n};\ntry { const saved = JSON.parse(localStorage.getItem(\"pr.last\") || \"null\"); if (saved) Object.assign(S, { nicheName: saved.niche, cityName: saved.city, pages: saved.pages || 2, target: saved.target ?? 25 }); } catch (e) {}\n\nasync function call(path, opts = {}) {\n  const r = await fetch(path, { method: opts.method || \"GET\", headers: opts.body ? { \"content-type\": \"application/json\" } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: \"same-origin\" });\n  let data = {};\n  try { data = await r.json(); } catch (e) {}\n  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);\n  return data;\n}\nlet toastT;\nfunction toast(msg) {\n  document.querySelector(\".toast\")?.remove();\n  const t = document.createElement(\"div\"); t.className = \"toast\"; t.setAttribute(\"role\", \"status\"); t.textContent = msg; document.body.appendChild(t);\n  clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3500);\n}\n\n// ------------------------------------------------------------------ helpers\nconst telOf = (l) => (l.phone_intl || l.phone || l.site_phone || \"\").replace(/[^\\d+]/g, \"\");\nconst phoneShown = (l) => l.phone || l.site_phone || \"\";\nconst isMobile = (l) => /^04/.test((l.phone || l.site_phone || \"\").replace(/\\s/g, \"\"));\nconst today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };\nconst fmtDate = (s) => { if (!s) return \"\"; const d = new Date(s + \"T00:00:00\"); return d.toLocaleDateString(\"en-AU\", { weekday: \"short\", day: \"numeric\", month: \"short\" }); };\nfunction tagsFor(l) {\n  const t = [];\n  const noRealSite = !l.website || /social|directory|different business/.test(l.enrich_note || \"\");\n  if (/broken/.test(l.enrich_note || \"\")) t.push([\"Broken website\", \"opp\"]);\n  else if (noRealSite) t.push([/different business/.test(l.enrich_note || \"\") ? \"Old website gone\" : \"No website\", \"opp\"]);\n  else if (l.enrich_state === \"done\" && l.gads != null && l.enrich_note !== \"site unreachable\") {\n    if (!l.gads && !l.meta && !l.gtm) t.push([\"No ad tracking\", \"opp\"]);\n    else { if (l.gads) t.push([\"Google Ads tag\", \"\"]); if (l.meta) t.push([\"Meta pixel\", \"\"]); if (l.gtm && !l.gads && !l.meta) t.push([\"Tag manager only\", \"\"]); }\n  }\n  if (phoneShown(l)) t.push(isMobile(l) ? [\"Mobile\", \"opp\"] : [\"Landline\", \"\"]);\n  return t;\n}\nfunction emailState(l) {\n  if (l.email) return l.email_ok === 0 ? \"Email looks dead\" : \"Email found\";\n  if (!l.website) return l.enrich_note && l.enrich_note.includes(\"social\") ? \"Facebook page only\" : \"No website\";\n  if (l.enrich_state !== \"done\") return \"Hunting email\u2026\";\n  const n = l.enrich_note || \"\";\n  if (n.includes(\"different business\")) return \"Website now belongs to someone else\";\n  if (n.includes(\"social\") || n.includes(\"directory\")) return \"No real website\";\n  if (n.includes(\"blocks\")) return \"Site blocks finder\";\n  if (n.includes(\"broken\")) return \"Website is broken\";\n  if (n.includes(\"down\")) return \"Site is down\";\n  if (n.includes(\"didn't load\") || n.includes(\"unreachable\")) return \"Site didn't load\";\n  if (n.includes(\"heavy\")) return \"Site too big to scan\";\n  return l.has_form ? \"Contact form only\" : \"No email on site\";\n}\nconst STATUS = [[\"new\", \"New\"], [\"contacted\", \"Contacted\"], [\"replied\", \"Replied\"], [\"booked\", \"Booked\"], [\"dead\", \"Dead\"]];\nconst statusName = (s) => (STATUS.find((x) => x[0] === s) || STATUS[0])[1];\n\n// ------------------------------------------------------------------ rendering\nfunction header(sub) {\n  return `<header class=\"top\"><div><div class=\"brand\">PROSPECT<span> RADAR</span></div><div class=\"sub\">${esc(sub)}</div></div><div class=\"scope\" aria-hidden=\"true\"></div></header>`;\n}\nfunction tabs() {\n  const t = [[\"sweep\", \"radar\", \"Sweep\"], [\"targets\", \"list\", \"Targets\"], [\"pipeline\", \"flow\", \"Pipeline\"]];\n  const cur = S.view === \"sweeping\" ? \"sweep\" : S.view;\n  return `<nav class=\"tabs\" aria-label=\"Main\">${t.map(([v, i, n]) => `<button data-tab=\"${v}\" ${cur === v ? 'aria-current=\"page\"' : \"\"}>${ic(i, 22)}<span>${n}</span></button>`).join(\"\")}</nav>`;\n}\n\nfunction claudeMsg() {\n  if (!S.niche || !S.city) return \"\";\n  const areas = [...S.picked];\n  return `Prospect Radar sweep: ${S.niche.name} in ${S.city.name}${S.city.state ? \" \" + S.city.state : \"\"}. Areas: ${areas.join(\", \")}. Send me the Prospect Radar CSV with owner names.`;\n}\nfunction viewSweep() {\n  const cfg = S.cfg; if (!cfg) return header(\"Local target acquisition\") + `<div class=\"empty\">Loading\u2026</div>`;\n  const u = cfg.usage || { search: 0, cap: 900, left: 900 };\n  const left = u.left ?? Math.max(0, u.cap - u.search);\n  const need = S.target ? Math.min(left, Math.max(4, Math.ceil(S.target / 4) + 2)) : S.picked.size * S.pages;\n  const typical = Math.max(1, Math.ceil(S.target / 10));\n  const pct = Math.min(100, (u.search / (u.cap || 1)) * 100);\n  const ready = S.niche && S.city && S.picked.size && (S.target ? left > 0 : need <= left) && !S.busy && cfg.hasKey;\n  const importReady = S.niche && S.city && !S.busy;\n  return header(\"Local target acquisition\") + `<div class=\"stack\">\n  ${cfg.hasKey === false ? `<div class=\"err\">The Google key isn't set yet. Add <b>GOOGLE_KEY</b> as a secret on the Worker. CSV import below still works.</div>` : \"\"}\n  <div><p class=\"lbl\">Niche \u00b7 top tier</p>\n    <button class=\"field\" data-open=\"niche\"><span>${S.niche ? esc(S.niche.name) : '<span class=\"ph\">Choose a niche</span>'}</span>${ic(\"down\", 18, \"#A39280\")}</button>\n    ${S.niche ? `<p class=\"muted\" style=\"margin:8px 0 0\">${esc(S.niche.why)}</p>` : \"\"}</div>\n  <div><p class=\"lbl\">Market</p>\n    <button class=\"field\" data-open=\"city\"><span style=\"display:flex;align-items:center;gap:10px\">${ic(\"pin\", 18, \"#A39280\")}${S.city ? esc(S.city.name + (S.city.state ? \", \" + S.city.state : \"\")) : '<span class=\"ph\">Choose a city</span>'}</span>${ic(\"down\", 18, \"#A39280\")}</button></div>\n  ${S.city ? `<div><p class=\"lbl\">Suburbs to sweep \u00b7 ${S.picked.size} picked</p>\n    <div class=\"chips\">${S.areas.map((a) => `<button class=\"chip\" data-area=\"${esc(a)}\" aria-pressed=\"${S.picked.has(a)}\">${esc(a)}</button>`).join(\"\")}</div>\n    <form class=\"row\" id=\"addArea\" style=\"margin-top:10px\"><label class=\"sr\" for=\"areaIn\">Add a suburb</label><input class=\"input\" id=\"areaIn\" placeholder=\"Add a suburb\" autocomplete=\"off\"><button class=\"btn-sm\" type=\"submit\">Add</button></form>\n    <p class=\"muted\" style=\"margin:8px 0 0\">${S.target ? `It starts with these. If they run dry before your number, it moves on to the rest of ${esc(S.city.name)}.` : \"Each suburb is searched separately and merged, so you get more than one page of results.\"}</p></div>\n  <div><p class=\"lbl\">Leads with emails</p>\n    <div class=\"seg\">${[10, 25, 50, 100, 0].map((t) => `<button data-target=\"${t}\" aria-pressed=\"${S.target === t}\">${t || \"No limit\"}</button>`).join(\"\")}</div>\n    <p class=\"muted\" style=\"margin:8px 0 0\">${S.target ? `Keeps searching until it has ${S.target} leads with a working email, then stops.` : \"Searches only the suburbs you picked, as deep as you choose below.\"}</p></div>\n  ${S.target ? \"\" : `<div><p class=\"lbl\">Depth per suburb</p>\n    <div class=\"seg\">${[1, 2, 3].map((p) => `<button data-pages=\"${p}\" aria-pressed=\"${S.pages === p}\">Up to ${p * 20}</button>`).join(\"\")}</div></div>`}` : \"\"}\n  <div class=\"panel\"><div style=\"display:flex;justify-content:space-between;align-items:center\"><span class=\"lbl\" style=\"margin:0\">Google searches this month</span><span class=\"mono\" style=\"font-size:11px\">${u.search} / ${u.cap}</span></div>\n    <div class=\"meter\" style=\"margin-top:9px\"><div style=\"width:${pct}%\"></div></div>\n    <p class=\"muted\" style=\"margin:8px 0 0\">${S.picked.size && S.city ? (S.target ? `Usually about ${typical} search${typical > 1 ? \"es\" : \"\"}, never more than ${need}. ` : `This sweep uses up to ${need}. `) : \"\"}${!S.target && need > left ? `<span class=\"late\">Only ${left} left ${u.limitBy === \"day\" ? \"today\" : \"this month\"}. Pick fewer suburbs or less depth.</span>` : \"Sweeps stop before you pass your limit, so you stay in Google's free allowance.\"}</p></div>\n  ${S.err ? `<div class=\"err\" role=\"alert\">${esc(S.err)}</div>` : \"\"}\n  <button class=\"cta\" id=\"go\" ${ready ? \"\" : \"disabled\"}>${S.busy ? \"Starting\u2026\" : \"Sweep\"}</button>\n  <p class=\"muted\" style=\"margin:-6px 0 0;text-align:center\">Finds the businesses, ranks them, then hunts emails and owner names on its own.</p>\n  <details class=\"panel\"><summary class=\"muted\" style=\"cursor:pointer;min-height:32px;display:flex;align-items:center\">Or import a CSV instead</summary>\n    <p class=\"muted\" style=\"margin:10px 0 12px\">Use a file from your Chrome extension's Export, or one Claude made for you. Pick the niche and city above first.</p>\n    <label class=\"btn-sm\" for=\"csvIn\" style=\"display:flex;align-items:center;justify-content:center;gap:10px;cursor:pointer;${importReady ? \"\" : \"opacity:.45;pointer-events:none\"}\">${ic(\"dl\", 18)}Import CSV</label>\n    <input type=\"file\" id=\"csvIn\" accept=\".csv,text/csv,text/plain\" class=\"sr\" ${importReady ? \"\" : \"disabled\"}>\n    <textarea id=\"csvPaste\" class=\"input\" style=\"margin-top:10px\" placeholder=\"\u2026or paste CSV text here\"></textarea>\n    <button class=\"btn-sm\" id=\"pasteGo\" style=\"width:100%;margin-top:8px\" ${importReady ? \"\" : \"disabled\"}>Import pasted text</button>\n  </details>\n  </div>`;\n}\n\nfunction viewSweeping() {\n  const r = S.run || {};\n  if (r.mode === \"goal\") return viewGoal(r);\n  const steps = [\n    [r.mode === \"import\" ? \"Importing the file\" : \"Searching Google\", r.mode === \"import\" ? (r.searchDone ? `${r.found} businesses` : \"\") : `${r.cursor || 0} / ${r.total || 0} suburbs`, r.searchDone, !r.searchDone],\n    [\"Merging duplicates\", r.searchDone ? `${r.found} unique` : \"\", r.searchDone, false],\n    [\"Ranking against the market\", r.searchDone && r.median != null ? `median ${r.median}` : \"\", r.searchDone, false],\n    [\"Finding emails and ad tags\", r.searchDone ? `${Math.max(0, (r.found || 0) - (r.remaining ?? r.found ?? 0))} / ${r.found || 0}` : \"\", r.searchDone && r.remaining === 0, r.searchDone && r.remaining !== 0],\n  ];\n  const pct = r.searchDone ? (r.found ? ((r.found - (r.remaining ?? r.found)) / r.found) * 100 : 100) : ((r.cursor || 0) / (r.total || 1)) * 100;\n  return header(r.mode === \"import\" ? \"Loading targets\" : \"Sweep in progress\") + `\n  <div class=\"radar\" aria-hidden=\"true\"><i style=\"inset:38px\"></i><i style=\"inset:72px\"></i><b style=\"left:58px;top:44px\"></b><b style=\"left:128px;top:82px\"></b><b style=\"left:96px;top:138px\"></b></div>\n  <p class=\"lbl\" style=\"text-align:center;margin-top:22px\">Targets acquired</p>\n  <div class=\"big-n\" aria-live=\"polite\">${r.found || 0}</div>\n  <p class=\"muted\" style=\"text-align:center;margin:0\">${esc(r.label || \"\")}</p>\n  <div style=\"margin-top:18px\">${steps.map(([t, v, d, on]) => `<div class=\"step ${d ? \"done\" : on ? \"on\" : \"\"}\"><span class=\"m\">${d ? ic(\"check\", 13, \"#14100C\") : \"\"}</span><span class=\"t\">${t}</span><span class=\"r\">${esc(v)}</span></div>`).join(\"\")}</div>\n  <div class=\"meter\" style=\"margin-top:16px\"><div style=\"width:${pct}%\"></div></div>\n  ${r.warn ? `<div class=\"err\" style=\"margin-top:14px\">${esc(r.warn)}</div>` : \"\"}\n  <p class=\"muted\" style=\"margin:10px 0 0\">${r.searchDone ? \"You can open the targets now. Emails keep filling in, even if you close the app.\" : (r.mode === \"import\" ? \"Reading the file\u2026\" : \"Searching each suburb\u2026\")}</p>\n  <div style=\"margin-top:18px\"><button class=\"cta ghost\" data-tab=\"targets\" ${r.found ? \"\" : \"disabled\"}>View targets</button></div>`;\n}\n\nfunction viewGoal(r) {\n  const pct = Math.min(100, (r.verified / (r.target || 1)) * 100), hit = r.verified >= r.target;\n  const steps = [\n    [\"Searching Google\", `${r.searches} search${r.searches === 1 ? \"\" : \"es\"}${r.last && !r.finished ? \" \u00b7 \" + r.last : \"\"}`, r.finished, !r.finished],\n    [\"Checking websites for emails\", `${r.checked} / ${r.found}`, r.finished && !r.pending, r.pending > 0],\n    [\"Leads with a working email\", `${r.verified} / ${r.target}`, hit, !hit && !r.finished],\n  ];\n  return header(r.finished ? (hit ? \"Goal reached\" : \"Sweep finished\") : \"Sweep in progress\") + `\n  <div class=\"radar\" aria-hidden=\"true\"><i style=\"inset:38px\"></i><i style=\"inset:72px\"></i><b style=\"left:58px;top:44px\"></b><b style=\"left:128px;top:82px\"></b><b style=\"left:96px;top:138px\"></b></div>\n  <p class=\"lbl\" style=\"text-align:center;margin-top:22px\">Leads with emails</p>\n  <div class=\"big-n\" aria-live=\"polite\">${r.verified}<span style=\"font-size:.4em;opacity:.55\"> / ${r.target}</span></div>\n  <p class=\"muted\" style=\"text-align:center;margin:0\">${esc(r.label || \"\")} \u00b7 ${r.found} businesses found</p>\n  <div style=\"margin-top:18px\">${steps.map(([t, v, d, on]) => `<div class=\"step ${d ? \"done\" : on ? \"on\" : \"\"}\"><span class=\"m\">${d ? ic(\"check\", 13, \"#14100C\") : \"\"}</span><span class=\"t\">${t}</span><span class=\"r\">${esc(v)}</span></div>`).join(\"\")}</div>\n  <div class=\"meter\" style=\"margin-top:16px\"><div style=\"width:${pct}%\"></div></div>\n  ${r.warn ? `<div class=\"err\" style=\"margin-top:14px\">${esc(r.warn)}</div>` : \"\"}\n  <p class=\"muted\" style=\"margin:10px 0 0\">${r.finished ? (r.pending || r.remaining ? \"A few more are still being checked. They'll fill in on their own.\" : \"All done.\") : \"You can close the app. It keeps going in the background until it hits your number.\"}</p>\n  <div style=\"margin-top:18px\"><button class=\"cta ghost\" data-tab=\"targets\" ${r.found ? \"\" : \"disabled\"}>View targets</button></div>`;\n}\n\nfunction card(l, st) {\n  const b = band(l.reviews, st), max = Math.max(st.max || 1, 1);\n  const pct = l.reviews != null ? Math.min(100, (l.reviews / max) * 100) : 0, tick = st.median ? (st.median / max) * 100 : 0;\n  const fill = b === \"prime\" ? \"var(--radar)\" : b === \"leader\" ? \"var(--steel)\" : \"#7A6A58\";\n  const tel = telOf(l), tags = tagsFor(l);\n  return `<article class=\"card ${b === \"prime\" ? \"prime\" : \"\"} ${b === \"leader\" || b === \"thin\" ? \"dim\" : \"\"}\">\n  <button class=\"hd\" data-lead=\"${esc(l.place_id)}\"><span class=\"nm\">${esc(l.name)}</span>${b ? `<span class=\"band ${b}\">${BAND[b]}</span>` : \"\"}</button>\n  <div class=\"metaline\">${l.rating != null ? `<span style=\"display:flex;color:var(--radar)\">${ic(\"star\", 13)}</span><span class=\"v\">${l.rating}</span><span>${l.reviews ?? 0} reviews</span>` : \"<span>No reviews</span>\"}${l.suburb ? `<span>\u00b7</span><span>${esc(l.suburb)}</span>` : \"\"}${l.status !== \"new\" ? `<span>\u00b7</span><span class=\"v\">${statusName(l.status)}</span>` : \"\"}</div>\n  ${l.owner ? `<div class=\"askfor\">Ask for <b>${esc(l.owner)}</b></div>` : \"\"}\n  ${tags.length ? `<div class=\"tags\">${tags.map(([t, k]) => `<span class=\"tag ${k}\">${t}</span>`).join(\"\")}</div>` : \"\"}\n  ${l.reviews != null ? `<div class=\"bar\"><div class=\"f\" style=\"width:${pct}%;background:${fill}\"></div>${tick ? `<div class=\"t\" style=\"left:${tick}%\"></div>` : \"\"}</div><div class=\"barlbl\"><span>Reviews vs median (${Math.round(st.median)})</span></div>` : \"\"}\n  <div class=\"acts\">\n    <a class=\"ib\" href=\"tel:${esc(tel)}\" aria-label=\"Call ${esc(l.name)}\" ${tel ? \"\" : 'aria-disabled=\"true\"'}>${ic(\"phone\", 19)}</a>\n    <a class=\"ib\" href=\"sms:${esc(tel)}\" aria-label=\"Text ${esc(l.name)}\" ${tel ? \"\" : 'aria-disabled=\"true\"'}>${ic(\"sms\", 19)}</a>\n    <a class=\"ib\" href=\"mailto:${esc(l.email || \"\")}\" aria-label=\"Email ${esc(l.name)}\" ${l.email ? \"\" : 'aria-disabled=\"true\"'}>${ic(\"mail\", 19)}</a>\n    <span class=\"st\">${emailState(l)}</span>\n    <button class=\"more\" data-lead=\"${esc(l.place_id)}\" aria-label=\"Open ${esc(l.name)}\">${ic(\"chev\", 18)}</button>\n  </div></article>`;\n}\n\nfunction filtered(st) {\n  const f = S.filter;\n  let out = S.leads.filter((l) => f === \"all\" ? true : f === \"prime\" ? band(l.reviews, st) === \"prime\" : f === \"email\" ? !!l.email : f === \"new\" ? l.status === \"new\" : f === \"nosite\" ? !l.website : f === \"notrack\" ? l.website && l.enrich_state === \"done\" && l.gads != null && !l.gads && !l.meta && !l.gtm && l.enrich_note !== \"site unreachable\" : f === \"mobile\" ? isMobile(l) : true);\n  return out.sort((a, b) => (ORDER[band(a.reviews, st)] - ORDER[band(b.reviews, st)]) || ((b.reviews || 0) - (a.reviews || 0)));\n}\n\nfunction viewTargets() {\n  if (!S.sweeps.length) return `<header class=\"top\"><div class=\"brand\" style=\"font-size:18px\">Targets</div></header><div class=\"empty\">No sweeps yet.<br>Run a sweep to fill this list.</div>`;\n  const st = marketStats(S.leads);\n  let prime = 0, leader = 0; for (const l of S.leads) { const b = band(l.reviews, st); if (b === \"prime\") prime++; if (b === \"leader\") leader++; }\n  const list = filtered(st);\n  const F = [[\"all\", \"All\"], [\"prime\", \"Prime\"], [\"email\", \"Has email\"], [\"new\", \"Not contacted\"], [\"nosite\", \"No website\"], [\"notrack\", \"No tracking\"], [\"mobile\", \"Mobile\"]];\n  return `<header class=\"top\" style=\"padding-bottom:10px\"><div style=\"min-width:0;flex:1\">\n    <label class=\"sr\" for=\"sweepSel\">Sweep</label>\n    <select id=\"sweepSel\" class=\"input\" style=\"width:100%;font-family:var(--disp);font-weight:600;letter-spacing:.06em;font-size:16px;border:0;padding:0;background:transparent;min-height:36px;text-overflow:ellipsis\">\n    ${S.sweeps.map((s) => `<option value=\"${s.id}\" ${s.id === S.sweepId ? \"selected\" : \"\"}>${esc(s.niche)} \u00b7 ${esc(s.city)}</option>`).join(\"\")}</select>\n    <div class=\"muted\">${S.sweep ? new Date(S.sweep.created_at).toLocaleDateString(\"en-AU\", { day: \"numeric\", month: \"short\" }) + \" \u00b7 \" : \"\"}${S.leads.length} leads${S.enriching ? \" \u00b7 finding emails\u2026\" : \"\"}${S.sweeps.length > 1 ? \" \u00b7 tap title to switch\" : \"\"}</div></div>\n    <button class=\"btn-sm\" id=\"export\" style=\"display:flex;align-items:center;gap:8px;margin-left:10px\">${ic(\"dl\", 16)}Export</button></header>\n  <div class=\"panel stats\" style=\"margin-bottom:12px\"><div class=\"stat\"><div class=\"n\">${S.leads.length}</div><div class=\"k\">Leads</div></div><div class=\"stat\"><div class=\"n\">${Math.round(st.median) || \"-\"}</div><div class=\"k\">Median reviews</div></div><div class=\"stat prime\"><div class=\"n\">${prime}</div><div class=\"k\">Prime targets</div></div><div class=\"stat leader\"><div class=\"n\">${leader}</div><div class=\"k\">Market leaders</div></div></div>\n  <div class=\"scroll-x\" style=\"margin-bottom:12px\">${F.map(([k, n]) => `<button class=\"chip\" data-filter=\"${k}\" aria-pressed=\"${S.filter === k}\">${n}</button>`).join(\"\")}</div>\n  <div class=\"cards\">${list.length ? list.map((l) => card(l, st)).join(\"\") : `<div class=\"empty\">Nothing matches this filter.</div>`}</div>\n  <p class=\"attr\" style=\"text-align:center\">Listings from Google Maps</p>\n  ${(() => { const miss = S.leads.filter((l) => l.website && !l.email && l.enrich_state === \"done\").length; return miss ? `<div style=\"text-align:center;margin-top:14px\"><button class=\"btn-sm\" id=\"rehunt\" style=\"display:inline-flex;align-items:center;gap:8px\">${ic(\"mail\", 15)}Re-check ${miss} missing email${miss > 1 ? \"s\" : \"\"}</button></div>` : \"\"; })()}\n  <div style=\"text-align:center;margin-top:8px\"><button class=\"btn-sm\" id=\"delSweep\" style=\"display:inline-flex;align-items:center;gap:8px;color:var(--ghost)\">${ic(\"trash\", 15)}Delete this sweep</button></div>`;\n}\n\nfunction prow(l, late) {\n  const tel = telOf(l);\n  return `<div class=\"prow\"><button class=\"main\" data-lead=\"${esc(l.place_id)}\"><div>${esc(l.name)}</div><div class=\"${late ? \"late\" : \"\"}\">${statusName(l.status)}${l.follow_up ? \" \u00b7 \" + (l.follow_up === today() ? \"due today\" : late ? \"due \" + fmtDate(l.follow_up) : fmtDate(l.follow_up)) : \"\"}${l.owner ? \" \u00b7 \" + esc(l.owner) : \"\"}</div></button>\n  <a class=\"ib\" href=\"tel:${esc(tel)}\" aria-label=\"Call ${esc(l.name)}\" ${tel ? \"\" : 'aria-disabled=\"true\"'}>${ic(\"phone\", 19)}</a></div>`;\n}\nfunction viewPipeline() {\n  const p = S.pipeline;\n  if (!p) return `<header class=\"top\"><div class=\"brand\" style=\"font-size:18px\">Pipeline</div></header><div class=\"empty\">Loading\u2026</div>`;\n  const c = Object.fromEntries(p.counts.map((x) => [x.status, x.n]));\n  const t = p.today, due = p.due.filter((l) => l.follow_up === t), late = p.due.filter((l) => l.follow_up < t);\n  const dueIds = new Set(p.due.map((l) => l.place_id)), recent = p.recent.filter((l) => !dueIds.has(l.place_id)).slice(0, 20);\n  return `<header class=\"top\"><div><div class=\"brand\" style=\"font-size:18px\">Pipeline</div><div class=\"muted\">Who to contact next</div></div></header>\n  <div class=\"panel stats\"><div class=\"stat\"><div class=\"n\">${c.new || 0}</div><div class=\"k\">New</div></div><div class=\"stat\"><div class=\"n\">${c.contacted || 0}</div><div class=\"k\">Contacted</div></div><div class=\"stat prime\"><div class=\"n\">${c.replied || 0}</div><div class=\"k\">Replied</div></div><div class=\"stat prime\"><div class=\"n\">${c.booked || 0}</div><div class=\"k\">Booked</div></div></div>\n  <p class=\"lbl\" style=\"margin-top:20px\">Follow up today</p><div class=\"plist\">${due.length ? due.map((l) => prow(l)).join(\"\") : `<p class=\"muted\">Nothing due today.</p>`}</div>\n  ${late.length ? `<p class=\"lbl\" style=\"margin-top:20px\">Overdue</p><div class=\"plist\">${late.map((l) => prow(l, true)).join(\"\")}</div>` : \"\"}\n  <p class=\"lbl\" style=\"margin-top:20px\">Recently worked</p><div class=\"plist\">${recent.length ? recent.map((l) => prow(l)).join(\"\") : `<p class=\"muted\">Leads you mark as contacted show up here.</p>`}</div>`;\n}\n\nfunction sheetNiche() {\n  return `<div class=\"sheethd\"><h2 id=\"shT\">Choose niche</h2><button class=\"x\" data-close aria-label=\"Close\">${ic(\"close\")}</button></div>\n  <p class=\"lbl\">Top tier (best fit)</p><div role=\"listbox\" aria-labelledby=\"shT\">${S.cfg.niches.map((n, i) => `<button class=\"opt\" role=\"option\" data-niche=\"${i}\" aria-selected=\"${S.niche?.name === n.name}\"><span class=\"dot\">${S.niche?.name === n.name ? ic(\"check\", 13, \"#14100C\") : \"\"}</span><span><div style=\"font-size:15px;font-weight:500\">${esc(n.name)}</div><div class=\"muted\" style=\"margin-top:2px\">${esc(n.why)}</div></span></button>`).join(\"\")}</div>`;\n}\nfunction sheetCity() {\n  return `<div class=\"sheethd\"><h2 id=\"shT\">Choose city</h2><button class=\"x\" data-close aria-label=\"Close\">${ic(\"close\")}</button></div>\n  <div role=\"listbox\" aria-labelledby=\"shT\">${S.cfg.cities.map((c, i) => `<button class=\"opt\" role=\"option\" data-city=\"${i}\" aria-selected=\"${S.city?.name === c.name}\" style=\"min-height:52px\"><span class=\"dot\">${S.city?.name === c.name ? ic(\"check\", 13, \"#14100C\") : \"\"}</span><span style=\"font-size:15px\">${esc(c.name)}, ${c.state}</span></button>`).join(\"\")}</div>\n  <p class=\"lbl\" style=\"margin-top:18px\">Somewhere else</p>\n  <form id=\"otherCity\" class=\"row\"><label class=\"sr\" for=\"ocName\">City</label><input class=\"input\" id=\"ocName\" placeholder=\"City or town\" required><label class=\"sr\" for=\"ocState\">State</label><input class=\"input\" id=\"ocState\" placeholder=\"State\" style=\"flex:0 0 76px\" maxlength=\"3\" required><button class=\"btn-sm\" type=\"submit\">Use</button></form>\n  <p class=\"muted\" style=\"margin:8px 0 0\">You'll add the suburbs to search yourself.</p>`;\n}\nfunction sheetLead() {\n  const l = S.lead; if (!l) return \"\";\n  const st = marketStats(S.leads.length ? S.leads : [l]), b = band(l.reviews, st), tel = telOf(l);\n  const maps = `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(l.place_id)}`;\n  const kv = (k, v) => v ? `<div class=\"kv\"><span class=\"k\">${k}</span><span class=\"v\">${v}</span></div>` : \"\";\n  const site = l.website ? (l.enrich_state !== \"done\" ? \"Checking\u2026\" : l.enrich_note === \"site unreachable\" ? \"Didn't load\" : [l.gads ? \"Google Ads tag\" : \"No Google Ads tag\", l.meta ? \"Meta pixel\" : \"no Meta pixel\"].join(\", \") + (l.gtm && !l.gads && !l.meta ? \" (has Tag Manager)\" : \"\") + (l.builder ? ` \u00b7 ${esc(l.builder)}` : \"\")) : \"None. A landing page is an easy first offer.\";\n  const owner = l.owner ? `<b>${esc(l.owner)}</b>${l.owner_source ? ` <span class=\"muted\">\u00b7 ${esc(l.owner_source)}</span>` : \"\"}` : '<span class=\"muted\">Not found</span>';\n  return `<div class=\"grab\" aria-hidden=\"true\"></div>\n  <div class=\"sheethd\" style=\"align-items:flex-start\"><div><h2 id=\"shT\" style=\"text-transform:none;letter-spacing:0;font-family:var(--body);font-size:19px;line-height:1.2\">${esc(l.name)}</h2>\n    <div class=\"metaline\">${l.rating != null ? `<span style=\"display:flex;color:var(--radar)\">${ic(\"star\", 13)}</span><span class=\"v\">${l.rating}</span><span>${l.reviews ?? 0} reviews</span>` : \"\"}${b ? `<span class=\"band ${b}\" style=\"margin-left:4px\">${BAND[b]}</span>` : \"\"}</div></div>\n    <button class=\"x\" data-close aria-label=\"Close\">${ic(\"close\")}</button></div>\n  <div class=\"big\">\n    <a class=\"p\" href=\"tel:${esc(tel)}\" ${tel ? \"\" : 'aria-disabled=\"true\"'}>${ic(\"phone\", 19)}Call</a>\n    <a href=\"sms:${esc(tel)}\" ${tel ? \"\" : 'aria-disabled=\"true\"'}>${ic(\"sms\", 19)}Text</a>\n    <a href=\"mailto:${esc(l.email || \"\")}\" ${l.email ? \"\" : 'aria-disabled=\"true\"'}>${ic(\"mail\", 19)}Email</a>\n    <a href=\"${esc(l.website || \"#\")}\" target=\"_blank\" rel=\"noopener\" ${l.website ? \"\" : 'aria-disabled=\"true\"'}>${ic(\"globe\", 19)}Website</a>\n  </div>\n  ${kv(\"Ask for\", owner)}\n  ${kv(\"Phone\", phoneShown(l) ? esc(phoneShown(l)) + (isMobile(l) ? ' <span class=\"muted\">\u00b7 mobile, likely the owner</span>' : \"\") : \"\")}\n  ${kv(\"Email\", l.email ? esc(l.email) + (l.email_ok === 0 ? ' <span class=\"late\">\u00b7 domain can\\'t receive mail</span>' : l.email_ok === 1 ? ' <span class=\"muted\">\u00b7 domain takes mail</span>' : \"\") : `<span class=\"muted\">${emailState(l)}</span>`)}\n  ${!l.email && l.contact_url ? kv(\"Contact\", `<a href=\"${esc(l.contact_url)}\" target=\"_blank\" rel=\"noopener\" style=\"color:var(--radar)\">${l.has_form ? \"Open their contact form\" : \"Open their contact page\"}</a>`) : \"\"}\n  ${kv(\"Website\", site)}\n  ${kv(\"Address\", l.address ? esc(l.address) : \"\")}\n  ${kv(\"Signal\", BAND_WHY[b])}\n  <p class=\"lbl\" style=\"margin-top:18px\">Status</p>\n  <div class=\"seg\" style=\"flex-wrap:wrap\">${STATUS.map(([k, n]) => `<button data-status=\"${k}\" aria-pressed=\"${l.status === k}\" style=\"flex:1 0 28%\">${n}</button>`).join(\"\")}</div>\n  <p class=\"lbl\" style=\"margin-top:16px\"><label for=\"fu\">Follow up</label></p>\n  <div class=\"row\"><input type=\"date\" id=\"fu\" class=\"input\" value=\"${esc(l.follow_up || \"\")}\"><button class=\"btn-sm\" data-fu=\"1\">Tomorrow</button><button class=\"btn-sm\" data-fu=\"3\">+3 days</button></div>\n  <p class=\"lbl\" style=\"margin-top:16px\"><label for=\"notes\">Notes</label></p>\n  <textarea id=\"notes\" class=\"input\" placeholder=\"Add a note after the call\">${esc(l.notes || \"\")}</textarea>\n  <a href=\"${maps}\" target=\"_blank\" rel=\"noopener\" class=\"btn-sm\" style=\"display:flex;align-items:center;justify-content:center;gap:8px;margin-top:14px\">${ic(\"map\", 16)}Open in Google Maps</a>\n  <p class=\"attr\">Listing details from Google Maps</p>`;\n}\n\nfunction render() {\n  const app = document.getElementById(\"app\");\n  const scroll = window.scrollY;\n  const v = S.view === \"sweep\" ? viewSweep() : S.view === \"sweeping\" ? viewSweeping() : S.view === \"targets\" ? viewTargets() : viewPipeline();\n  app.innerHTML = `<main class=\"wrap\">${v}</main>${tabs()}`;\n  renderSheet();\n  if (S.keepScroll) window.scrollTo(0, scroll);\n  S.keepScroll = false;\n}\nfunction renderSheet() {\n  let ov = document.getElementById(\"ov\");\n  if (!S.sheet) { ov?.remove(); document.body.style.overflow = \"\"; return; }\n  const html = S.sheet === \"niche\" ? sheetNiche() : S.sheet === \"city\" ? sheetCity() : sheetLead();\n  const keep = ov?.querySelector(\".sheet\")?.scrollTop || 0;\n  if (!ov) { ov = document.createElement(\"div\"); ov.id = \"ov\"; ov.className = \"overlay\"; document.body.appendChild(ov); }\n  const focused = document.activeElement?.id;\n  const draft = ov.querySelector(\"#notes\")?.value;\n  ov.innerHTML = `<div class=\"sheet\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"shT\">${html}</div>`;\n  ov.querySelector(\".sheet\").scrollTop = keep;\n  if (draft != null && ov.querySelector(\"#notes\")) ov.querySelector(\"#notes\").value = draft;\n  if (focused && ov.querySelector(\"#\" + focused)) ov.querySelector(\"#\" + focused).focus();\n  document.body.style.overflow = \"hidden\";\n}\n\n// ------------------------------------------------------------------ actions\nfunction setCity(c) {\n  S.city = c; S.areas = [...(c.areas || [])]; S.picked = new Set(S.areas.slice(0, 5));\n  if (!S.areas.length) { S.areas = [c.name]; S.picked = new Set([c.name]); }\n}\nasync function loadConfig() {\n  S.cfg = await call(\"/api/config\");\n  if (S.nicheName) S.niche = S.cfg.niches.find((n) => n.name === S.nicheName) || null;\n  if (S.cityName && !S.city) { const c = S.cfg.cities.find((x) => x.name === S.cityName); if (c) setCity(c); }\n}\nasync function loadSweeps(pick) {\n  S.sweeps = (await call(\"/api/sweeps\")).sweeps;\n  if (pick) S.sweepId = pick; else if (!S.sweeps.find((s) => s.id === S.sweepId)) S.sweepId = S.sweeps[0]?.id || null;\n  if (S.sweepId) await loadLeads();\n  else S.leads = [];\n}\nasync function loadLeads() {\n  const d = await call(`/api/sweeps/${S.sweepId}/leads`);\n  S.leads = d.leads; S.sweep = d.sweep;\n}\nasync function loadPipeline() { S.pipeline = await call(`/api/pipeline?today=${today()}`); }\n\nfunction parseCSV(text) {\n  const rows = []; let row = [], f = \"\", q = false;\n  text = text.replace(/^\\uFEFF/, \"\");\n  for (let i = 0; i < text.length; i++) {\n    const c = text[i];\n    if (q) { if (c === '\"') { if (text[i + 1] === '\"') { f += '\"'; i++; } else q = false; } else f += c; }\n    else if (c === '\"') q = true;\n    else if (c === \",\") { row.push(f); f = \"\"; }\n    else if (c === \"\\n\" || c === \"\\r\") { if (c === \"\\r\" && text[i + 1] === \"\\n\") i++; row.push(f); rows.push(row); row = []; f = \"\"; }\n    else f += c;\n  }\n  if (f || row.length) { row.push(f); rows.push(row); }\n  return rows.filter((r) => r.some((x) => x.trim()));\n}\nconst COLS = { name: [\"name\", \"business\", \"business name\", \"title\"], owner: [\"owner\", \"ask for\", \"owner name\", \"contact\"], rating: [\"rating\", \"stars\"], reviews: [\"reviews\", \"review count\", \"reviews count\"],\n  website: [\"website\", \"site\", \"url\", \"web\"], phone: [\"phone\", \"phone number\", \"phone (from their website)\", \"mobile\"], profile: [\"profile\", \"maps\", \"google maps\", \"maps url\", \"place id\"],\n  email: [\"email\", \"e-mail\"], suburb: [\"suburb\", \"area\", \"locality\", \"city\"], address: [\"address\"], owner_source: [\"owner source\", \"ask for source\"] };\nfunction rowsFromCSV(text) {\n  const t = parseCSV(text); if (t.length < 2) return [];\n  const head = t[0].map((h) => h.trim().toLowerCase());\n  const idx = {}; for (const [k, names] of Object.entries(COLS)) idx[k] = head.findIndex((h) => names.includes(h));\n  if (idx.name < 0) return [];\n  return t.slice(1).map((r) => Object.fromEntries(Object.entries(idx).filter(([, i]) => i >= 0).map(([k, i]) => [k, (r[i] || \"\").trim()]))).filter((r) => r.name && r.name !== \"Unnamed\");\n}\nasync function startSweep() {\n  S.err = \"\"; S.busy = true; render();\n  try {\n    const areas = [...S.picked];\n    try { localStorage.setItem(\"pr.last\", JSON.stringify({ niche: S.niche.name, city: S.city.name, pages: S.pages, target: S.target })); } catch (e) {}\n    const r = await call(\"/api/sweeps\", { method: \"POST\", body: { niche: S.niche.name, city: S.city.name, state: S.city.state, areas, pages: S.pages, target: S.target } });\n    if (r.target) return goalSweep(r);\n    S.sweepId = r.id; S.busy = false; S.view = \"sweeping\";\n    S.run = { id: r.id, mode: \"google\", cursor: 0, total: r.areas, found: 0, label: `${S.niche.name} \u00b7 ${S.city.name} \u00b7 ${r.areas} suburb${r.areas > 1 ? \"s\" : \"\"}` };\n    render();\n    let done = false, errs = 0, retries = 0, skipped = [];\n    while (!done && S.run?.id === r.id) {\n      let s;\n      try { s = await call(`/api/sweeps/${r.id}/step${retries >= 3 ? \"?skip=1\" : \"\"}`, { method: \"POST\" }); errs = 0; }\n      catch (e) { if (++errs > 2) { S.run.warn = e.message; break; } await new Promise((res) => setTimeout(res, 1500)); continue; }\n      if (s.busy) { await new Promise((res) => setTimeout(res, 1000)); continue; }\n      if (s.retry) { // Google hiccuped: wait and try this suburb again, then skip it after 3 goes\n        retries++; S.run.warn = `Google is busy, trying ${s.area} again\u2026`; if (S.view === \"sweeping\") render();\n        await new Promise((res) => setTimeout(res, 4000 * retries)); continue;\n      }\n      if (retries >= 3 && s.area) skipped.push(s.area);\n      retries = 0; S.run.warn = skipped.length ? `Google wouldn't answer for ${skipped.join(\", \")}. Sweep that suburb again later.` : \"\";\n      Object.assign(S.run, { cursor: s.cursor, total: s.total, found: s.found });\n      if (s.usage) S.cfg.usage = s.usage;\n      if (s.googleError) S.run.warn = `Google said: ${s.googleError}`;\n      if (s.stoppedForCap) S.run.warn = \"Stopped early to stay inside your Google limit.\";\n      done = s.done;\n      if (S.view === \"sweeping\") render();\n    }\n    S.run.searchDone = true;\n    await loadSweeps(r.id);\n    S.run.found = S.leads.length;\n    S.run.median = Math.round(marketStats(S.leads).median);\n    S.run.remaining = S.leads.filter((l) => l.enrich_state !== \"done\").length;\n    if (S.view === \"sweeping\") render();\n    enrichLoop(r.id);\n  } catch (e) { S.busy = false; S.err = e.message; if (S.view === \"sweeping\") S.view = \"sweep\"; render(); }\n}\n\n// Goal sweep: search a page, hunt emails, repeat until there are enough verified emails.\nasync function goalSweep(r) {\n  const id = r.id;\n  S.sweepId = id; S.busy = false; S.view = \"sweeping\";\n  S.run = { id, mode: \"goal\", target: r.target, verified: 0, found: 0, pending: 0, checked: 0, searches: 0, label: `${S.niche.name} \u00b7 ${S.city.name}` };\n  render();\n  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));\n  let errs = 0, a = null;\n  while (S.run?.id === id) {\n    try { a = await call(`/api/sweeps/${id}/advance`, { method: \"POST\" }); errs = 0; }\n    catch (e) { if (++errs > 3) { S.run.warn = e.message; break; } await sleep(2000); continue; }\n    Object.assign(S.run, { verified: a.verified, found: a.found, pending: a.pending, checked: a.checked, searches: a.searches });\n    if (a.usage) S.cfg.usage = a.usage;\n    S.run.warn = a.action === \"retry\" ? `Google is busy, trying ${a.area} again\u2026` : a.googleError ? `Google said: ${a.googleError}` : \"\";\n    if (a.area && a.action === \"searched\") S.run.last = a.page > 1 ? `${a.area} (page ${a.page})` : a.area;\n    if (S.view === \"sweeping\") render();\n    if (a.done) break;\n    if (a.action === \"retry\") { await sleep(4000); continue; }\n    if (a.action === \"searched\" && a.pending < 3) continue; // nothing much to check yet: search again straight away\n    // hunt emails on the leads found so far\n    let processed = 0;\n    try { const rs = await Promise.all([0, 1, 2].map(() => call(`/api/enrich-next?sweep=${id}`, { method: \"POST\" }))); processed = rs.reduce((n, x) => n + (x.processed || 0), 0); } catch (e) {}\n    if (!processed) await sleep(3000); // the background timer has them, or a site is slow\n  }\n  const reasons = { target: \"\", \"ran-out\": `Only ${a?.verified ?? 0} in ${S.city.name} so far. Leads still being re-checked may add a few. Try another city for more.`,\n    \"search-cap\": `Stopped at ${a?.searches} searches to protect your Google allowance, with ${a?.verified ?? 0} leads with emails.`,\n    \"google-limit\": \"Stopped to stay inside your Google limit.\", \"google-error\": S.run.warn };\n  if (a?.done) S.run.warn = reasons[a.reason] || S.run.warn;\n  S.run.finished = true;\n  await loadSweeps(id);\n  S.run.median = Math.round(marketStats(S.leads).median);\n  S.run.remaining = S.leads.filter((l) => l.enrich_state !== \"done\").length;\n  if (S.view === \"sweeping\") render();\n  if (S.run.remaining) enrichLoop(id); // finish checking whatever is left: bonus leads\n}\n\nasync function importText(text) {\n  S.err = \"\";\n  const rows = rowsFromCSV(text);\n  if (!rows.length) { S.err = \"That file doesn't look right. It needs a header row with at least a Name column.\"; return render(); }\n  S.busy = true; render();\n  try {\n    localStorage.setItem(\"pr.last\", JSON.stringify({ niche: S.niche.name, city: S.city.name }));\n    S.view = \"sweeping\";\n    S.run = { id: null, mode: \"import\", found: 0, label: `${S.niche.name} \u00b7 ${S.city.name}` }; render();\n    const r = await call(\"/api/import\", { method: \"POST\", body: { niche: S.niche.name, city: S.city.name, state: S.city.state, rows } });\n    S.busy = false; S.sweepId = r.id;\n    Object.assign(S.run, { id: r.id, found: r.imported, searchDone: true });\n    await loadSweeps(r.id);\n    S.run.median = Math.round(marketStats(S.leads).median);\n    S.run.remaining = S.leads.filter((l) => l.enrich_state !== \"done\").length;\n    render();\n    enrichLoop(r.id);\n  } catch (e) { S.busy = false; S.err = e.message; S.view = \"sweep\"; S.run = null; render(); }\n}\n\nasync function enrichLoop(id) {\n  if (S.enriching) return;\n  S.enriching = true;\n  let fails = 0, idle = 0, sinceRefresh = 0;\n  try {\n    while (true) {\n      let rs;\n      try { rs = await Promise.all([0, 1, 2].map(() => call(`/api/enrich-next?sweep=${id}`, { method: \"POST\" }))); fails = 0; }\n      catch (e) { if (++fails > 3) break; await new Promise((res) => setTimeout(res, 3000)); continue; }\n      const processed = rs.reduce((a, r) => a + (r.processed || 0), 0);\n      const remaining = Math.min(...rs.map((r) => r.remaining ?? 0));\n      if (S.run && S.run.id === id) S.run.remaining = remaining;\n      sinceRefresh += processed;\n      if (S.view === \"sweeping\") render();\n      if (sinceRefresh >= 6 || remaining === 0) {\n        sinceRefresh = 0;\n        if (S.sweepId === id && S.view === \"targets\" && !S.sheet) { await loadLeads(); S.keepScroll = true; render(); }\n      }\n      if (!remaining) break;\n      if (!processed) { if (++idle > 40) break; await new Promise((res) => setTimeout(res, 4000)); } else idle = 0; // others (the background timer) are working on the rest\n    }\n  } finally {\n    S.enriching = false;\n    if (S.sweepId === id) { try { await loadLeads(); } catch (e) {} }\n    if (S.view === \"targets\" && !S.sheet) { S.keepScroll = true; render(); }\n  }\n}\n\nasync function openLead(id) {\n  const l = S.leads.find((x) => x.place_id === id) || S.pipeline?.due.find((x) => x.place_id === id) || S.pipeline?.recent.find((x) => x.place_id === id);\n  if (!l) return;\n  S.lead = { ...l }; S.sheet = \"lead\"; renderSheet();\n}\nasync function saveLead(patch, quiet) {\n  const id = S.lead.place_id;\n  Object.assign(S.lead, patch); if (!quiet) renderSheet();\n  try {\n    const updated = await call(`/api/leads/${encodeURIComponent(id)}`, { method: \"PATCH\", body: patch });\n    for (const arr of [S.leads, S.pipeline?.due, S.pipeline?.recent]) { const x = arr?.find((y) => y.place_id === id); if (x) Object.assign(x, updated); }\n    if (S.lead?.place_id === id) { const draft = document.getElementById(\"notes\")?.value; Object.assign(S.lead, updated); if (quiet && draft != null) S.lead.notes = draft; }\n  } catch (e) { toast(e.message); }\n}\nfunction closeSheet() {\n  const wasLead = S.sheet === \"lead\";\n  S.sheet = null; S.lead = null;\n  if (wasLead) { S.keepScroll = true; if (S.view === \"pipeline\") loadPipeline().then(render).catch(() => render()); else render(); }\n  else render();\n}\nfunction exportCSV() {\n  const q = (v) => `\"${String(v ?? \"\").replace(/\"/g, '\"\"')}\"`;\n  const head = [\"Business\", \"Ask for\", \"Email\", \"Website\", \"Phone (from their website)\", \"Status\", \"Follow up\", \"Notes\", \"Niche\", \"City\"];\n  const rows = S.leads.map((l) => [l.name, l.owner, l.email, l.website, l.site_phone, statusName(l.status), l.follow_up, l.notes, S.sweep?.niche, S.sweep?.city].map(q).join(\",\"));\n  const blob = new Blob([[head.join(\",\"), ...rows].join(\"\\n\")], { type: \"text/csv;charset=utf-8\" });\n  const a = document.createElement(\"a\"); a.href = URL.createObjectURL(blob);\n  a.download = `radar-${(S.sweep?.niche || \"leads\").toLowerCase().replace(/[^a-z]+/g, \"-\")}-${(S.sweep?.city || \"\").toLowerCase().replace(/[^a-z]+/g, \"-\")}.csv`;\n  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);\n}\nasync function go(view) {\n  S.view = view; window.scrollTo(0, 0);\n  if (view === \"sweep\" && S.run && !S.run.searchDone) S.view = \"sweeping\";\n  render();\n  try {\n    if (view === \"targets\") { await loadSweeps(); render(); }\n    if (view === \"pipeline\") { await loadPipeline(); render(); }\n    if (view === \"sweep\" && S.cfg) { const c = await call(\"/api/config\"); S.cfg.usage = c.usage; S.cfg.hasKey = c.hasKey; render(); }\n  } catch (e) { toast(e.message); }\n}\n\n// ------------------------------------------------------------------ events\ndocument.addEventListener(\"click\", async (e) => {\n  const t = e.target.closest(\"button,a\"); if (!t) { if (e.target.id === \"ov\") closeSheet(); return; }\n  const d = t.dataset;\n  if (d.tab) return go(d.tab);\n  if (d.open) { S.sheet = d.open; return renderSheet(); }\n  if (\"close\" in d) return closeSheet();\n  if (d.niche) { S.niche = S.cfg.niches[+d.niche]; S.sheet = null; return render(); }\n  if (d.city) { setCity(S.cfg.cities[+d.city]); S.sheet = null; return render(); }\n  if (d.area) { S.picked.has(d.area) ? S.picked.delete(d.area) : S.picked.add(d.area); S.keepScroll = true; return render(); }\n  if (d.pages) { S.pages = +d.pages; S.keepScroll = true; return render(); }\n  if (d.target != null) { S.target = +d.target; S.keepScroll = true; return render(); }\n  if (d.filter) { S.filter = d.filter; S.keepScroll = true; return render(); }\n  if (d.lead) return openLead(d.lead);\n  if (d.status) return saveLead({ status: d.status });\n  if (d.fu) { const x = new Date(); x.setDate(x.getDate() + +d.fu); const v = new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); return saveLead({ follow_up: v }); }\n  if (t.id === \"copyMsg\") { try { await navigator.clipboard.writeText(claudeMsg()); S.copied = true; } catch (err) { toast(\"Couldn't copy. Press and hold the message to copy it.\"); } S.keepScroll = true; render(); setTimeout(() => { S.copied = false; }, 2500); return; }\n  if (t.id === \"pasteGo\") return importText(document.getElementById(\"csvPaste\").value);\n  if (t.id === \"go\") return startSweep();\n  if (t.id === \"export\") return exportCSV();\n  if (t.id === \"rehunt\") {\n    try { const r = await call(`/api/sweeps/${S.sweepId}/rehunt`, { method: \"POST\" }); toast(`Re-checking ${r.queued} websites\u2026`); await loadLeads(); S.keepScroll = true; render(); enrichLoop(S.sweepId); } catch (err) { toast(err.message); }\n    return;\n  }\n  if (t.id === \"delSweep\") {\n    if (!confirmDelete) { confirmDelete = true; t.textContent = \"Tap again to delete\"; setTimeout(() => { confirmDelete = false; }, 3000); return; }\n    confirmDelete = false;\n    try { await call(`/api/sweeps/${S.sweepId}`, { method: \"DELETE\" }); S.sweepId = null; await loadSweeps(); render(); toast(\"Sweep deleted\"); } catch (err) { toast(err.message); }\n  }\n});\nlet confirmDelete = false;\ndocument.addEventListener(\"submit\", (e) => {\n  e.preventDefault();\n  if (e.target.id === \"addArea\") {\n    const v = document.getElementById(\"areaIn\").value.trim();\n    if (v && !S.areas.includes(v)) { S.areas.push(v); S.picked.add(v); }\n    S.keepScroll = true; render();\n  }\n  if (e.target.id === \"otherCity\") {\n    const n = document.getElementById(\"ocName\").value.trim(), st = document.getElementById(\"ocState\").value.trim().toUpperCase();\n    if (n) { S.city = { name: n, state: st, areas: [] }; S.areas = [n]; S.picked = new Set([n]); S.sheet = null; render(); }\n  }\n});\ndocument.addEventListener(\"change\", (e) => {\n  if (e.target.id === \"csvIn\" && e.target.files[0]) { const f = e.target.files[0]; f.text().then(importText).catch(() => toast(\"Couldn't read that file.\")); e.target.value = \"\"; return; }\n  if (e.target.id === \"sweepSel\") { S.sweepId = +e.target.value; S.filter = \"all\"; loadLeads().then(render).catch((err) => toast(err.message)); }\n  if (e.target.id === \"fu\") saveLead({ follow_up: e.target.value || \"\" });\n  if (e.target.id === \"notes\") saveLead({ notes: e.target.value }, true);\n});\ndocument.addEventListener(\"keydown\", (e) => { if (e.key === \"Escape\" && S.sheet) closeSheet(); });\n\n(async function boot() {\n  render();\n  try { await loadConfig(); } catch (e) { S.err = e.message; S.cfg = { niches: [], cities: [] }; }\n  render();\n  try {\n    const sw = await call(\"/api/sweeps\");\n    const pending = sw.sweeps.find((s) => s.status === \"done\");\n    if (pending) enrichLoop(pending.id);\n  } catch (e) {}\n})();\n</script>\n</body>\n</html>\n";
const ICON_B64 = "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";

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
  `DROP INDEX IF EXISTS idx_leads_enrich`, // replaced by idx_leads_queue; every extra index costs a database write
  `CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`,
  `CREATE TABLE IF NOT EXISTS harvests (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, status TEXT DEFAULT 'running', max_req INTEGER, requests INTEGER DEFAULT 0, created_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS hjobs (id INTEGER PRIMARY KEY AUTOINCREMENT, harvest_id INTEGER, sweep_id INTEGER, phrase TEXT, region TEXT, lat1 REAL, lng1 REAL, lat2 REAL, lng2 REAL,
     page INTEGER DEFAULT 1, token TEXT, prio INTEGER DEFAULT 0, status TEXT DEFAULT 'todo', fails INTEGER DEFAULT 0, got INTEGER, fresh INTEGER, done_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS idx_hjobs_q2 ON hjobs(harvest_id, status, prio DESC, id)`,
  `CREATE TABLE IF NOT EXISTS suppress (key TEXT PRIMARY KEY, kind TEXT, note TEXT, created_at INTEGER)`, // businesses already emailed: never export them again
  `CREATE INDEX IF NOT EXISTS idx_leads_queue ON leads(enrich_state, created_at)`,
];
let migrated = false;
async function migrate(env) {
  if (migrated) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  for (const col of ["enrich_tries INTEGER DEFAULT 0", "email_ok INTEGER", "contact_url TEXT", "has_form INTEGER", "retry_at INTEGER", "block_tries INTEGER DEFAULT 0"]) {
    try { await env.DB.prepare("ALTER TABLE leads ADD COLUMN " + col).run(); } catch (e) { /* already there */ }
  }
  try { await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_leads_retry ON leads(retry_at)").run(); } catch (e) {}
  for (const col of ["target INTEGER", "picked INTEGER", "tokens TEXT", "verified INTEGER DEFAULT 0", "max_req INTEGER", "fails INTEGER DEFAULT 0", "end_reason TEXT"]) {
    try { await env.DB.prepare("ALTER TABLE sweeps ADD COLUMN " + col).run(); } catch (e) { /* already there */ }
  }
  migrated = true;
}

// ---------------------------------------------------------------- helpers
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" } });
const err = (message, status = 400) => json({ error: message }, status);
const monthKey = () => new Date(Date.now() + 10 * 3600000).toISOString().slice(0, 7);
const dayKey = () => new Date(Date.now() + 10 * 3600000).toISOString().slice(0, 10); // Brisbane day
const cap = (env) => parseInt(env.MONTHLY_CAP || "3300", 10) || 3300;
const dayCap = (env) => parseInt(env.DAILY_CAP || "1200", 10) || 1200;
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
async function placesSearch(env, textQuery, pageToken, rect = null, region = "AU") {
  const body = { textQuery, pageSize: 20, regionCode: region, languageCode: "en" };
  if (rect) body.locationRestriction = { rectangle: { low: { latitude: rect[0], longitude: rect[1] }, high: { latitude: rect[2], longitude: rect[3] } } };
  if (pageToken) body.pageToken = pageToken;
  let last = null;
  // Google sometimes says no for a moment (busy, or billing still settling). Try up to 3 times before giving up.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((res) => setTimeout(res, 1200 * attempt));
    let r;
    try {
      r = await fetch(`${env.PLACES_BASE || PLACES}/places:searchText`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Goog-Api-Key": String(env.GOOGLE_KEY).trim(),
          "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.types,places.reviews,nextPageToken",
        },
        body: JSON.stringify(body),
      });
    } catch (e) { last = { status: 0, msg: "Couldn't reach Google" }; continue; }
    const data = await r.json().catch(() => ({}));
    if (r.ok) return data;
    const msg = data?.error?.message || `Google returned ${r.status}`;
    last = { status: r.status, msg };
    if (/API key not valid|not been used|disabled|blocked/i.test(msg) || r.status === 400) break; // a real setup problem, retrying won't help
  }
  const msg = last.msg;
  const e = new Error(/API key not valid/i.test(msg) ? "Google says the API key isn't valid. Check the GOOGLE_KEY secret." : /not been used|disabled|blocked/i.test(msg) ? "Google refused the key. Check that Places API (New) is enabled and the key isn't restricted to websites or IPs." : msg);
  e.transient = last.status === 0 || last.status === 403 || last.status === 429 || last.status >= 500;
  throw e;
}
function suburbOf(place) {
  const c = (place.addressComponents || []).find((x) => (x.types || []).includes("locality"));
  return c?.longText || c?.shortText || "";
}

// Save one page of Google results into the leads list (owner names come from the reviews in the same call).
async function savePlaces(env, sweepId, raw, now) {
  const places = (raw || []).filter((p) => p.id && p.businessStatus !== "CLOSED_PERMANENTLY");
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
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO sweep_leads (sweep_id, place_id) VALUES (?, ?)").bind(sweepId, p.id));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return places;
}

// ---------------------------------------------------------------- goal sweeps: "keep going until I have N leads with verified emails"
// Search order: page 1 of each picked suburb, then pages 2 and 3 of those, then the rest of the city's suburbs the same way.
function goalPlan(s) {
  const areas = JSON.parse(s.areas || "[]"), picked = s.picked || areas.length;
  const out = [];
  for (const group of [areas.slice(0, picked), areas.slice(picked)]) for (let pg = 1; pg <= 3; pg++) for (const a of group) out.push([a, pg]);
  return out;
}
async function goalStats(env, id) {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS found,
      SUM(CASE WHEN l.email IS NOT NULL AND l.email != '' AND COALESCE(l.email_ok, 1) != 0 THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN l.enrich_state != 'done' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN l.enrich_state = 'done' THEN 1 ELSE 0 END) AS checked
    FROM sweep_leads sl JOIN leads l ON l.place_id = sl.place_id WHERE sl.sweep_id = ?`).bind(id).first();
  return { found: r.found || 0, verified: r.verified || 0, pending: r.pending || 0, checked: r.checked || 0 };
}
// One move toward the goal: decide whether to search another page, wait for the email hunt, or stop.
async function advanceGoal(env, s) {
  const id = s.id;
  const st = await goalStats(env, id);
  const base = { target: s.target, ...st, searches: s.requests };
  const finish = async (reason) => {
    await env.DB.prepare("UPDATE sweeps SET status = 'done', found = ?, verified = ?, end_reason = ? WHERE id = ? AND status = 'running'").bind(st.found, st.verified, reason, id).run();
    return { ...base, done: true, reason };
  };
  await env.DB.prepare("UPDATE sweeps SET found = ?, verified = ? WHERE id = ?").bind(st.found, st.verified, id).run();
  if (s.status !== "running") return { ...base, done: true, reason: s.end_reason || "done" };
  if (st.verified >= s.target) return finish("target");
  // Expect roughly this share of the leads still being checked to turn into usable emails (learned from this sweep so far).
  const rate = st.checked >= 8 ? Math.max(0.25, st.verified / st.checked) : 0.6;
  if (st.pending && st.verified + st.pending * rate >= s.target) return { ...base, action: "wait" };
  const u = await usage(env);
  if (s.requests >= s.max_req || u.left <= 0) return st.pending ? { ...base, action: "wait" } : finish(u.left <= 0 ? "google-limit" : "search-cap");
  const plan = goalPlan(s), tokens = JSON.parse(s.tokens || "{}");
  let cur = s.cursor;
  // pages 2 and 3 only exist if Google said there were more results for that suburb
  while (cur < plan.length && plan[cur][1] > 1 && !tokens[plan[cur][0]]) cur++;
  if (cur >= plan.length) return st.pending ? { ...base, action: "wait" } : finish("ran-out");
  const claim = await env.DB.prepare("UPDATE sweeps SET cursor = ? WHERE id = ? AND cursor = ? RETURNING cursor").bind(cur + 1, id, s.cursor).first();
  if (!claim) return { ...base, action: "busy" };
  const [area, page] = plan[cur];
  const textQuery = `${s.query} in ${area}${s.state ? " " + s.state : ""}`;
  let data;
  try { data = await placesSearch(env, textQuery, page > 1 ? tokens[area] : null); }
  catch (e) {
    if (e.transient && (s.fails || 0) < 2) { // Google hiccup: give the page back and try again shortly
      await env.DB.prepare("UPDATE sweeps SET cursor = ?, fails = COALESCE(fails, 0) + 1 WHERE id = ? AND cursor = ?").bind(s.cursor, id, cur + 1).run();
      return { ...base, action: "retry", area, googleError: e.message };
    }
    await env.DB.prepare("UPDATE sweeps SET fails = 0 WHERE id = ?").bind(id).run();
    if (page > 1 || e.transient) return { ...base, action: "searched", area, page, added: 0, skipped: true }; // an old page link or a suburb Google won't answer: move on
    return finish("google-error").then((r) => ({ ...r, googleError: e.message }));
  }
  await addUsage(env, "search");
  const places = await savePlaces(env, id, data.places, Date.now());
  tokens[area] = page < 3 ? data.nextPageToken || null : null;
  await env.DB.prepare("UPDATE sweeps SET requests = requests + 1, fails = 0, tokens = ? WHERE id = ?").bind(JSON.stringify(tokens), id).run();
  const after = await goalStats(env, id);
  return { ...base, ...after, searches: s.requests + 1, action: "searched", area, page, added: places.length, usage: await usage(env) };
}

// ---------------------------------------------------------------- harvest: cover whole cities with a grid of map squares
// Google only shows 60 results per search, so a busy square is split into four smaller ones until every business has shown up.
const METROS = {
  "Brisbane": { state: "QLD", box: [-27.72, 152.78, -27.18, 153.27] },
  "Gold Coast": { state: "QLD", box: [-28.22, 153.18, -27.74, 153.56] },
  "Sydney": { state: "NSW", box: [-34.20, 150.60, -33.55, 151.36] },
  "Melbourne": { state: "VIC", box: [-38.30, 144.58, -37.55, 145.46] },
  "Perth": { state: "WA", box: [-32.42, 115.70, -31.62, 116.12] },
  "Adelaide": { state: "SA", box: [-35.22, 138.44, -34.62, 138.82] },
  "Darwin": { state: "NT", box: [-12.56, 130.80, -12.33, 131.08] },
  "Sunshine Coast": { state: "QLD", box: [-26.90, 152.93, -26.36, 153.17] },
  "Newcastle": { state: "NSW", box: [-33.10, 151.40, -32.68, 151.82] },
  "Central Coast": { state: "NSW", box: [-33.55, 151.15, -33.18, 151.65] },
  "Wollongong": { state: "NSW", box: [-34.62, 150.74, -34.24, 150.96] },
  "Canberra": { state: "ACT", box: [-35.55, 148.98, -35.12, 149.28] },
  "Geelong": { state: "VIC", box: [-38.32, 144.24, -38.00, 144.56] },
  "Hobart": { state: "TAS", box: [-43.05, 147.12, -42.72, 147.50] },
  "Toowoomba": { state: "QLD", box: [-27.66, 151.84, -27.47, 152.03] },
  "Townsville": { state: "QLD", box: [-19.40, 146.62, -19.14, 146.90] },
  "Cairns": { state: "QLD", box: [-17.10, 145.64, -16.70, 145.83] },
  "Ballarat": { state: "VIC", box: [-37.66, 143.74, -37.47, 143.96] },
  "Bendigo": { state: "VIC", box: [-36.86, 144.19, -36.67, 144.39] },
  "Launceston": { state: "TAS", box: [-41.53, 147.04, -41.35, 147.23] },
  "Mackay": { state: "QLD", box: [-21.21, 149.07, -21.04, 149.26] },
};
const HARVEST_NICHES = {
  roofing: { niche: "Roofers", phrases: ["roofing contractor", "roof restoration", "roof repairs"] },
  renovation: { niche: "Kitchen & Bath / General Remodelers", phrases: ["home renovation builder", "bathroom renovations", "kitchen renovations"] },
  // construction and design only: mowing, garden upkeep and tree services are skipped by name
  landscaping: { niche: "Landscape Construction & Design", phrases: ["landscape construction", "landscape design", "landscaping company"],
    // also skips supply yards (soil, turf, pavers, mulch, wholesale), which sell materials rather than build
    skip: (name) => /mow|mowing|garden(ing)? (maint|care|service)|gardening|yard (care|maint|clean)|yardbusters|hedg|weed|tree (lop|lopping|removal|service|surgeon|felling|care)|arborist|green waste|jim'?s|rubbish|suppl(y|ies)|wholesale|hardware|mulch|nurser(y|ies)|\bsoils?\b|turf (farm|supplies)|garden cent(re|er)|bunnings/i.test(name)
      || (/lawn|maintenance/i.test(name) && !/landscap|construct|design/i.test(name)) },
};
const skipFor = (phrase) => Object.values(HARVEST_NICHES).find((n) => n.phrases.includes(phrase))?.skip;
const CELL = 0.15; // starting square, about 15 km across
function gridCells(box, size = CELL) {
  const out = [];
  for (let la = box[0]; la < box[2] - 1e-9; la += size) for (let lo = box[1]; lo < box[3] - 1e-9; lo += size)
    out.push([+la.toFixed(5), +lo.toFixed(5), +Math.min(la + size, box[2]).toFixed(5), +Math.min(lo + size, box[3]).toFixed(5)]);
  return out;
}
async function createHarvest(env, b) {
  const cities = (b.cities || []).filter((c) => METROS[c]);
  const niches = (b.niches || []).filter((n) => HARVEST_NICHES[n]);
  if (!cities.length || !niches.length) throw new Error("Pick at least one city and one niche.");
  const h = await env.DB.prepare("INSERT INTO harvests (name, max_req, created_at) VALUES (?, ?, ?) RETURNING id").bind(String(b.name || "Harvest").slice(0, 80), Math.max(1, parseInt(b.maxRequests, 10) || 2500), Date.now()).first();
  let jobs = 0;
  for (const c of cities) for (const n of niches) {
    const m = METROS[c], hn = HARVEST_NICHES[n];
    const sw = await env.DB.prepare("INSERT INTO sweeps (niche, city, state, query, areas, pages, status, created_at) VALUES (?, ?, ?, ?, '[]', 3, 'harvest', ?) RETURNING id").bind(hn.niche, c, m.state, hn.phrases[0], Date.now()).first();
    const stmts = [];
    // first phrase everywhere first (it finds most businesses), the extra phrases after, to pick up the rest
    hn.phrases.forEach((ph, i) => { for (const r of gridCells(m.box)) stmts.push(env.DB.prepare("INSERT INTO hjobs (harvest_id, sweep_id, phrase, region, lat1, lng1, lat2, lng2, prio) VALUES (?, ?, ?, 'AU', ?, ?, ?, ?, ?)").bind(h.id, sw.id, ph, r[0], r[1], r[2], r[3], 100 - i * 10)); });
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    jobs += stmts.length;
  }
  return { id: h.id, jobs };
}
// Run up to n searches for one harvest. Returns what happened.
async function runHarvest(env, hid, n = 2) {
  const h = await env.DB.prepare("SELECT * FROM harvests WHERE id = ?").bind(hid).first();
  if (!h || h.status !== "running") return { ran: 0, status: h?.status || "missing" };
  let ran = 0, fresh = 0, errors = [];
  for (let k = 0; k < n; k++) {
    const u = await usage(env);
    if (u.left <= 0) return { ran, fresh, status: "google-limit", errors };
    const utcDay = new Date().toISOString().slice(0, 10), pace = parseInt(env.HARVEST_DAY || "400", 10) || 400;
    const doneToday = await env.DB.prepare("SELECT count FROM usage WHERE month = ? AND kind = 'harvest'").bind(utcDay).first("count") || 0;
    if (doneToday >= pace) return { ran, fresh, status: "running", paced: true, errors }; // enough for today: the free database allows ~100k writes a day
    if (h.requests + ran >= h.max_req) { await env.DB.prepare("UPDATE harvests SET status = 'cap' WHERE id = ?").bind(hid).run(); return { ran, fresh, status: "cap", errors }; }
    // page-2/3 links go stale, so those are always taken first
    const job = await env.DB.prepare("UPDATE hjobs SET status = 'doing', done_at = ? WHERE id = (SELECT id FROM hjobs WHERE harvest_id = ? AND status = 'todo' ORDER BY prio DESC, id LIMIT 1) RETURNING *").bind(Date.now(), hid).first();
    if (!job) {
      const busy = await env.DB.prepare("SELECT COUNT(*) AS n FROM hjobs WHERE harvest_id = ? AND status = 'doing'").bind(hid).first("n");
      if (!busy) await env.DB.prepare("UPDATE harvests SET status = 'done' WHERE id = ?").bind(hid).run();
      return { ran, fresh, status: busy ? "running" : "done", errors };
    }
    const rect = [job.lat1, job.lng1, job.lat2, job.lng2];
    let data;
    try { data = await placesSearch(env, job.phrase, job.page > 1 ? job.token : null, rect, job.region || "AU"); }
    catch (e) {
      errors.push(e.message);
      const again = e.transient && job.fails < 3;
      await env.DB.prepare("UPDATE hjobs SET status = ?, fails = fails + 1 WHERE id = ?").bind(again ? "todo" : "fail", job.id).run();
      if (!again && !e.transient && job.page === 1) { await env.DB.prepare("UPDATE harvests SET status = 'error' WHERE id = ?").bind(hid).run(); return { ran, fresh, status: "error", errors }; }
      continue;
    }
    await addUsage(env, "search"); ran++;
    await env.DB.prepare("INSERT INTO usage (month, kind, count) VALUES (?, 'harvest', 1) ON CONFLICT(month, kind) DO UPDATE SET count = count + 1").bind(utcDay).run();
    const skip = skipFor(job.phrase), rawCount = (data.places || []).length;
    if (skip) data.places = (data.places || []).filter((p) => !skip(p.displayName?.text || ""));
    const ids = (data.places || []).map((p) => p.id).filter(Boolean);
    let known = 0;
    if (ids.length) known = await env.DB.prepare(`SELECT COUNT(*) AS n FROM leads WHERE place_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).first("n");
    const places = await savePlaces(env, job.sweep_id, data.places, Date.now());
    const newOnes = Math.max(0, ids.length - known); fresh += newOnes;
    const stmts = [env.DB.prepare("UPDATE hjobs SET status = 'done', got = ?, fresh = ?, token = NULL WHERE id = ?").bind(places.length, newOnes, job.id),
      env.DB.prepare("UPDATE harvests SET requests = requests + 1 WHERE id = ?").bind(hid)];
    const ins = (r, page, token, prio) => env.DB.prepare("INSERT INTO hjobs (harvest_id, sweep_id, phrase, region, lat1, lng1, lat2, lng2, page, token, prio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(hid, job.sweep_id, job.phrase, job.region || "AU", r[0], r[1], r[2], r[3], page, token, prio);
    if (data.nextPageToken && job.page < 3) {
      // only keep paging if this page still brought new businesses (or it's the first page)
      if (job.page === 1 || newOnes >= 3) stmts.push(ins(rect, job.page + 1, data.nextPageToken, 1000));
    } else if (job.page === 3 && rawCount === 20 && (rect[2] - rect[0]) > 0.02) {
      // 60 results and still more: this square is busy, so split it into four
      const mla = +((rect[0] + rect[2]) / 2).toFixed(5), mlo = +((rect[1] + rect[3]) / 2).toFixed(5);
      for (const r of [[rect[0], rect[1], mla, mlo], [rect[0], mlo, mla, rect[3]], [mla, rect[1], rect[2], mlo], [mla, mlo, rect[2], rect[3]]]) stmts.push(ins(r, 1, null, job.prio + 5));
    }
    await env.DB.batch(stmts);
  }
  return { ran, fresh, status: "running", errors };
}
async function harvestStats(env, hid) {
  const h = await env.DB.prepare("SELECT * FROM harvests WHERE id = ?").bind(hid).first();
  if (!h) return null;
  const jobs = await env.DB.prepare("SELECT status, COUNT(*) AS n, SUM(COALESCE(fresh, 0)) AS fresh FROM hjobs WHERE harvest_id = ? GROUP BY status").bind(hid).all();
  const { results } = await env.DB.prepare(`SELECT s.id, s.niche, s.city, COUNT(*) AS found,
      SUM(CASE WHEN l.email IS NOT NULL AND l.email != '' AND COALESCE(l.email_ok, 1) != 0 THEN 1 ELSE 0 END) AS emails,
      SUM(CASE WHEN l.enrich_state != 'done' THEN 1 ELSE 0 END) AS pending
    FROM sweeps s JOIN sweep_leads sl ON sl.sweep_id = s.id JOIN leads l ON l.place_id = sl.place_id
    WHERE s.id IN (SELECT DISTINCT sweep_id FROM hjobs WHERE harvest_id = ?) GROUP BY s.id`).bind(hid).all();
  return { harvest: h, jobs: jobs.results, sweeps: results, usage: await usage(env) };
}
const FREE_MAIL_RE = /@(gmail|googlemail|hotmail|outlook|live|yahoo|ymail|bigpond|optusnet|icloud|me|mac|aol|tpg|iinet|westnet|internode|dodo|ozemail|msn|protonmail|proton|onthenet|volcano)\./i;
// ---------------------------------------------------------------- do-not-contact list (businesses already emailed)
// Same normalising as the import script: drop company suffixes, keep letters and numbers.
const suppressName = (n) => String(n || "").toLowerCase().replace(/\b(pty\.?|ltd\.?|inc\.?|llc|limited|company|co\.?)\b/g, " ").replace(/[^a-z0-9]/g, "");
function isSuppressed(banned, lead, email) {
  if (!banned.size) return false;
  if (email && (banned.has("email:" + email) || (!FREE_MAIL_RE.test(email) && banned.has("domain:" + email.split("@")[1])))) return true;
  try { if (lead.website && banned.has("domain:" + new URL(lead.website).hostname.replace(/^www\./, "").toLowerCase())) return true; } catch {}
  const nn = suppressName(lead.name);
  return nn.length >= 5 && banned.has("name:" + nn);
}

// Every usable email once: same email or same company domain only counted once. Split into day batches.
async function harvestPool(env, sweepIds) {
  if (!sweepIds.length) return [];
  const { results } = await env.DB.prepare(`SELECT l.place_id, l.name, l.owner, l.email, l.website, l.suburb, l.phone, l.rating, l.reviews, l.created_at, s.niche, s.city
    FROM sweep_leads sl JOIN leads l ON l.place_id = sl.place_id JOIN sweeps s ON s.id = sl.sweep_id
    WHERE sl.sweep_id IN (${sweepIds.map(() => "?").join(",")}) AND l.email IS NOT NULL AND l.email != '' AND COALESCE(l.email_ok, 1) != 0
    ORDER BY l.created_at, l.place_id`).bind(...sweepIds).all();
  const seen = new Set(), out = [];
  const { results: sup } = await env.DB.prepare("SELECT key FROM suppress").all();
  const banned = new Set(sup.map((x) => x.key));
  let suppressed = 0;
  for (const r of results) {
    const e = r.email.trim().toLowerCase();
    if (isSuppressed(banned, r, e)) { suppressed++; continue; }
    const key = FREE_MAIL_RE.test(e) ? e : e.split("@")[1];
    if (seen.has(key)) continue;
    seen.add(key); out.push({ ...r, email: e });
  }
  out.suppressed = suppressed;
  return out;
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
function ownerFromReviews(reviews, businessName = "", address = "") {
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
function collectEmails(html) {
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
function pickEmail(cands, siteUrl, lead = {}) {
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
    s += (c.mailto ? 6 : 2) + (c.listed ? 10 : 0); // repeated sightings add up
    scores.set(c.email, s);
  }
  let best = "", bestS = -1;
  for (const [e, s] of scores) if (s > bestS) { best = e; bestS = s; }
  return best;
}

function ownerFromSite(html) {
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
function adSignals(html) {
  return {
    gads: /AW-\d{6,}|googleadservices\.com\/pagead\/conversion|google_conversion_id/i.test(html) ? 1 : 0,
    meta: /connect\.facebook\.net\/[^"']*fbevents\.js|fbq\(\s*['"]init/i.test(html) ? 1 : 0,
    gtm: /GTM-[A-Z0-9]{4,}/.test(html) ? 1 : 0,
    builder: /wixstatic|wix\.com/i.test(html) ? "Wix" : /squarespace/i.test(html) ? "Squarespace" : /cdn\.shopify|shopify\.com/i.test(html) ? "Shopify" : /wp-content|wordpress/i.test(html) ? "WordPress" : /godaddy|img1\.wsimg/i.test(html) ? "GoDaddy" : "",
  };
}
function sitePhone(html) {
  const m = html.match(/href=["']tel:([+\d\s()-]{8,20})["']/i);
  if (!m) return "";
  let d = m[1].replace(/[^\d+]/g, "");
  if (d.startsWith("+61")) d = "0" + d.slice(3);
  return /^0\d{9}$/.test(d) || /^1[38]00\d{6}$/.test(d) || /^13\d{4}$/.test(d) ? d : "";
}
// Same-site links that probably lead to contact details, best first.
function contactLinks(html, pageUrl) {
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
// Signs of a bot-check page. (Not plain "captcha": lots of normal sites load reCAPTCHA for their contact form.)
const CHALLENGE = /sgcaptcha|cf-browser-verification|cf_chl_|just a moment\.\.\.|checking your browser|imunify360|bot protection|are you a robot|access denied|attention required|ddos protection|captcha-delivery|px-captcha|hcaptcha-challenge|verify you are human/i;

async function fetchPage(url, ms = 10000) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow", signal: AbortSignal.timeout(ms) });
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

// Old domains get sold or re-used. If the homepage never mentions the business's name or phone, it isn't their site any more.
const NAME_FILLER = new Set(["the","and","pty","ltd","co","company","services","service","group","australia","qld","nsw","vic","gold","coast","brisbane","sydney","melbourne","sunshine","perth","adelaide","north","south","east","west","central","local","best","professional","solutions","clinic","centre","center","studio","family","dental","dentist","dentists","roofing","roofers","plumbing","electrical","home","homes"]);
function siteMatchesLead(html, lead) {
  if (!html || html.length < 3000) return true; // too little to judge (script-built pages)
  const low = html.toLowerCase().replace(/&amp;/g, "&");
  const words = String(lead.name || "").toLowerCase().replace(/[^a-z0-9& ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3);
  const key = words.filter((w) => !NAME_FILLER.has(w));
  if ((key.length ? key : words).some((w) => low.includes(w))) return true;
  const digits = String(lead.phone || "").replace(/\D/g, "").slice(-8);
  if (digits.length === 8) {
    const flat = low.replace(/[^0-9]/g, "");
    if (flat.includes(digits)) return true;
  }
  return false;
}

async function enrichLead(lead, trace = null) {
  const out = { email: "", site_phone: "", owner: "", gads: null, meta: null, gtm: null, builder: "", note: "", contact_url: "", has_form: 0 };
  if (!lead.website) { out.note = "no website"; return out; }
  let home;
  try { home = new URL(lead.website); } catch { out.note = "bad website"; return out; }
  if (/facebook\.com|instagram\.com|linktr\.ee|stmaps\.top|yellowpages\.com\.au|truelocal\.com\.au|hipages\.com\.au|oneflare\.com\.au|business\.site|yelp\.com|localsearch\.com\.au|google\.com/i.test(home.hostname)) { out.note = "no website (social or directory page only)"; return out; }
  const queue = [home.href];
  const done = new Set();
  let cands = [], fetched = 0, blocked = 0, down = 0, gone = 0, homeSeen = false;
  while (queue.length && done.size < 5) {
    const url = queue.shift();
    if (done.has(url)) continue;
    done.add(url);
    let p = await fetchPage(url);
    if (!p.status && done.size === 1 && /timeout|abort/i.test(p.error || "")) p = await fetchPage(url, 20000); // slow first load (common on Wix): one longer try
    if (trace) trace.push({ url, final: p.url !== url ? p.url : undefined, status: p.status, len: p.len, blocked: p.blocked, ms: p.ms, error: p.error, title: (p.html.match(/<title[^>]*>([^<]{0,120})/i) || [])[1] });
    if (p.blocked) blocked++;
    if (p.down) down++;
    if (p.status === 404 || p.status === 410) gone++;
    if (!p.html) {
      if (!homeSeen && done.size === 1) { // homepage failed: still try the usual contact paths
        if (home.pathname.length > 1 && !p.blocked) queue.push(`${home.protocol}//${home.host}/`); // the page Google links to is gone: start from the homepage
        for (const path of ["/contact", "/contact-us"]) queue.push(`${home.protocol}//${home.host}${path}`);
      }
      continue;
    }
    fetched++;
    if (!homeSeen) {
      homeSeen = true;
      if (!siteMatchesLead(p.html, lead)) { out.note = "website shows a different business"; if (trace) trace.push({ unrelated: true }); return out; }
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
    if (url === home.href && home.pathname.length > 1) for (const f of found) f.listed = true; // Google linked straight to this branch's own page
    if (trace && found.length) trace.push({ found: [...new Set(found.map((f) => f.email))].slice(0, 8), near: found.slice(0, 3).map((f) => { const i = p.html.indexOf(f.email.split('@')[0]); return i < 0 ? '' : p.html.slice(Math.max(0, i - 160), i + 80).replace(/\s+/g, ' '); }) });
    cands.push(...found);
    if (!out.site_phone) out.site_phone = sitePhone(p.html);
    if (!out.owner) out.owner = ownerFromSite(p.html);
    const best = pickEmail(cands, lead.website, lead);
    const dom = siteDomain(lead.website);
    if (best && (best.endsWith("@" + dom) || best.endsWith("." + dom) || done.size >= 2) && (out.owner || done.size >= 2)) break;
  }
  out.email = pickEmail(cands, lead.website, lead);
  if (!fetched) out.note = blocked ? "site blocks the email finder" : down ? "site is down" : gone && gone === done.size ? "website is broken (page not found)" : "site didn't load";
  else if (!out.email) out.note = blocked ? "no email found (some pages blocked)" : "no email on site";
  return out;
}

async function enrichNext(env, max = 1, sweepId = null, count = true) {
  const now = Date.now();
  // A lead whose scan crashed 3 times (usually a huge page) is given up on instead of retried forever.
  await env.DB.prepare("UPDATE leads SET enrich_state = 'done', enrich_note = 'site too heavy to scan' WHERE enrich_state = 'working' AND enrich_claimed < ? AND enrich_tries >= 3").bind(now - 3 * 60000).run();
  await env.DB.prepare("UPDATE leads SET enrich_state = 'pending' WHERE enrich_state = 'working' AND enrich_claimed < ?").bind(now - 3 * 60000).run();
  // sites that blocked us get one more try 10 minutes later (blocks are often short "too many visits" limits)
  await env.DB.prepare("UPDATE leads INDEXED BY idx_leads_retry SET enrich_state = 'pending', retry_at = NULL WHERE retry_at < ?").bind(now).run();
  const where = sweepId ? "AND place_id IN (SELECT place_id FROM sweep_leads WHERE sweep_id = ?)" : "";
  const stmt = env.DB.prepare(`UPDATE leads SET enrich_state = 'working', enrich_claimed = ?, enrich_tries = COALESCE(enrich_tries, 0) + 1 WHERE place_id IN (SELECT place_id FROM leads WHERE enrich_state = 'pending' ${where} ORDER BY created_at LIMIT ?) RETURNING place_id, name, website, suburb, phone, block_tries`);
  const { results } = await (sweepId ? stmt.bind(now, sweepId, max) : stmt.bind(now, max)).all();
  await Promise.all(results.map(async (lead) => {
    const r = await enrichLead(lead);
    const emailOk = r.email ? await domainTakesMail(r.email) : null;
    // One write per lead (database writes are the scarce resource on the free plan).
    // Every miss gets one second look a few minutes later: sites hiccup, rate-limit, or are slow on a first visit (a block waits 10 minutes).
    const tries = lead.block_tries || 0, miss = !r.email && /blocks the email finder|didn't load|site is down|no email/.test(r.note);
    const retryAt = miss && tries < 1 ? Date.now() + (/blocks/.test(r.note) ? 10 : 3) * 60000 : null;
    const newTries = r.email ? 0 : miss ? tries + 1 : tries;
    const gone = r.note === "website shows a different business";
    await env.DB.prepare(`UPDATE leads SET enrich_state = 'done', enrich_tries = 0, enriched_at = ?, enrich_note = CASE WHEN ? LIKE 'no email%' AND email != '' THEN '' ELSE ? END,
        email = CASE WHEN ? THEN '' WHEN ? != '' THEN ? ELSE email END,
        email_ok = CASE WHEN ? THEN NULL WHEN ? != '' THEN ? ELSE email_ok END, contact_url = ?, has_form = ?, site_phone = ?, gads = ?, meta = ?, gtm = ?, builder = ?,
        owner = CASE WHEN (owner IS NULL OR owner = '') AND ? != '' THEN ? ELSE owner END,
        owner_source = CASE WHEN (owner IS NULL OR owner = '') AND ? != '' THEN 'website' ELSE owner_source END,
        retry_at = ?, block_tries = ?
        WHERE place_id = ?`)
      .bind(Date.now(), r.note, r.note, gone ? 1 : 0, r.email, r.email, gone ? 1 : 0, r.email, emailOk, gone ? null : r.contact_url || null, gone ? 0 : r.has_form, r.site_phone, r.gads, r.meta, r.gtm, r.builder, r.owner, r.owner, r.owner, retryAt, newTries, lead.place_id).run();
  }));
  if (!count) return { processed: results.length };
  let q = "SELECT COUNT(*) AS n FROM leads WHERE enrich_state IN ('pending', 'working')"; // uses the index, cheap even with 20,000 leads
  const remaining = sweepId
    ? await env.DB.prepare(q + " AND place_id IN (SELECT place_id FROM sweep_leads WHERE sweep_id = ?)").bind(sweepId).first("n")
    : await env.DB.prepare(q).first("n");
  return { processed: results.length, remaining };
}

// ---------------------------------------------------------------- cleanup (untouched leads expire after 30 days)
async function cleanup(env) {
  const cutoff = Date.now() - 30 * DAY;
  // Untouched leads older than 30 days are removed entirely.
  const keep = "AND NOT (email IS NOT NULL AND email != '' AND place_id IN (SELECT place_id FROM sweep_leads WHERE sweep_id IN (SELECT DISTINCT sweep_id FROM hjobs)))";
  await env.DB.prepare(`DELETE FROM sweep_leads WHERE place_id IN (SELECT place_id FROM leads WHERE status = 'new' AND (notes IS NULL OR notes = '') AND google_at < ? ${keep})`).bind(cutoff).run();
  await env.DB.prepare(`DELETE FROM leads WHERE status = 'new' AND (notes IS NULL OR notes = '') AND google_at < ? ${keep}`).bind(cutoff).run();
  // Leads you've worked keep your own data; Google-sourced fields are cleared (refresh re-pulls them).
  await env.DB.prepare("UPDATE leads SET address = NULL, phone = NULL, phone_intl = NULL, rating = NULL, reviews = NULL WHERE google_at < ? AND address IS NOT NULL").bind(cutoff).run();
}

// ---------------------------------------------------------------- API
const LEAD_COLS = "l.place_id, l.name, l.address, l.suburb, l.phone, l.phone_intl, l.website, l.rating, l.reviews, l.google_at, l.email, l.email_ok, l.contact_url, l.has_form, l.site_phone, l.owner, l.owner_source, l.owner_checked, l.gads, l.meta, l.gtm, l.builder, l.enrich_state, l.enrich_note, l.status, l.notes, l.follow_up, l.contacted_at, l.updated_at";

async function api(request, env, path) {
  const method = request.method;
  let m;


  // ---- harvest (bulk city coverage)
  if (path === "/api/harvests" && method === "POST") {
    if (!env.GOOGLE_KEY) return err("The Google key isn't set yet.", 400);
    try { return json(await createHarvest(env, await request.json().catch(() => ({})))); } catch (e) { return err(e.message); }
  }
  if (path === "/api/harvests" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM harvests ORDER BY id DESC LIMIT 20").all();
    return json({ harvests: results, metros: Object.keys(METROS), niches: Object.keys(HARVEST_NICHES) });
  }
  if ((m = path.match(/^\/api\/harvests\/(\d+)$/)) && method === "GET") {
    const st = await harvestStats(env, +m[1]);
    return st ? json(st) : err("Not found", 404);
  }
  if ((m = path.match(/^\/api\/harvests\/(\d+)\/run$/)) && method === "POST") {
    const n = Math.min(10, Math.max(1, parseInt(new URL(request.url).searchParams.get("n") || "3", 10)));
    return json(await runHarvest(env, +m[1], n));
  }
  if ((m = path.match(/^\/api\/harvests\/(\d+)\/(pause|resume)$/)) && method === "POST") {
    await env.DB.prepare("UPDATE harvests SET status = ? WHERE id = ?").bind(m[2] === "pause" ? "paused" : "running", +m[1]).run();
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/harvests\/(\d+)\/limit$/)) && method === "POST") {
    const b = await request.json().catch(() => ({}));
    await env.DB.prepare("UPDATE harvests SET max_req = ?, status = CASE WHEN status = 'cap' THEN 'running' ELSE status END WHERE id = ?").bind(Math.max(1, parseInt(b.maxRequests, 10) || 1), +m[1]).run();
    return json({ ok: true });
  }
  if (path === "/api/suppress" && method === "POST") {
    const b = await request.json().catch(() => ({}));
    const note = String(b.note || "already emailed").slice(0, 80), now = Date.now(), keys = new Set();
    for (const r of (Array.isArray(b.rows) ? b.rows : []).slice(0, 5000)) {
      for (const e of String(r.email || "").toLowerCase().split(/[;,\s]+/)) {
        const em = e.replace(/^%20/, "").trim();
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(em)) continue;
        keys.add("email:" + em);
        if (!FREE_MAIL_RE.test(em)) keys.add("domain:" + em.split("@")[1]);
      }
      const nn = suppressName(r.name);
      if (nn.length >= 5) keys.add("name:" + nn);
    }
    const stmts = [...keys].map((k) => env.DB.prepare("INSERT OR IGNORE INTO suppress (key, kind, note, created_at) VALUES (?, ?, ?, ?)").bind(k, k.split(":")[0], note, now));
    for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM suppress").first("n");
    return json({ added: keys.size, total });
  }
  if (path === "/api/suppress" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT kind, COUNT(*) AS n FROM suppress GROUP BY kind").all();
    return json({ counts: results });
  }

  if (path === "/api/pool" && method === "GET") {
    // ?sweeps=1,2,3&per=300  -> CSV of usable leads split into day batches (or JSON summary with &summary=1)
    const q = new URL(request.url).searchParams;
    const ids = (q.get("sweeps") || "").split(",").map((x) => parseInt(x, 10)).filter(Boolean).slice(0, 300);
    const per = Math.min(2000, Math.max(1, parseInt(q.get("per") || "300", 10)));
    const pool = await harvestPool(env, ids);
    // mix niches and cities inside each day: deal one from each group in turn
    const groups = new Map();
    for (const r of pool) { const k = r.niche + "|" + r.city; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    const lists = [...groups.values()], mixed = [];
    for (let i = 0; mixed.length < pool.length; i++) for (const l of lists) if (l[i]) mixed.push(l[i]);
    if (q.get("summary")) {
      const by = {}; for (const r of pool) { const k = `${r.niche} · ${r.city}`; by[k] = (by[k] || 0) + 1; }
      return json({ total: pool.length, days: Math.floor(pool.length / per), per, by, suppressed: pool.suppressed || 0 });
    }
    const cell = (v) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const nicheName = (n) => (/Remodel/.test(n) ? "Renovations" : /Landscape/.test(n) ? "Landscaping" : n);
    const lines = ["Day,Business,First name,Email,Website,Suburb,City,Niche,Phone,Rating,Reviews"];
    mixed.forEach((r, i) => lines.push([Math.floor(i / per) + 1, r.name, (r.owner || "").split(/\s+/)[0], r.email, r.website, r.suburb, r.city, nicheName(r.niche), r.phone, r.rating, r.reviews].map(cell).join(",")));
    return new Response(lines.join("\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="prospect-pool-${pool.length}.csv"` } });
  }

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
    const target = Math.min(200, Math.max(0, parseInt(b.target, 10) || 0));
    if (target) {
      if (u.left < 1) return err(`No Google searches left ${u.limitBy === "day" ? "today" : "this month"}. Try again ${u.limitBy === "day" ? "tomorrow" : "next month"}.`);
      // after the picked suburbs, carry on into the rest of the city if needed
      const known = CITIES.find((c) => c.name === city.name);
      const extra = known ? known.areas.filter((a) => !areas.includes(a)) : [];
      const maxReq = Math.min(u.left, Math.max(4, Math.ceil(target / 4) + 2));
      const r = await env.DB.prepare("INSERT INTO sweeps (niche, city, state, query, areas, pages, created_at, target, picked, tokens, max_req) VALUES (?, ?, ?, ?, ?, 3, ?, ?, ?, '{}', ?) RETURNING id")
        .bind(niche.name, city.name, city.state, niche.q, JSON.stringify([...areas, ...extra]), Date.now(), target, areas.length, maxReq).first();
      return json({ id: r.id, areas: areas.length, target, maxSearches: maxReq });
    }
    const need = areas.length * pages;
    if (need > u.left) return err(`This sweep could use up to ${need} Google requests, and only ${u.left} are left ${u.limitBy === "day" ? "today" : "this month"}. Pick fewer areas or less depth.`);
    const r = await env.DB.prepare("INSERT INTO sweeps (niche, city, state, query, areas, pages, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(niche.name, city.name, city.state, niche.q, JSON.stringify(areas), pages, Date.now()).first();
    return json({ id: r.id, areas: areas.length });
  }

  if ((m = path.match(/^\/api\/sweeps\/(\d+)\/advance$/)) && method === "POST") {
    const s = await env.DB.prepare("SELECT * FROM sweeps WHERE id = ?").bind(+m[1]).first();
    if (!s) return err("Sweep not found", 404);
    if (!s.target) return err("This sweep has no goal. Use /step.");
    return json(await advanceGoal(env, s));
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
    const skip = new URL(request.url).searchParams.get("skip") === "1";
    let token = null, page = 0, requests = 0, added = 0, stoppedForCap = false, googleError = "", transient = false;
    const now = Date.now();
    if (!skip) do {
      const u = await usage(env);
      if (u.left <= 0) { stoppedForCap = true; break; }
      let data;
      try { data = await placesSearch(env, textQuery, token); }
      catch (e) { googleError = e.message; transient = !!e.transient; break; }
      requests++; await addUsage(env, "search"); // Google only bills calls that worked
      const places = await savePlaces(env, id, data.places, now);
      added += places.length;
      token = data.nextPageToken || null;
      page++;
    } while (token && page < s.pages);

    // Google hiccuped before we got anything for this suburb: hand the suburb back so the app can try it again
    if (googleError && transient && page === 0) {
      await env.DB.prepare("UPDATE sweeps SET cursor = ? WHERE id = ? AND cursor = ?").bind(s.cursor, id, s.cursor + 1).run();
      return json({ done: false, retry: true, area, cursor: s.cursor, total: areas.length, found: s.found, googleError, usage: await usage(env) });
    }
    const found = await env.DB.prepare("SELECT COUNT(*) AS n FROM sweep_leads WHERE sweep_id = ?").bind(id).first("n");
    const cursor = s.cursor + 1;
    const fatal = !!googleError && !transient && added === 0;
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
    const r = await env.DB.prepare("UPDATE leads SET enrich_state = 'pending', enrich_tries = 0, block_tries = 0, retry_at = NULL WHERE (email IS NULL OR email = '') AND website != '' AND place_id IN (SELECT place_id FROM sweep_leads WHERE sweep_id = ?)").bind(+m[1]).run();
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
    const lead = await env.DB.prepare("SELECT place_id, name, website, suburb, phone FROM leads WHERE place_id = ?").bind(id).first();
    if (!lead) return err("Lead not found", 404);
    if (new URL(request.url).searchParams.get("probe") === "1") { // timing test for slow sites
      const tries = {};
      for (const [k, h] of [["browser", BROWSER_HEADERS], ["plain", {}], ["html-only", { accept: "text/html" }]]) {
        const t0 = Date.now();
        try { const r = await fetch(lead.website, { headers: h, redirect: "follow", signal: AbortSignal.timeout(25000) }); const t = await r.text(); tries[k] = { status: r.status, len: t.length, ms: Date.now() - t0 }; }
        catch (e) { tries[k] = { error: String(e.message || e).slice(0, 60), ms: Date.now() - t0 }; }
      }
      return json({ lead: lead.name, website: lead.website, tries });
    }
    const trace = [];
    const r = await enrichLead(lead, trace);
    return json({ lead: lead.name, website: lead.website, result: r, trace });
  }

  if (path === "/api/enrich-next" && method === "POST") {
    const url = new URL(request.url);
    const sweep = parseInt(url.searchParams.get("sweep") || "", 10) || null;
    // counting the backlog costs reads, so it's only done when asked (the app always asks for its own sweep)
    return json(await enrichNext(env, 1, sweep, !!sweep || url.searchParams.get("count") === "1"));
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
    await enrichNext(env, 3, null, false);
    // harvests: two searches a minute in the background
    const hv = await env.DB.prepare("SELECT id FROM harvests WHERE status = 'running' ORDER BY id LIMIT 1").first();
    if (hv) { try { await runHarvest(env, hv.id, 2); } catch (e) { /* next minute */ } }
    // goal sweeps keep searching in the background until they hit their number
    const { results } = await env.DB.prepare("SELECT * FROM sweeps WHERE status = 'running' AND target > 0 AND created_at > ? ORDER BY id LIMIT 2").bind(Date.now() - 12 * 3600000).all();
    for (const s of results) { try { await advanceGoal(env, s); } catch (e) { /* try again next minute */ } }
  },
};
