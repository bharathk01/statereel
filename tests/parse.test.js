const fs = require('fs');
const path = require('path');
const VIEWER = path.join(__dirname, '..', 'statereel.html');
const html = fs.readFileSync(VIEWER, 'utf8');
const core = html.split('/*<<<CORE_START>>>*/')[1].split('/*<<<CORE_END>>>*/')[0];
const api = new Function(core + '\nreturn {parseAgentLog, stripAnsi, parseLiteralAt};')();

// Fixture mirroring the real log: ANSI markers, python repr, JSON-in-string with
// escaped quotes/newlines, \x11 escapes, None, nested dicts, line-numbered file
// content, an error tool result, trailing INFO log line, and the same final
// AIMessage appearing in BOTH the updates and values events.
const ESC = String.fromCharCode(27);
const BT = String.fromCharCode(96); // backtick, kept out of template literals

const VALUES_LINE = ESC + "[1m[values]" + ESC + "[0m {'messages': [" +
  "HumanMessage(content='(workflow context) session_id=5c2e9b41.', additional_kwargs={}, response_metadata={}, id='19ec5005'), " +
  "HumanMessage(content='<user_content>For the smart thermostat (SKU TH4471X): work out the change impact.\\n\\nUploaded: staging/input_files/vendor_thermostat_v2.png</user_content>', id='baded141'), " +
  "AIMessage(content='', response_metadata={'finish_reason': 'tool_calls', 'model_name': 'gpt-5.1-2025-11-13', 'service_tier': 'default'}, name='docs-agent', id='lc_run--01a01935-2f05', tool_calls=[{'name': 'kg_lookup', 'args': {'identifier': 'TH4471X', 'want': 'impact', 'session_id': '5c2e9b41'}, 'id': 'call_XvFc9ZL', 'type': 'tool_call'}], invalid_tool_calls=[], usage_metadata={'input_tokens': 13872, 'output_tokens': 40, 'total_tokens': 13912, 'input_token_details': {'audio': 0, 'cache_read': 13312}}), " +
  "ToolMessage(content='{\"agent_message\": \"Here is the complete impact set for **component TH4471X**.\\n\\n## Procedures\\n\\n1. Installation \\u2013 subtask " + BT + "ID_TH4471_401_0150_0002_ST" + BT + "\\n\\n| Part | Number |\\n|---|---|\\n| wall plate | TH-1014 |\", \"status\": \"success\", \"tool_used\": true, \"rows\": 1, \"cypher\": \"MATCH (c:Component)\\nWHERE c.fin = TH4471X\\nRETURN c\", \"illustrations\": [\"https://x.blob.core.windows.net/eng/thermostat_v1_front_00330002 - Smart Thermostat.png\"], \"_session_anchor\": null}', name='kg_lookup', id='9d89e96c', tool_call_id='call_XvFc9ZL'), " +
  "AIMessage(content='', response_metadata={'finish_reason': 'tool_calls', 'model_name': 'gpt-5.1-2025-11-13'}, name='docs-agent', id='lc_run--01a01936-7549', tool_calls=[{'name': 'invoke_agent', 'args': {'agent_name': 'image-diff-agent', 'parameters': '{\"image1_path\":\"a.png\",\"image2_path\":\"b.png\"}'}, 'id': 'call_Z16vGcj', 'type': 'tool_call'}, {'name': 'read_file', 'args': {'file_path': '/skills/docs/templates/t.xml', 'offset': 0, 'limit': 1000}, 'id': 'call_5QCELu6', 'type': 'tool_call'}], usage_metadata={'input_tokens': 32969, 'output_tokens': 588, 'total_tokens': 33557, 'input_token_details': {'cache_read': 28160}}), " +
  "ToolMessage(content='{\"error\": \"Agent \\'image-diff-agent\\' job failed: mappings[3].confidence must be int 0..100\", \"hint\": \"If this is a file-not-found error, the file may not have been relocated.\"}', name='invoke_agent', id='b25bbb48', tool_call_id='call_Z16vGcj'), " +
  "ToolMessage(content='     1\\t<?xml version=\"1.0\"?>\\n     2\\t<procedure>\\n     3\\t  <step><para>Torque to 0.90\\x111.10 m\\xb7daN.</para></step>\\n     4\\t</procedure>', name='read_file', id='a738f0d3', tool_call_id='call_5QCELu6'), " +
  "AIMessage(content='Saved as " + BT + "az-blob://docs-site/out/kg_TH4471X_procedure.xml" + BT + ".', response_metadata={'finish_reason': 'stop', 'model_name': 'gpt-5.1-2025-11-13'}, name='docs-agent', id='lc_run--01a01938-2e38', tool_calls=[], usage_metadata={'input_tokens': 44613, 'output_tokens': 168, 'total_tokens': 44781, 'input_token_details': {'audio': 0, 'cache_read': 44032}})" +
  "], 'skills_metadata': [{'name': 'kg', 'version': '0.3.0'}], 'files': {}}" +
  "2026-08-19 14:21:51 INFO     [docs_agent] =======================";

