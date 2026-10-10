// Cost estimation and token-usage normalisation across providers.
const fs = require('fs');
const path = require('path');
const VIEWER = path.join(__dirname, '..', 'statereel.html');
const h = fs.readFileSync(VIEWER, 'utf8');
const core = h.split('/*<<<CORE_START>>>*/')[1].split('/*<<<CORE_END>>>*/')[0];
const ins = h.split('/*<<<INSIGHT_START>>>*/')[1].split('/*<<<INSIGHT_END>>>*/')[0];
const api = new Function(core + ins + '\nreturn {parseAgentLog, buildInsights, computeCosts, readUsage, fmtUsd, UNKNOWN_MODEL};')();

let fails = 0;
const close = (a, b) => Math.abs(a - b) < 1e-9;
const assert = (c, m) => { if (!c) fails++; console.log((c ? 'PASS' : 'FAIL') + ' - ' + m); };

// ---- usage: "input" must always include cached tokens, whatever the provider ----
const lc = api.readUsage({ usage_metadata: { input_tokens: 1000, output_tokens: 50, input_token_details: { cache_read: 800 } } });
assert(lc.input_tokens === 1000 && lc.input_token_details.cache_read === 800, 'LangChain: input already includes the 800 cached');

const anth = api.readUsage({ usage: { input_tokens: 200, output_tokens: 50, cache_read_input_tokens: 800 } });
assert(anth.input_tokens === 1000 && anth.input_token_details.cache_read === 800, 'Anthropic: 200 fresh + 800 cached normalised to 1000 input');

const anthWrite = api.readUsage({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 990 } });
assert(anthWrite.input_tokens === 1000, 'Anthropic: cache-write tokens count as input');

const oai = api.readUsage({ usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 } } });
assert(oai.input_tokens === 1000 && oai.input_token_details.cache_read === 800, 'OpenAI: nested prompt_tokens_details.cached_tokens read');

const gem = api.readUsage({ usage_metadata: { prompt_token_count: 1000, candidates_token_count: 50, cached_content_token_count: 800 } });
assert(gem.input_tokens === 1000 && gem.input_token_details.cache_read === 800, 'Google: cached_content_token_count read');

// ---- cost maths: (fresh x in + cached x cached + out x out) / 1e6 ----
const calls = [
  { key: 'a', model: 'm1', input: 1000000, cache: 800000, output: 100000 },
  { key: 'b', model: 'm1', input: 500000, cache: 0, output: 50000 },
  { key: 'c', model: null, input: 100000, cache: 0, output: 1000 },
];
const p1 = { m1: { input: '3', cached: '0.30', output: '15' } };
const r1 = api.computeCosts(calls, p1);
// a: 200k fresh x 3 + 800k x 0.30 + 100k x 15 = 0.6 + 0.24 + 1.5 = 2.34
// b: 500k x 3 + 50k x 15 = 1.5 + 0.75 = 2.25
assert(close(r1.perCall.a, 2.34), 'call a: cache-aware cost $2.34 (got ' + r1.perCall.a + ')');
assert(close(r1.perCall.b, 2.25), 'call b: $2.25 (got ' + r1.perCall.b + ')');
assert(close(r1.total, 4.59) && r1.priced === 2, 'total $4.59 over 2 priced calls');
assert(r1.unpriced.length === 1 && r1.unpriced[0] === api.UNKNOWN_MODEL, 'call with no model name reported as unpriced');

const r2 = api.computeCosts(calls, { m1: { input: '3', output: '15' } });
// cached price blank -> billed at the input price: a = 1M x 3 + 100k x 15 = 4.5
assert(close(r2.perCall.a, 4.5), 'blank cached price falls back to the input price ($4.50)');

const r3 = api.computeCosts(calls, {});
assert(r3.priced === 0 && r3.total === 0 && r3.unpriced.length === 2, 'no prices -> nothing priced, both models listed');

const r4 = api.computeCosts(calls, { m1: { input: 'abc', output: '' } });
assert(r4.priced === 0, 'non-numeric prices are ignored, not treated as zero');

// ---- end to end: a Claude SDK log keeps a sane cache rate after normalisation ----
const claude = [
  JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'claude-x', content: [{ type: 'text', text: 'hi' }],
    usage: { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 9980 } } }),
  JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: 0.01, result: 'hi' }),
].join('\n');
const pc = api.parseAgentLog(claude);
assert(pc.stats.inTokens === 10000 && pc.stats.cacheRead === 9980, 'Claude log: 10,000 input of which 9,980 cached');
assert(pc.stats.cacheRead <= pc.stats.inTokens, 'cache rate can no longer exceed 100%');
const I = api.buildInsights(pc);
assert(I.llmCalls[0].model === 'claude-x', 'model carried onto each call for pricing');

assert(api.fmtUsd(0.00234) === '$0.0023' && api.fmtUsd(0.5) === '$0.500' && api.fmtUsd(12.3) === '$12.30', 'currency formatting');

console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all assertions passed'));
process.exit(fails ? 1 : 0);
