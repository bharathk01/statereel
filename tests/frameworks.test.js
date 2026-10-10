// Cross-framework coverage: one fixture per framework's built-in debug/verbose print.
const fs = require('fs');
const path = require('path');
const VIEWER = path.join(__dirname, '..', 'statereel.html');
const h = fs.readFileSync(VIEWER, 'utf8');
const core = h.split('/*<<<CORE_START>>>*/')[1].split('/*<<<CORE_END>>>*/')[0];
const ins = h.split('/*<<<INSIGHT_START>>>*/')[1].split('/*<<<INSIGHT_END>>>*/')[0];
const api = new Function(core + ins + '\nreturn {parseAgentLog, buildInsights, rankAdapters};')();

const NL = '\n';
const F = {};

// ---------- LangGraph / deepagents ----------
F['langgraph'] = "[values] {'messages': [HumanMessage(content='hi', id='h1'), " +
  "AIMessage(content='', id='a1', tool_calls=[{'name':'search','args':{'q':'x'},'id':'t1'}], " +
  "usage_metadata={'input_tokens':100,'output_tokens':10,'input_token_details':{'cache_read':64}}), " +
  "ToolMessage(content='{\"status\":\"ok\"}', name='search', id='r1', tool_call_id='t1'), " +
  "AIMessage(content='done', id='a2', usage_metadata={'input_tokens':140,'output_tokens':5})]}";

F['deepagents'] = "[values] {'messages': [HumanMessage(content='research fusion', id='h1'), " +
  "AIMessage(content='planning', id='a1', usage_metadata={'input_tokens':50,'output_tokens':8})], " +
  "'todos': [{'content':'search sources','status':'completed'},{'content':'draft report','status':'in_progress'}], " +
  "'files': {'/report.md': '# Draft\\nbody text'}}";

// ---------- LangGraph stream_mode="messages" (token chunks) ----------
F['langgraph-chunks'] =
  "[messages] (AIMessageChunk(content='Hel', id='run-1'), {'langgraph_node': 'model'})" + NL +
  "[messages] (AIMessageChunk(content='lo w', id='run-1'), {'langgraph_node': 'model'})" + NL +
  "[messages] (AIMessageChunk(content='orld', id='run-1', response_metadata={'finish_reason':'stop'}), {'langgraph_node': 'model'})";

// ---------- Claude Agent SDK / CLI --output-format stream-json ----------
F['claude-agent-sdk-ndjson'] = [
  JSON.stringify({type:'system',subtype:'init',cwd:'/repo',model:'claude-opus-5',tools:['Bash','Read','Edit'],session_id:'s1'}),
  JSON.stringify({type:'assistant',message:{id:'m1',model:'claude-opus-5',content:[
    {type:'thinking',thinking:'I should list the files first'},
    {type:'text',text:'Let me look around.'},
    {type:'tool_use',id:'tu1',name:'Bash',input:{command:'ls -la'}}],
    usage:{input_tokens:1200,output_tokens:80,cache_read_input_tokens:1024}}}),
  JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:'tu1',content:'total 8\\nfile.txt'}]}}),
  JSON.stringify({type:'assistant',message:{id:'m2',model:'claude-opus-5',content:[{type:'text',text:'One file: file.txt'}],
    usage:{input_tokens:1400,output_tokens:12}}}),
  JSON.stringify({type:'result',subtype:'success',is_error:false,duration_ms:4212,num_turns:2,
    total_cost_usd:0.0731,result:'One file: file.txt',session_id:'s1'})
].join(NL);

// ---------- Claude Agent SDK python dataclass reprs ----------
F['claude-agent-sdk-repr'] =
  "[AssistantMessage(content=[TextBlock(text='Checking the repo.'), ToolUseBlock(id='tu1', name='Read', input={'file_path': '/a.py'})], model='claude-opus-5'), " +
  "UserMessage(content=[ToolResultBlock(tool_use_id='tu1', content='print(1)', is_error=False)]), " +
  "ResultMessage(subtype='success', duration_ms=3100, num_turns=2, total_cost_usd=0.021, is_error=False, result='It prints 1.')]";

// ---------- Google ADK Event reprs ----------
F['google-adk'] =
  "Event(author='user', content=Content(parts=[Part(text='what is the weather in Paris?')], role='user'), id='e1')" + NL +
  "Event(author='weather_agent', content=Content(parts=[Part(function_call=FunctionCall(id='fc1', name='get_weather', args={'city': 'Paris'}))], role='model'), id='e2', usage_metadata={'prompt_token_count': 210, 'candidates_token_count': 18})" + NL +
  "Event(author='weather_agent', content=Content(parts=[Part(function_response=FunctionResponse(id='fc1', name='get_weather', response={'temp_c': 18}))], role='user'), id='e3', actions=EventActions(state_delta={'last_city': 'Paris'}))" + NL +
  "Event(author='weather_agent', content=Content(parts=[Part(text='It is 18C in Paris.')], role='model'), id='e4', turn_complete=True)";

