// Scale test across every framework's REAL capture.
// Production log files often hold many runs appended together, so each real log is
// replicated N times with unique ids and prompts per copy (as separate runs would have).
// Counts must stay exact at N x, and throughput must stay usable.
//   node tests/scale.js            (N = 10, 100, 500)
//   node tests/scale.js --quick    (N = 10, 50; what CI runs)
const fs = require('fs');
const path = require('path');
const VIEWER = path.join(__dirname, '..', 'statereel.html');
const REAL = path.join(__dirname, 'fixtures', 'real');
const h = fs.readFileSync(VIEWER, 'utf8');
const core = h.split('/*<<<CORE_START>>>*/')[1].split('/*<<<CORE_END>>>*/')[0];
const api = new Function(core + '\nreturn {parseAgentLog};')();

const SIZES = process.argv.includes('--quick') ? [10, 50] : [10, 100, 500];
const MIN_MB_PER_S = 3;           // floor on a CI runner; typical is far higher

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
// call_(?!id) so AutoGen's field name call_id= is not mistaken for an id like call_paris
const IDS = /\b(call_(?!id\b)[a-z]+|msg_\d+|ai-\d+|lc_run--[0-9a-f-]+|session-weather-\d+|01[0-9a-z]{24})\b/g;

// one copy = one more run: fresh ids, and a prompt/answer that differ so id-less turns
// are not mistaken for repeated snapshots of the same message
function copyN(text, i) {
  return text
    .replace(UUID, m => m.slice(0, 24) + String(i).padStart(12, '0'))
    .replace(IDS, m => m + '_r' + i)
    .replace(/\(#(\d+)\)/g, (_, n) => '(#' + (Number(n) + 1000 * i) + ')')        // CrewAI panel numbers
    .replace(/Atlantis\? Answer in one line\./g, 'Atlantis? Answer in one line. (run ' + i + ')')
    .replace(/no weather data for Atlantis\./g, 'no weather data for Atlantis. (run ' + i + ')');
}

function measure(r) {
  return {
    tool_calls: r.stats.toolCalls,
    paired: r.messages.reduce((n, m) => n + m.tool_calls.filter(t => t.result).length, 0),
    tool_errors: r.stats.toolErrors,
    model_calls: r.stats.llmCalls,
  };
}

let fails = 0;
const rows = [];
const assert = (c, m) => { if (!c) { fails++; console.log('FAIL - ' + m); } };

for (const fw of fs.readdirSync(REAL).sort()) {
  const mpath = path.join(REAL, fw, 'manifest.json');
  if (!fs.existsSync(mpath)) continue;
  const man = JSON.parse(fs.readFileSync(mpath, 'utf8'));
  for (const [file, exp] of Object.entries(man.fixtures)) {
    const base = fs.readFileSync(path.join(REAL, fw, file), 'utf8');
    for (const n of SIZES) {
      const parts = [];
      for (let i = 0; i < n; i++) parts.push(copyN(base, i));
      const text = parts.join('\n');
      const t0 = process.hrtime.bigint();
      const r = api.parseAgentLog(text);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const got = measure(r);
      const mb = text.length / 1048576;
      const rate = mb / Math.max(ms / 1000, 1e-6);
      const tag = `${fw}/${file} x${n}`;
      for (const k of Object.keys(got)) {
        if (exp[k] !== undefined) assert(got[k] === exp[k] * n, `${tag}: ${k} = ${exp[k] * n} (got ${got[k]})`);
      }
      if (mb > 1) assert(rate >= MIN_MB_PER_S, `${tag}: ${rate.toFixed(1)} MB/s is under the ${MIN_MB_PER_S} MB/s floor`);
      rows.push({ fw: man.key || fw, file: file.replace('.log', ''), n, mb, ms, rate, adapter: r.diag.adapter,
                  ok: Object.keys(got).every(k => exp[k] === undefined || got[k] === exp[k] * n) });
    }
  }
}

// largest run per fixture, as a table
const pad = (s, w) => String(s).padEnd(w);
console.log(pad('framework', 18) + pad('print style', 20) + pad('runs', 6) + pad('size', 9) + pad('parse', 10) + pad('MB/s', 7) + pad('adapter', 18) + 'counts');
for (const r of rows.filter(r => r.n === SIZES[SIZES.length - 1])) {
  console.log(pad(r.fw, 18) + pad(r.file, 20) + pad(r.n, 6) + pad(r.mb.toFixed(1) + ' MB', 9) +
              pad(r.ms.toFixed(0) + ' ms', 10) + pad(r.rate.toFixed(1), 7) + pad(r.adapter, 18) + (r.ok ? 'exact' : 'WRONG'));
}
const total = rows.filter(r => r.n === SIZES[SIZES.length - 1]);
console.log(`\n${total.length} real print styles x ${SIZES.join('/')} runs: ` +
            (fails ? `${fails} FAILURE(S)` : 'all counts exact at every size'));
process.exit(fails ? 1 : 0);
