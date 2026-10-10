// Generalisation check: frameworks NO adapter was written for.
// This measures how far the three input families + the vocabulary tables carry us.
const fs = require('fs');
const path = require('path');
const VIEWER = path.join(__dirname, '..', 'statereel.html');
const h = fs.readFileSync(VIEWER, 'utf8');
const core = h.split('/*<<<CORE_START>>>*/')[1].split('/*<<<CORE_END>>>*/')[0];
const api = new Function(core + '\nreturn {parseAgentLog};')();

const NL = '\n';
const U = {};

// ---- LlamaIndex AgentWorkflow event stream (python reprs, enum reprs, `blocks`) ----
U['llamaindex'] = [
  "AgentInput(input=[ChatMessage(role=<MessageRole.USER: 'user'>, blocks=[TextBlock(block_type='text', text='What is 12 times 7?')])], current_agent_name='calc_agent')",
  "AgentOutput(response=ChatMessage(role=<MessageRole.ASSISTANT: 'assistant'>, blocks=[TextBlock(block_type='text', text='I will multiply those.')]), tool_calls=[ToolSelection(tool_id='call_1', tool_name='multiply', tool_kwargs={'a': 12, 'b': 7})], current_agent_name='calc_agent')",
  "ToolCallResult(tool_name='multiply', tool_kwargs={'a': 12, 'b': 7}, tool_id='call_1', tool_output=ToolOutput(content='84', tool_name='multiply', is_error=False), return_direct=False)",
  "AgentOutput(response=ChatMessage(role=<MessageRole.ASSISTANT: 'assistant'>, blocks=[TextBlock(block_type='text', text='12 times 7 is 84.')]), tool_calls=[], current_agent_name='calc_agent')"
].join(NL);

// ---- Microsoft Semantic Kernel chat history (python reprs, `items`) ----
U['semantic-kernel'] = [
  "ChatMessageContent(role=<AuthorRole.USER: 'user'>, items=[TextContent(text='What is the weather in Oslo?')], name=None)",
  "ChatMessageContent(role=<AuthorRole.ASSISTANT: 'assistant'>, items=[FunctionCallContent(id='call_9', name='WeatherPlugin-get_weather', arguments='{\"city\":\"Oslo\"}')], name='assistant', metadata={'usage': {'prompt_tokens': 320, 'completion_tokens': 24}})",
  "ChatMessageContent(role=<AuthorRole.TOOL: 'tool'>, items=[FunctionResultContent(id='call_9', name='WeatherPlugin-get_weather', result='4C and overcast')], name=None)",
  "ChatMessageContent(role=<AuthorRole.ASSISTANT: 'assistant'>, items=[TextContent(text='It is 4C and overcast in Oslo.')], name='assistant', metadata={'usage': {'prompt_tokens': 402, 'completion_tokens': 14}})"
].join(NL);

// ---- Vercel AI SDK generateText result (JS/JSON, camelCase, steps[]) ----
U['vercel-ai-sdk'] = JSON.stringify({
  text: 'It is 18C and raining in Paris.',
  steps: [
    { stepType: 'initial', text: '',
      toolCalls: [{ toolCallId: 'tc_1', toolName: 'getWeather', args: { city: 'Paris' } }],
      toolResults: [{ toolCallId: 'tc_1', toolName: 'getWeather', result: { tempC: 18, cond: 'rain' } }],
      usage: { promptTokens: 480, completionTokens: 30 }, finishReason: 'tool-calls' },
    { stepType: 'tool-result', text: 'It is 18C and raining in Paris.', toolCalls: [], toolResults: [],
      usage: { promptTokens: 610, completionTokens: 12 }, finishReason: 'stop' }
  ]
});

// ---- OpenAI Swarm style (role dicts + `sender`) ----
U['swarm'] = JSON.stringify({ messages: [
  { role: 'user', content: 'I want a refund' },
  { role: 'assistant', sender: 'Triage Agent', content: '', tool_calls: [{ id: 'sw1', type: 'function', function: { name: 'transfer_to_refunds', arguments: '{}' } }] },
  { role: 'tool', tool_call_id: 'sw1', tool_name: 'transfer_to_refunds', content: '{"assistant":"Refunds Agent"}' },
  { role: 'assistant', sender: 'Refunds Agent', content: 'I can process that refund for you.' }
]});