// ---------- CrewAI verbose console ----------
F['crewai'] = [
  '╭──── Crew Execution Started ────╮',
  '│ Crew: research_crew                │',
  '╰───────────────────────────╯',
  '',
  '# Agent: Senior Researcher',
  '## Task: Find the top AI trends for 2026',
  '',
  '# Agent: Senior Researcher',
  '## Thought: I should search the web for recent surveys',
  '## Using tool: Search the internet',
  '## Tool Input:',
  '"{\\"search_query\\": \\"AI trends 2026\\"}"',
  '## Tool Output:',
  'Title: State of AI 2026 -- agents dominate enterprise adoption',
  '',
  '# Agent: Senior Researcher',
  '## Final Answer:',
  'The top trends are agentic workflows, small models, and eval tooling.'
].join(NL);

// ---------- LangChain classic verbose / ReAct ----------
F['langchain-react'] = [
  '> Entering new AgentExecutor chain...',
  'Thought: I need the current population of Paris',
  'Action: Search',
  'Action Input: "population of Paris 2026"',
  'Observation: About 2.1 million in the city proper',
  'Thought: I now know the final answer',
  'Final Answer: Paris has about 2.1 million residents.',
  '> Finished chain.'
].join(NL);

// ---------- AutoGen AgentChat Console ----------
F['autogen'] = [
  '---------- TextMessage (user) ----------',
  'What is the weather in New York?',
  '---------- ToolCallRequestEvent (weather_agent) ----------',
  "[FunctionCall(id='call_1', arguments='{\"city\":\"New York\"}', name='get_weather')]",
  '---------- ToolCallExecutionEvent (weather_agent) ----------',
  "[FunctionExecutionResult(content='The weather in New York is 23 degrees and Sunny.', call_id='call_1', is_error=False)]",
  '---------- TextMessage (weather_agent) ----------',
  'It is 23 degrees and sunny in New York.',
  '---------- Stop Reason ----------',
  'Maximum number of messages 5 reached'
].join(NL);

// ---------- Pydantic AI message history ----------
F['pydantic-ai'] =
  "[ModelRequest(parts=[SystemPromptPart(content='Be concise.'), UserPromptPart(content='What is 2+2?')]), " +
  "ModelResponse(parts=[ThinkingPart(content='simple arithmetic'), ToolCallPart(tool_name='calculator', args={'expr': '2+2'}, tool_call_id='pc1')], " +
  "model_name='gpt-5.1', usage=Usage(requests=1, request_tokens=90, response_tokens=14)), " +
  "ModelRequest(parts=[ToolReturnPart(tool_name='calculator', content='4', tool_call_id='pc1')]), " +
  "ModelResponse(parts=[TextPart(content='2+2 is 4.')], model_name='gpt-5.1', usage=Usage(request_tokens=110, response_tokens=8))]";

// ---------- OpenAI-style chat JSON ----------
F['openai-chat'] = JSON.stringify({messages:[
  {role:'system',content:'You are helpful.'},
  {role:'user',content:'hi'},
  {role:'assistant',content:'',tool_calls:[{id:'c1',type:'function',function:{name:'lookup',arguments:'{"id":7}'}}]},
  {role:'tool',tool_call_id:'c1',name:'lookup',content:'{"error":"not found"}'},
  {role:'assistant',content:'That id does not exist.'}
]});

