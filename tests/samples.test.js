// Every built-in sample in the picker must parse cleanly and produce a usable report.
const fs = require('fs');
const path = require('path');
const VIEWER = path.join(__dirname, '..', 'statereel.html');
const h = fs.readFileSync(VIEWER, 'utf8');
const core = h.split('/*<<<CORE_START>>>*/')[1].split('/*<<<CORE_END>>>*/')[0];
const ins = h.split('/*<<<INSIGHT_START>>>*/')[1].split('/*<<<INSIGHT_END>>>*/')[0];
const api = new Function(core + ins + '\nreturn {parseAgentLog, buildInsights};')();

// pull SAMPLES + SAMPLE straight out of the shipped file
const sStart = h.indexOf('var SAMPLES = {');
const sEnd = h.indexOf('\n};\n', sStart) + 4;
const samplesSrc = h.slice(sStart, sEnd);
const legacyStart = h.indexOf('var SAMPLE = [');
const legacyEnd = h.indexOf('].join("\\n");', legacyStart) + '].join("\\n");'.length;
const legacySrc = h.slice(legacyStart, legacyEnd);
const all = new Function(samplesSrc + legacySrc + '\nreturn Object.assign({langgraph: SAMPLE}, SAMPLES);')();

// the option list in the picker must match the sample keys exactly
const pickerSrc = h.slice(h.indexOf('id="sampleSel"'), h.indexOf('</select>', h.indexOf('id="sampleSel"')));
const optKeys = [...pickerSrc.matchAll(/<option value="(\w+)">/g)].map(m => m[1]);

let fails = 0;
const assert = (c, m) => { if (!c) fails++; console.log((c ? 'PASS' : 'FAIL') + ' - ' + m); };

console.log('=== every built-in sample ===');
const R = {};
for (const [k, text] of Object.entries(all)) {
  const r = api.parseAgentLog(text);
  const I = api.buildInsights(r);
  R[k] = { r, I };
  console.log(
    k.padEnd(12),
    'adapter=' + String(r.diag.adapter).padEnd(18),
    'msgs=' + String(r.messages.length).padStart(2),
    'steps=' + String(I.steps.length).padStart(2),
    'tools=' + String(r.stats.toolCalls).padStart(2),
    'fails=' + r.stats.toolErrors,
    'markers=' + I.flags.length,
    'arts=' + I.artifacts.length,
    'cost=' + (r.stats.costUsd ? '$' + r.stats.costUsd.toFixed(4) : '-'),
    'chars(len)=' + text.length
  );
  if (r.diag.errors.length) console.log('   issues:', r.diag.errors.join(' | '));
}

console.log('\n=== assertions ===');
assert(optKeys.length === Object.keys(all).length,
  'picker options (' + optKeys.length + ') match sample count (' + Object.keys(all).length + ')');
optKeys.forEach(k => assert(!!all[k], 'picker option "' + k + '" has a sample defined'));

for (const [k, { r, I }] of Object.entries(R)) {
  assert(r.messages.length >= 3, k + ': parsed at least 3 messages (got ' + r.messages.length + ')');
  assert(r.diag.adapter !== 'raw-text', k + ': did not fall back to raw text (used ' + r.diag.adapter + ')');
  assert(r.diag.errors.length === 0, k + ': zero parse issues');
  // some formats genuinely never echo the user prompt (LangChain verbose is one);
  // the tool must then report it as absent rather than inventing one
  assert(!!(I.request || I.outcome), k + ': a request and/or outcome was identified');
  assert(!!I.outcome, k + ': an outcome was identified');
  assert(r.stats.toolCalls >= 1, k + ': at least one tool call found');
  const paired = r.messages.reduce((n, m) => n + m.tool_calls.filter(t => t.result).length, 0);
  assert(paired === r.stats.toolCalls, k + ': every tool call paired to a result (' + paired + '/' + r.stats.toolCalls + ')');
}

// framework-specific expectations that prove nothing is silently dropped
assert(R['claude'].r.stats.costUsd > 0.13, 'claude: reported cost surfaced');
assert(R['claude'].r.messages.some(m => m.reasoning), 'claude: thinking block preserved');
assert(R['claude'].r.stats.cacheRead > 60000, 'claude: cache reads summed (' + R['claude'].r.stats.cacheRead + ')');
assert(R['crewai'].r.stats.toolErrors === 1, 'crewai: the db timeout counted as a failure');
assert(R['crewai'].I.flags.length === 1, 'crewai: the [VERIFY ...] marker was picked up');
assert(R['autogen'].r.stats.toolCalls === 2, 'autogen: both parallel FunctionCalls parsed');
assert(R['autogen'].r.stats.agents.length >= 2, 'autogen: multiple agents detected (' + R['autogen'].r.stats.agents.join(',') + ')');
assert(R['adk'].r.stats.toolErrors === 1, 'adk: the failed reservation counted as a failure');
assert(R['adk'].r.messages.some(m => m.name === 'state_delta'), 'adk: state_delta events surfaced');
assert(R['adk'].r.stats.inTokens === 4210, 'adk: token counts summed (' + R['adk'].r.stats.inTokens + ')');
assert(R['react'].r.stats.toolCalls === 2, 'react: both sql_query actions parsed');
assert(!R['react'].I.request, 'react: LangChain verbose carries no question, so no request is invented');
assert(/17.5%/.test(R['react'].I.outcome || ''), 'react: final answer became the outcome');
assert(R['pydantic'].r.messages.some(m => m.reasoning), 'pydantic-ai: ThinkingPart preserved');
assert(R['langgraph'].r.stats.duplicates >= 1, 'langgraph: duplicate snapshot copy still collapsed');

console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all assertions passed'));
process.exit(fails ? 1 : 0);
