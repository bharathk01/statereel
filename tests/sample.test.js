const fs = require('fs');
const path = require('path');
const VIEWER = path.join(__dirname, '..', 'statereel.html');
const h = fs.readFileSync(VIEWER, 'utf8');
const core = h.split('/*<<<CORE_START>>>*/')[1].split('/*<<<CORE_END>>>*/')[0];
const api = new Function(core + '\nreturn {parseAgentLog};')();

const start = h.indexOf('var SAMPLE = [');
const endMark = '].join("\\n");';
const end = h.indexOf(endMark, start);
if (start < 0 || end < 0) { console.log('could not locate SAMPLE'); process.exit(1); }
const body = h.slice(start + 'var SAMPLE = ['.length, end);
const SAMPLE = new Function('return [' + body + '].join(String.fromCharCode(10));')();

const r = api.parseAgentLog(SAMPLE);
console.log('mode:', r.diag.mode, '| messages:', r.messages.length, '| parse errors:', r.diag.errors.length);
console.log('stats:', JSON.stringify(r.stats));
r.messages.forEach(m => console.log('  #' + m.index, m.kind, m.name || '-', 'seen=' + m.seen, 'err=' + m.isError,
  'tc=[' + m.tool_calls.map(t => t.name + (t.result ? (t.result.isError ? '=FAIL' : '=ok') : '=?')).join(', ') + ']',
  'paired=' + (m.pairedTo ? '#' + m.pairedTo.index : '-')));
console.log('extras:', Object.keys(r.extras));
console.log('trailing:', JSON.stringify(r.diag.trailing));
if (r.diag.errors.length) { console.log('ERRORS:', r.diag.errors); process.exit(1); }

let fails = 0;
const assert = (c, m) => { if (!c) fails++; console.log((c ? 'PASS' : 'FAIL') + ' - ' + m); };
assert(r.messages.length === 8, 'sample yields 8 unique messages (got ' + r.messages.length + ')');
assert(r.stats.duplicates === 1, 'the updates/values duplicate collapsed (got ' + r.stats.duplicates + ')');
assert(r.stats.toolErrors === 1, 'the invoke_agent failure is flagged');
assert(r.messages[r.messages.length - 1].kind === 'ai', 'last card is the final AI message');
assert(Object.keys(r.extras).length === 2, 'skills_metadata + files captured as extras');
console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'sample OK'));
process.exit(fails ? 1 : 0);