// CrewAI colours every marker via ColoredText, so the real console output arrives
// wrapped in ANSI escapes. Same content, escaped - must parse identically.
const E = String.fromCharCode(27);
F['crewai-ansi'] = F['crewai']
  .replace(/^# Agent: (.*)$/gm, E + '[1;35m# Agent: ' + E + '[0m' + E + '[1;35m$1' + E + '[0m')
  .replace(/^## (Thought|Using tool|Tool Input|Tool Output|Final Answer|Task): ?(.*)$/gm,
           E + '[92m## $1: ' + E + '[0m' + E + '[92m$2' + E + '[0m');

let fails = 0;
const assert = (c, m) => { if (!c) fails++; console.log((c ? 'PASS' : 'FAIL') + ' - ' + m); };

const R = {};
console.log('=== adapter selection & parse ===');
for (const [name, text] of Object.entries(F)) {
  const r = api.parseAgentLog(text);
  R[name] = r;
  const kinds = r.messages.map(m => m.kind[0] + (m.tool_calls.length ? '*' : '')).join('');
  console.log(
    name.padEnd(26),
    'adapter=' + String(r.diag.adapter).padEnd(18),
    'msgs=' + String(r.messages.length).padStart(2),
    'tools=' + String(r.stats.toolCalls).padStart(2),
    'err=' + String(r.stats.toolErrors),
    'tok=' + r.stats.inTokens + '/' + r.stats.outTokens,
    'cost=' + (r.stats.costUsd ? '$' + r.stats.costUsd : '-'),
    'kinds=' + kinds
  );
  if (r.diag.errors.length) console.log('    issues:', r.diag.errors.join(' | '));
}

console.log('\n=== assertions ===');
// LangGraph baseline unchanged
assert(R['langgraph'].diag.adapter === 'langgraph-stream' && R['langgraph'].messages.length === 4, 'langgraph: 4 messages via langgraph-stream');
assert(R['langgraph'].messages[1].tool_calls[0].result === R['langgraph'].messages[2], 'langgraph: tool call paired');
assert(R['langgraph'].stats.cacheRead === 64, 'langgraph: cache_read read');

// deepagents extras
assert(R['deepagents'].extras.todos && R['deepagents'].extras.todos.length === 2, 'deepagents: todos captured');
assert(R['deepagents'].extras.files && Object.keys(R['deepagents'].extras.files).length === 1, 'deepagents: files captured');

// chunk merge (the bug found earlier)
const ch = R['langgraph-chunks'];
assert(ch.messages.length === 1, 'chunks: 3 chunks collapse to 1 message (got ' + ch.messages.length + ')');
assert(ch.messages[0].content === 'Hello world', 'chunks: content concatenated -> "' + ch.messages[0].content + '"');
assert(ch.messages[0].finish === 'stop', 'chunks: finish_reason from the last chunk');

// Claude Agent SDK NDJSON
const cs = R['claude-agent-sdk-ndjson'];
assert(cs.diag.adapter === 'ndjson-events', 'claude sdk: ndjson-events adapter chosen');
assert(cs.messages.length === 5, 'claude sdk: system + assistant + tool_result + assistant + result = 5 (got ' + cs.messages.length + ')');
assert(cs.messages[1].reasoning.indexOf('list the files') > -1, 'claude sdk: thinking block captured as reasoning');
assert(cs.messages[1].tool_calls.length === 1 && cs.messages[1].tool_calls[0].name === 'Bash', 'claude sdk: tool_use block -> tool call');
assert(cs.messages[2].kind === 'tool' && cs.messages[2].tool_call_id === 'tu1', 'claude sdk: tool_result user turn became a tool message');
assert(cs.messages[1].tool_calls[0].result === cs.messages[2], 'claude sdk: call paired to result');
assert(cs.stats.cacheRead === 1024, 'claude sdk: cache_read_input_tokens read');
assert(Math.abs(cs.stats.costUsd - 0.0731) < 1e-9, 'claude sdk: real cost picked up ($' + cs.stats.costUsd + ')');
assert(cs.stats.durationMs === 4212, 'claude sdk: duration picked up');

// Claude Agent SDK python reprs
const cr = R['claude-agent-sdk-repr'];
assert(cr.messages.length === 3, 'claude repr: assistant + tool result + run result (got ' + cr.messages.length + ')');
assert(cr.messages[1].kind === 'tool' && cr.messages[1].content === 'print(1)', 'claude repr: ToolResultBlock -> tool message');
assert(Math.abs(cr.stats.costUsd - 0.021) < 1e-9, 'claude repr: ResultMessage cost');

// Google ADK
const ad = R['google-adk'];
assert(ad.messages.length >= 4, 'adk: at least 4 events (got ' + ad.messages.length + ')');
assert(ad.messages[0].kind === 'human' && /weather in Paris/.test(ad.messages[0].content), 'adk: user event text');
assert(ad.messages[1].tool_calls[0].name === 'get_weather', 'adk: Part.function_call -> tool call');
assert(ad.messages.some(m => m.kind === 'tool' && /temp_c/.test(m.content)), 'adk: function_response -> tool message');
assert(ad.messages.some(m => m.name === 'state_delta'), 'adk: actions.state_delta surfaced');
assert(ad.stats.inTokens === 210 && ad.stats.outTokens === 18, 'adk: prompt/candidates token counts mapped');

// CrewAI console
const cw = R['crewai'];
assert(cw.diag.adapter === 'crewai-console', 'crewai: crewai-console adapter chosen');
assert(cw.messages.length === 4, 'crewai: task + thought(with tool) + tool output + final = 4 (got ' + cw.messages.length + ')');
assert(cw.messages[1].tool_calls.length === 1 && /Search the internet/.test(cw.messages[1].tool_calls[0].name), 'crewai: Using tool -> tool call');
assert(cw.messages[1].tool_calls[0].args && cw.messages[1].tool_calls[0].args.search_query === 'AI trends 2026', 'crewai: Tool Input JSON parsed');
assert(cw.messages[2].kind === 'tool' && /State of AI/.test(cw.messages[2].content), 'crewai: Tool Output -> tool message');
assert(cw.messages[1].tool_calls[0].result === cw.messages[2], 'crewai: call paired with output despite no ids');
assert(cw.messages[3].finish === 'final_answer' && cw.messages[3].name === 'Senior Researcher', 'crewai: final answer attributed to the agent');

// LangChain ReAct console
const lr = R['langchain-react'];
assert(lr.diag.adapter === 'react-console', 'react: react-console adapter chosen');
assert(lr.messages.filter(m => m.kind === 'tool').length === 1, 'react: one observation as a tool result');
assert(lr.messages[0].tool_calls.length === 1 && lr.messages[0].tool_calls[0].name === 'Search', 'react: Action -> tool call');
assert(lr.messages[0].tool_calls[0].result && /2.1 million/.test(lr.messages[0].tool_calls[0].result.content), 'react: Observation paired to the Action');
assert(lr.messages.some(m => m.node === 'AgentExecutor'), 'react: chain name captured as the node');
assert(lr.messages[lr.messages.length - 1].finish === 'final_answer', 'react: final answer detected');

// AutoGen console
const ag = R['autogen'];
assert(ag.diag.adapter === 'autogen-console', 'autogen: autogen-console adapter chosen');
assert(ag.messages[0].kind === 'human' && ag.messages[0].name === 'user', 'autogen: user turn from the (source) header');
assert(ag.messages[1].tool_calls[0].name === 'get_weather', 'autogen: FunctionCall repr -> tool call');
assert(ag.messages[1].tool_calls[0].args === '{"city":"New York"}' || (ag.messages[1].tool_calls[0].args || {}).city === 'New York', 'autogen: FunctionCall arguments kept');
assert(ag.messages.some(m => m.kind === 'tool' && /23 degrees/.test(m.content)), 'autogen: FunctionExecutionResult -> tool message');
assert(ag.messages.some(m => m.name === 'stop reason'), 'autogen: stop reason captured');

// Pydantic AI
const pa = R['pydantic-ai'];
assert(pa.messages.length === 5, 'pydantic-ai: system + user + response(tool) + tool return + final = 5 (got ' + pa.messages.length + ')');
assert(pa.messages[0].kind === 'system' && /concise/.test(pa.messages[0].content), 'pydantic-ai: SystemPromptPart -> system message');
assert(pa.messages[1].kind === 'human' && /2\+2/.test(pa.messages[1].content), 'pydantic-ai: UserPromptPart -> human message');
assert(pa.messages[2].tool_calls[0].name === 'calculator', 'pydantic-ai: ToolCallPart -> tool call');
assert(pa.messages[2].reasoning.indexOf('arithmetic') > -1, 'pydantic-ai: ThinkingPart -> reasoning');
assert(pa.messages[3].kind === 'tool' && pa.messages[3].content === '4', 'pydantic-ai: ToolReturnPart -> tool message');
assert(pa.stats.inTokens === 200 && pa.stats.outTokens === 22, 'pydantic-ai: Usage request/response tokens mapped');

// OpenAI chat JSON
const oc = R['openai-chat'];
assert(oc.messages.length === 5, 'openai: 5 messages');
assert(oc.messages[2].tool_calls[0].name === 'lookup', 'openai: function.name -> tool call');
assert(oc.stats.toolErrors === 1, 'openai: error payload flagged');

// the ANSI-wrapped CrewAI trace must produce exactly the same result as the plain one
assert(R['crewai-ansi'].diag.adapter === 'crewai-console', 'crewai(ansi): still detected as crewai-console');
assert(R['crewai-ansi'].messages.length === R['crewai'].messages.length,
  'crewai(ansi): same message count as the uncoloured trace (' + R['crewai-ansi'].messages.length + ')');
assert(R['crewai-ansi'].messages[1].tool_calls.length === 1, 'crewai(ansi): tool call still parsed through the colour codes');
assert(R['crewai-ansi'].stats.toolCalls === R['crewai'].stats.toolCalls, 'crewai(ansi): identical tool count');

// insights still work on a non-LangGraph run
const I = api.buildInsights(R['claude-agent-sdk-ndjson']);
assert(I.steps.length >= 3, 'insights: narrative built for the claude sdk run');
assert(I.tools.length === 1 && I.tools[0].name === 'Bash', 'insights: tool aggregate for claude sdk');
const Ic = api.buildInsights(R['crewai']);
assert(/top AI trends/.test(Ic.request || ''), 'insights: crewai task became the request');
assert(/agentic workflows/.test(Ic.outcome || ''), 'insights: crewai final answer became the outcome');

console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all assertions passed'));
process.exit(fails ? 1 : 0);
