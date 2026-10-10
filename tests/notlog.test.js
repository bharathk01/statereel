// Accidental pastes (a file path, a URL, a stack trace, random text) must be reported as
// "not an agent log", never dressed up as a one-message successful run. Real logs must
// never trip the check.
const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'statereel.html'), 'utf8');
const core = h.split('/*<<<CORE_START>>>*/')[1].split('/*<<<CORE_END>>>*/')[0];
const ins = h.split('/*<<<INSIGHT_START>>>*/')[1].split('/*<<<INSIGHT_END>>>*/')[0];
const api = new Function(core + ins + '\nreturn {parseAgentLog, buildInsights};')();

let fails = 0, n = 0;
const assert = (c, m) => { n++; if (!c) { fails++; console.log('FAIL - ' + m); } };
const NL = String.fromCharCode(10);

// paste -> what the notice should say it looks like
const ACCIDENTAL = {
  path: [
    '"C:\\Users\\someone\\OneDrive - Org\\Documents\\Engineering Console_backup\\REPOs"a',
    'C:/work/agent/run.log',
    '\\\\fileserver\\share\\logs\\agent.txt',
    '/home/me/projects/agent/run.log',
    '~/Downloads/agent-debug.txt',
    'file:///Users/me/agent.log',
  ],
  url: ['https://github.com/langchain-ai/langgraph/issues/1234', 'http://localhost:8080/runs/42'],
  traceback: ['Traceback (most recent call last):' + NL + '  File "app.py", line 12, in <module>' + NL +
              '    main()' + NL + 'ValueError: bad'],
  markup: ['<html><body><h1>Hello</h1></body></html>', '<?xml version="1.0"?><root/>'],
  data: ['{"name": "my-app", "version": "1.0.0", "scripts": {"test": "jest"}}', "{'a': 1, 'b': [1, 2, 3]}", '[1, 2, 3, 4]'],
  code: ['def get_weather(city: str) -> str:' + NL + '    return requests.get(URL).text', 'import os' + NL + 'print(os.getcwd())'],
  applog: ['2026-10-09 21:35:01 INFO server started on port 8080' + NL + '2026-10-09 21:35:02 WARN slow request'],
  text: ['hey can you check why the agent failed yesterday?', '42', 'id,name,score' + NL + '1,alice,3',
         'Hi team,' + NL + NL + 'Please find the report attached.'],
};

for (const [kind, pastes] of Object.entries(ACCIDENTAL)) {
  for (const t of pastes) {
    const r = api.parseAgentLog(t);
    const tag = JSON.stringify(t.slice(0, 40));
    assert(r.diag.notAgentLog === true, tag + ': flagged as not an agent log');
    assert(r.diag.looksLike === kind, tag + ': looks like ' + kind + ' (got ' + r.diag.looksLike + ')');
  }
}

// asking for plain text still renders, but nothing claims an AI said it or that a run succeeded
const forced = api.parseAgentLog(ACCIDENTAL.path[0], 'raw-text');
assert(!forced.diag.notAgentLog, 'forced plain text is not blocked');
assert(forced.messages.length === 1 && forced.messages[0].kind === 'other', 'plain text is not an AI message (got ' + forced.messages[0].kind + ')');
assert(forced.stats.llmCalls === 0, 'plain text is not a model call');
assert(api.buildInsights(forced).status === 'text', 'plain text has no success/failure status');

// tiny but real inputs must still build a report
const REAL_SMALL = {
  'lone AIMessage': "AIMessage(content='hi there')",
  'lone HumanMessage': "HumanMessage(content='what is the weather in Paris?')",
  'role JSON': '[{"role":"user","content":"hi"},{"role":"assistant","content":"hello"}]',
};
for (const [k, t] of Object.entries(REAL_SMALL)) {
  const r = api.parseAgentLog(t);
  assert(!r.diag.notAgentLog, k + ': not flagged (adapter ' + r.diag.adapter + ')');
}

// every real framework capture must pass the check
const REAL = path.join(__dirname, 'fixtures', 'real');
for (const fw of fs.readdirSync(REAL)) {
  const dir = path.join(REAL, fw);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.log'))) {
    const r = api.parseAgentLog(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert(!r.diag.notAgentLog, fw + '/' + f + ': real log not flagged');
  }
}

console.log(fails ? fails + ' FAILURE(S)' : 'accidental pastes: ' + n + ' checks passed');
process.exit(fails ? 1 : 0);