const UPDATES_LINE = ESC + "[1m[updates]" + ESC + "[0m {'model': {'messages': [" +
  "AIMessage(content='Saved as " + BT + "az-blob://docs-site/out/kg_TH4471X_procedure.xml" + BT + ".', response_metadata={'finish_reason': 'stop', 'model_name': 'gpt-5.1-2025-11-13'}, name='docs-agent', id='lc_run--01a01938-2e38', usage_metadata={'input_tokens': 44613, 'output_tokens': 168, 'total_tokens': 44781})]}}";

function report(label, text) {
  const r = api.parseAgentLog(text);
  console.log('=== ' + label + ' ===');
  console.log('mode:', r.diag.mode, '| events:', r.diag.events.length, '| parse errors:', r.diag.errors.length);
  if (r.diag.errors.length) console.log('  ERRORS:', r.diag.errors);
  console.log('stats:', JSON.stringify(r.stats));
  r.messages.forEach(m => {
    const tc = m.tool_calls.map(t => t.name + (t.result ? '->#' + t.result.index + (t.result.isError ? '!' : '') : '->?')).join(', ');
    console.log('  #' + m.index + ' ' + m.kind.padEnd(6) + ' name=' + (m.name || '-') +
      ' seen=' + m.seen + ' err=' + m.isError + ' tc=[' + tc + ']' +
      ' paired=' + (m.pairedTo ? '#' + m.pairedTo.index : '-') +
      ' content="' + String(m.content).replace(/\n/g, '\\n').slice(0, 56) + '"');
  });
  console.log('extras keys:', Object.keys(r.extras));
  console.log('trailing ignored:', JSON.stringify(r.diag.trailing));
  console.log('');
  return r;
}

const a = report('1. VALUES LINE ONLY', VALUES_LINE);
const b = report('2. UPDATES + VALUES', UPDATES_LINE + '\n' + VALUES_LINE);
const c = report('3. BARE DICT, NO MARKER', VALUES_LINE.slice(VALUES_LINE.indexOf('{')));
const d = report('4. END-STATE MESSAGE ONLY', UPDATES_LINE);
const e = report('5. PLAIN JSON', JSON.stringify({
  messages: [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello', tool_calls: [{ id: 't1', name: 'search', args: { q: 'x' } }] },
    { role: 'tool', content: '{"status":"error","error":"boom"}', tool_call_id: 't1', name: 'search' }
  ]
}));
const f = report('6. FREEFORM TEXT', 'Run finished. Output written to /tmp/out.xml. No errors.');

let fails = 0;
const assert = (cond, msg) => { if (!cond) fails++; console.log((cond ? 'PASS' : 'FAIL') + ' - ' + msg); };
console.log('--- assertions ---');
assert(a.messages.length === 8, 'values-only yields all 8 messages (got ' + a.messages.length + ')');
assert(a.diag.errors.length === 0, 'values-only parses with zero errors');
assert(b.messages.length === 8, 'updates+values dedupes to 8 (got ' + b.messages.length + ')');
assert(b.messages[7].seen === 2, 'final message counted in 2 snapshots (got ' + b.messages[7].seen + ')');
assert(b.messages[7].kind === 'ai' && /Saved as/.test(b.messages[7].content), 'ordering: values spine kept, final msg last');
assert(b.messages[0].kind === 'human', 'first card is the human turn, not the updates fragment');
assert(a.stats.toolErrors === 1, 'one tool error detected (got ' + a.stats.toolErrors + ')');
assert(a.messages[5].isError === true, 'invoke_agent failure flagged as error');
assert(a.messages[2].tool_calls[0].result === a.messages[3], 'kg_lookup call paired with its ToolMessage');
assert(a.messages[4].tool_calls.length === 2 && a.messages[4].tool_calls[1].result === a.messages[6], 'parallel tool calls both paired');
assert(a.messages[6].content.indexOf('0.90' + String.fromCharCode(0x11) + '1.10') > -1, 'hex escape decoded');
assert(a.messages[3].json && a.messages[3].json.status === 'success', 'JSON-in-string tool payload parsed');
assert(a.messages[3].json.illustrations.length === 1, 'nested JSON array survives');
assert(Object.keys(a.extras).join(',') === 'skills_metadata,files', 'non-message state keys captured as extras');
assert(a.diag.trailing.length === 1 && /INFO/.test(a.diag.trailing[0]), 'trailing INFO log line ignored but reported');
assert(c.messages.length === 8, 'bare dict without marker works (got ' + c.messages.length + ')');
assert(d.messages.length === 1 && d.messages[0].kind === 'ai', 'end-state-only paste works');
assert(e.messages.length === 3 && e.stats.toolErrors === 1, 'plain JSON role-based messages work');
assert(f.messages.length === 1 && f.diag.mode === 'raw-text', 'freeform text degrades to single card');
assert(a.stats.outTokens === 796, 'output tokens summed = 796 (got ' + a.stats.outTokens + ')');
assert(a.stats.cacheRead === 85504, 'cache reads summed = 85504 (got ' + a.stats.cacheRead + ')');
assert(a.stats.agents.join(',') === 'docs-agent', 'agents stat lists only agents, not tool names (got ' + a.stats.agents.join(',') + ')');
assert(a.stats.llmCalls === 3 && a.stats.toolCalls === 3, 'llmCalls=3 toolCalls=3 (got ' + a.stats.llmCalls + '/' + a.stats.toolCalls + ')');
console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all assertions passed'));
process.exit(fails ? 1 : 0);
