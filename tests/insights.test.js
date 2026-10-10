const fs = require('fs');
const path = require('path');
const VIEWER = path.join(__dirname, '..', 'statereel.html');
const h = fs.readFileSync(VIEWER, 'utf8');
const core = h.split('/*<<<CORE_START>>>*/')[1].split('/*<<<CORE_END>>>*/')[0];
const ins = h.split('/*<<<INSIGHT_START>>>*/')[1].split('/*<<<INSIGHT_END>>>*/')[0];
const api = new Function(core + ins + '\nreturn {parseAgentLog, buildInsights};')();

// use the viewer's own embedded sample as the fixture
const start = h.indexOf('var SAMPLE = [');
const body = h.slice(start + 'var SAMPLE = ['.length, h.indexOf('].join("\\n");', start));
const SAMPLE = new Function('return [' + body + '].join(String.fromCharCode(10));')();

const parsed = api.parseAgentLog(SAMPLE);
const I = api.buildInsights(parsed);

console.log('status   :', I.status);
console.log('request  :', JSON.stringify(I.request && I.request.slice(0, 80)));
console.log('outcome  :', JSON.stringify(I.outcome && I.outcome.slice(0, 70)));
console.log('\nnarrative steps (' + I.steps.length + '):');
I.steps.forEach(s => console.log('  ' + s.n + '. [' + (s.failed ? 'FAIL' : ' ok ') + '] ' + s.label + '  ::  ' + s.detail.slice(0, 88)));
console.log('\nfailures (' + I.errors.length + '):');
I.errors.forEach(e => console.log('  - ' + e.tool + ' @#' + e.step + ': ' + e.message.slice(0, 80)));
console.log('\nopen markers (' + I.flags.length + '):');
I.flags.forEach(f => console.log('  - ' + f.value + '  via ' + f.source + ' @#' + f.step.index));
console.log('\nartifacts (' + I.artifacts.length + '):');
I.artifacts.forEach(a => console.log('  - [' + a.ext + ']' + (a.written ? ' PRODUCED' : '         ') + ' ' + a.value + '  via ' + a.source));
console.log('\ntools:');
I.tools.forEach(t => console.log('  - ' + t.name + ' calls=' + t.calls + ' failed=' + t.failed + ' bytes=' + t.bytes));
console.log('\nllm calls:');
I.llmCalls.forEach(c => console.log('  - #' + c.step + ' ' + c.label + ' in=' + c.input + ' out=' + c.output + ' cache=' + c.cache));

let fails = 0;
const assert = (c, m) => { if (!c) fails++; console.log((c ? 'PASS' : 'FAIL') + ' - ' + m); };
console.log('\n--- assertions ---');
assert(I.status === 'err', 'status reflects the tool failure');
assert(/smart thermostat/.test(I.request) && !/workflow context/.test(I.request),
  'request skips the "(workflow context)" preamble and picks the real user ask');
assert(/kg_TH4471X_procedure\.xml/.test(I.outcome), 'outcome is the final assistant message');
assert(I.steps.length === 5, 'narrative folds 8 messages into 5 steps (got ' + I.steps.length + ')');
assert(I.steps[0].label === 'Context supplied to the agent', 'preamble labelled as context, not a request');
assert(I.steps[3].failed === true, 'the step that called the failing tool is marked failed');
assert(I.steps[4].label === 'Final answer', 'last step labelled Final answer');
assert(I.errors.length === 1 && I.errors[0].tool === 'invoke_agent', 'one failure attributed to invoke_agent');
assert(/mappings\[3\]\.confidence/.test(I.errors[0].message), 'failure message pulled from the JSON error field');
assert(I.flags.length === 1 && /DATA REQUIRED/.test(I.flags[0].value), 'DATA REQUIRED placeholder detected in a tool payload');
assert(I.flags[0].source === 'read_file', 'marker attributed to the tool that returned it');
const produced = I.artifacts.filter(a => a.written);
assert(produced.some(a => /kg_TH4471X_procedure\.xml/.test(a.value)), 'the written xml is flagged as produced');
assert(I.artifacts.some(a => a.ext === 'png'), 'illustration png reference captured');
assert(I.artifacts.some(a => /install_guide_template\.xml/.test(a.value)), 'absolute skill path captured');
assert(I.artifacts.length === 3, 'artifact list deduped to 3 distinct references (got ' + I.artifacts.length + ')');
assert(!I.artifacts.some(a => /[`'"]$/.test(a.value)), 'no trailing backtick/quote left on any reference');
assert(!I.artifacts.some(a => I.artifacts.some(b => b !== a && b.value.includes(a.value))), 'no reference is a substring of another');
assert(I.tools.length === 3, 'three distinct tools (got ' + I.tools.length + ')');
assert(I.tools.filter(t => t.name === 'invoke_agent')[0].failed === 1, 'invoke_agent has 1 failure');
assert(I.invocations.length === 3, 'three invocations recorded');
assert(I.llmCalls.length === 3 && I.llmCalls[0].cache === 13312, 'llm calls carry cache figures');
console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all assertions passed'));
process.exit(fails ? 1 : 0);
