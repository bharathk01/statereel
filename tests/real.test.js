// Real framework captures: every tests/fixtures/real/<framework>/manifest.json lists its
// fixtures and what the viewer must recover from each. Adding a framework = a new folder.
const fs = require('fs');
const path = require('path');
const VIEWER = path.join(__dirname, '..', 'statereel.html');
const REAL = path.join(__dirname, 'fixtures', 'real');
const h = fs.readFileSync(VIEWER, 'utf8');
const core = h.split('/*<<<CORE_START>>>*/')[1].split('/*<<<CORE_END>>>*/')[0];
const api = new Function(core + '\nreturn {parseAgentLog};')();

let fails = 0;
const assert = (c, m) => { if (!c) fails++; console.log((c ? 'PASS' : 'FAIL') + ' - ' + m); };

// summarise one parse into the same shape the manifest records
function measure(r) {
  return {
    adapter: r.diag.adapter,
    tool_calls: r.stats.toolCalls,
    paired: r.messages.reduce((n, m) => n + m.tool_calls.filter(t => t.result).length, 0),
    tool_errors: r.stats.toolErrors,
    model_calls: r.stats.llmCalls,
    input_tokens: r.stats.inTokens,
    output_tokens: r.stats.outTokens,
    todos: Array.isArray(r.extras.todos) ? r.extras.todos.length : 0,
    files: r.extras.files && typeof r.extras.files === 'object' ? Object.keys(r.extras.files).length : 0,
    user_prompt: r.messages.some(m => m.kind === 'human'),
    unknown: (r.diag.unknownTypes || []).map(u => u.type),
  };
}

const frameworks = fs.existsSync(REAL) ? fs.readdirSync(REAL).filter(d => fs.existsSync(path.join(REAL, d, 'manifest.json'))) : [];
assert(frameworks.length > 0, 'found ' + frameworks.length + ' real-capture framework folder(s)');

for (const fw of frameworks) {
  const man = JSON.parse(fs.readFileSync(path.join(REAL, fw, 'manifest.json'), 'utf8'));
  const ver = Object.entries(man.versions).map(([k, v]) => k + ' ' + v).join(', ');
  console.log('\n=== ' + man.framework + '  [' + ver + ', captured ' + man.captured_at + '] ===');
  for (const [file, exp] of Object.entries(man.fixtures)) {
    const got = measure(api.parseAgentLog(fs.readFileSync(path.join(REAL, fw, file), 'utf8')));
    const tag = fw + '/' + file + ': ';
    assert(got.adapter === exp.adapter, tag + 'read by ' + exp.adapter + ' (got ' + got.adapter + ')');
    // only what this print style actually carries is expected (console traces have no tokens)
    for (const k of ['tool_calls', 'paired', 'tool_errors', 'model_calls', 'input_tokens', 'output_tokens']) {
      if (exp[k] !== undefined) assert(got[k] === exp[k], tag + k + ' = ' + exp[k] + ' (got ' + got[k] + ')');
    }
    if (exp.state) {
      assert(got.todos === exp.state.todos, tag + 'todos = ' + exp.state.todos + ' (got ' + got.todos + ')');
      assert(got.files === exp.state.files, tag + 'files = ' + exp.state.files + ' (got ' + got.files + ')');
    }
    if (exp.user_prompt !== undefined) {
      assert(got.user_prompt === exp.user_prompt, tag + 'user prompt ' + (exp.user_prompt ? 'present' : 'absent'));
    }
    assert(got.unknown.length === 0, tag + 'no unrecognised types' + (got.unknown.length ? ' -> ' + got.unknown.join(', ') : ''));
  }
}

console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all assertions passed'));
process.exit(fails ? 1 : 0);