// ---- smolagents console output (rich rules + "Observations:") ----
U['smolagents'] = [
  '━━━━━━━━━━ Step 1 ━━━━━━━━━━',
  'Thought: I should search for the population figure.',
  'Action: web_search',
  'Action Input: "population of Oslo 2026"',
  'Observations: Oslo has about 720,000 residents.',
  '━━━━━━━━━━ Step 2 ━━━━━━━━━━',
  'Thought: I have the answer now.',
  'Final Answer: Oslo has roughly 720,000 residents.'
].join(NL);

// ---- Strands Agents (AWS) event dicts ----
U['strands'] = [
  JSON.stringify({ role: 'user', content: [{ text: 'Summarise the incident report' }] }),
  JSON.stringify({ role: 'assistant', content: [{ text: 'Reading the report first.' },
    { toolUse: { toolUseId: 'tu_9', name: 'read_file', input: { path: '/incidents/42.md' } } }] }),
  JSON.stringify({ role: 'user', content: [{ toolResult: { toolUseId: 'tu_9', status: 'success',
    content: [{ text: 'Root cause: expired TLS cert on the edge proxy.' }] } }] }),
  JSON.stringify({ role: 'assistant', content: [{ text: 'The incident was caused by an expired TLS certificate on the edge proxy.' }] })
].join(NL);

const label = s => s.padEnd(17);
let rows = [];
console.log('=== frameworks with NO dedicated adapter ===');
const R = {};
for (const [k, text] of Object.entries(U)) {
  const r = api.parseAgentLog(text);
  R[k] = r;
  const kinds = r.messages.map(m => m.kind[0] + (m.tool_calls.length ? '*' : '')).join('');
  const paired = r.messages.reduce((n, m) => n + m.tool_calls.filter(t => t.result).length, 0);
  rows.push({ k, adapter: r.diag.adapter, msgs: r.messages.length, tools: r.stats.toolCalls, paired,
              tok: r.stats.inTokens + '/' + r.stats.outTokens, kinds });
  console.log(label(k), 'adapter=' + String(r.diag.adapter).padEnd(18),
    'msgs=' + String(r.messages.length).padStart(2),
    'tools=' + String(r.stats.toolCalls).padStart(2),
    'paired=' + paired,
    'tok=' + (r.stats.inTokens + '/' + r.stats.outTokens).padEnd(9),
    'kinds=' + kinds);
}

// scoring: what would a user actually see?
console.log('\n=== usability verdict per framework ===');
function verdict(k) {
  const r = R[k];
  const paired = r.messages.reduce((n, m) => n + m.tool_calls.filter(t => t.result).length, 0);
  const turns = r.messages.filter(m => m.kind === 'human' || m.kind === 'ai').length;
  const hasText = r.messages.some(m => m.content && m.content.trim());
  if (r.diag.adapter === 'raw-text') return 'UNUSABLE  - single raw blob';
  if (turns < 2 || !hasText) return 'POOR      - structure lost';
  if (r.stats.toolCalls && paired === 0) return 'PARTIAL   - turns ok, tool calls unpaired';
  if (!r.stats.toolCalls) return 'PARTIAL   - turns ok, tool calls missed';
  return 'GOOD      - turns + tools + pairing';
}
const V = {};
Object.keys(U).forEach(k => { V[k] = verdict(k); console.log(label(k), V[k]); });

const good = Object.values(V).filter(v => v.startsWith('GOOD')).length;
const usable = Object.values(V).filter(v => !v.startsWith('UNUSABLE')).length;
console.log('\n' + good + '/' + Object.keys(U).length + ' fully understood, ' +
            usable + '/' + Object.keys(U).length + ' at least readable');

// These are the assertions that must hold for the "works with any framework" claim.
let fails = 0;
const assert = (c, m) => { if (!c) fails++; console.log((c ? 'PASS' : 'FAIL') + ' - ' + m); };
console.log('\n=== assertions ===');
Object.keys(U).forEach(k => {
  assert(!V[k].startsWith('UNUSABLE'), k + ': produces a structured report (' + V[k].trim() + ')');
});
Object.keys(U).forEach(k => {
  assert(V[k].startsWith('GOOD'), k + ': turns, tool calls and pairing all recovered');
});

console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all assertions passed'));
process.exit(fails ? 1 : 0);
