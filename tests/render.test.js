const fs = require('fs');
const path = require('path');
const VIEWER = path.join(__dirname, '..', 'statereel.html');
const html = fs.readFileSync(VIEWER, 'utf8');
const txt = html.split('/*<<<TEXT_START>>>*/')[1].split('/*<<<TEXT_END>>>*/')[0];
const md = new Function(txt + '\nreturn {renderMd, esc, isCodeListing, fmtNum, fmtBytes};')();

let fails = 0;
const assert = (cond, msg) => { if (!cond) fails++; console.log((cond ? 'PASS' : 'FAIL') + ' - ' + msg); };

// --- XSS: tool output is untrusted; nothing may execute ---
const evil = '<img src=x onerror=alert(1)> <script>alert(2)</' + 'script> <a href="javascript:alert(3)">x</a>';
const out = md.renderMd(evil);
assert(out.indexOf('<img') === -1, 'raw <img> neutralised');
assert(out.indexOf('<script') === -1, 'raw <script> neutralised');
assert(out.indexOf('onerror=') === -1 || out.indexOf('&lt;img') > -1, 'event handler cannot reach the DOM as markup');
// only a REAL anchor matters; "href=..." sitting inside escaped &lt;a&gt; text is inert
assert(/<a\s[^>]*href="(?!https?:)/i.test(out) === false, 'no real anchor with a non-http scheme is produced');
assert(md.renderMd('javascript:alert(1) and data:text/html,<b>x</b>').indexOf('<a ') === -1, 'autolinker only matches http(s), never javascript:/data:');
console.log('  escaped ->', out.slice(0, 130).replace(/\n/g, ' '));

// --- markdown features seen in these logs ---
const table = md.renderMd('| Part | Number |\n|---|---|\n| wall plate | TH-1014 |\n| sensor | TH-1015 |');
assert(/<table>.*<th>Part<\/th>/s.test(table) && (table.match(/<tr>/g) || []).length === 3, 'markdown table renders with header + 2 rows');

const h = md.renderMd('## Procedures\n\n1. **Installation** - subtask `ID_X`\n2. Removal\n\n---\n\nsee https://example.com/a.png');
assert(/<h3>Procedures<\/h3>/.test(h), 'heading rendered');
assert(/<ol><li><strong>Installation<\/strong>/.test(h), 'ordered list + bold');
assert(/<code>ID_X<\/code>/.test(h), 'inline code');
assert(/<hr>/.test(h), 'horizontal rule');
assert(/<a href="https:\/\/example.com\/a.png" target="_blank" rel="noopener noreferrer">/.test(h), 'safe autolink');

const fence = md.renderMd('text\n```xml\n<procedure>\n  <step/>\n</procedure>\n```\nafter');
assert(/<pre><code data-lang="xml">&lt;procedure&gt;/.test(fence), 'fenced code block escaped inside pre');

// --- line-numbered file dumps (read_file results) stay as preformatted code ---
const listing = '     1\t<?xml version="1.0"?>\n     2\t<procedure>\n     3\t  <step/>\n     4\t</procedure>';
assert(md.isCodeListing(listing) === true, 'line-numbered dump detected as code listing');
assert(/^<pre class="raw code">/.test(md.renderMd(listing)), 'code listing rendered as <pre>, not markdown');
assert(md.isCodeListing('just a normal\nsentence here') === false, 'prose not mistaken for a listing');

// --- empty / formatters ---
assert(/no content/.test(md.renderMd('')), 'empty content shows placeholder');
assert(md.fmtNum(44613) === '45k' && md.fmtNum(796) === '796' && md.fmtNum(1500) === '1.5k', 'fmtNum: ' + md.fmtNum(44613) + '/' + md.fmtNum(796) + '/' + md.fmtNum(1500));
assert(md.fmtBytes(3277) === '3.2 KB', 'fmtBytes: ' + md.fmtBytes(3277));

console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all assertions passed'));
process.exit(fails ? 1 : 0);
