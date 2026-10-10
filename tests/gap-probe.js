const fs=require('fs');
const path=require('path');
const VIEWER=path.join(__dirname,'..','statereel.html');
const h=fs.readFileSync(VIEWER,'utf8');
const core=h.split('/*<<<CORE_START>>>*/')[1].split('/*<<<CORE_END>>>*/')[0];
const api=new Function(core+'\nreturn {parseAgentLog};')();

const cases = {
 'A. LangGraph values (current target)':
   "[values] {'messages': [HumanMessage(content='hi', id='h1'), AIMessage(content='yo', id='a1', usage_metadata={'input_tokens':10,'output_tokens':2})]}",

 'B. LangChain dumpd / .to_json()':
   JSON.stringify({messages:[
     {lc:1,type:'constructor',id:['langchain_core','messages','human','HumanMessage'],kwargs:{content:'hi',id:'h1'}},
     {lc:1,type:'constructor',id:['langchain_core','messages','ai','AIMessage'],kwargs:{content:'',tool_calls:[{name:'search',args:{q:'x'},id:'t1'}]}}
   ]}),

 'C. model_dump() / LangServe JSON':
   JSON.stringify({messages:[{type:'human',content:'hi'},{type:'ai',content:'yo',tool_calls:[{name:'s',args:{},id:'t1'}]}]}),

 'D. stream_mode="messages" token chunks':
   "[messages] (AIMessageChunk(content='Hel', id='run-1'), {'langgraph_node': 'model'})\n" +
   "[messages] (AIMessageChunk(content='lo w', id='run-1'), {'langgraph_node': 'model'})\n" +
   "[messages] (AIMessageChunk(content='orld', id='run-1'), {'langgraph_node': 'model'})",

 'E. deepagents state (todos + files)':
   "[values] {'messages': [HumanMessage(content='research X', id='h1')], 'todos': [{'content':'search','status':'completed'},{'content':'write','status':'in_progress'}], 'files': {'/report.md': '# Draft\\nbody'}}",

 'F. Anthropic content blocks + tool_use':
   JSON.stringify({messages:[{role:'assistant',content:[{type:'thinking',thinking:'hmm'},{type:'text',text:'ok'},{type:'tool_use',id:'tu1',name:'bash',input:{cmd:'ls'}}]}]}),

 'G. OpenAI Agents SDK trace export':
   JSON.stringify({workflow_name:'run',spans:[
     {id:'s1',span_data:{type:'agent',name:'triage',handoffs:['billing'],tools:['lookup']}},
     {id:'s2',parent_id:'s1',span_data:{type:'generation',model:'gpt-x',input:[{role:'user',content:'hi'}],output:[{role:'assistant',content:'yo'}],usage:{input_tokens:5,output_tokens:1}}},
     {id:'s3',parent_id:'s1',span_data:{type:'function',name:'lookup',input:'{"id":1}',output:'ok'}},
     {id:'s4',parent_id:'s1',span_data:{type:'handoff',from_agent:'triage',to_agent:'billing'}}]}),

 'H. LangSmith run tree':
   JSON.stringify({id:'r1',name:'AgentExecutor',run_type:'chain',inputs:{input:'hi'},outputs:{output:'yo'},
     start_time:'2026-08-19T10:00:00Z',end_time:'2026-08-19T10:00:04Z',
     child_runs:[{id:'r2',name:'ChatOpenAI',run_type:'llm',inputs:{messages:[[{type:'human',content:'hi'}]]},outputs:{generations:[[{text:'yo'}]]}}]}),

 'I. OTel GenAI span export':
   JSON.stringify({resourceSpans:[{scopeSpans:[{spans:[
     {name:'invoke_agent docs',attributes:[{key:'gen_ai.operation.name',value:{stringValue:'invoke_agent'}},{key:'gen_ai.usage.input_tokens',value:{intValue:'120'}}]},
     {name:'execute_tool kg_lookup',attributes:[{key:'gen_ai.operation.name',value:{stringValue:'execute_tool'}},{key:'gen_ai.tool.name',value:{stringValue:'kg_lookup'}}]}]}]}]}),
};

const pad=s=>s.padEnd(40);
for (const [name, text] of Object.entries(cases)) {
  let r;
  try { r = api.parseAgentLog(text); } catch(e){ console.log(pad(name),'THREW', e.message.slice(0,50)); continue; }
  const kinds = r.messages.map(m=>m.kind+(m.tool_calls.length?'+tc'+m.tool_calls.length:'')).join(',');
  console.log(pad(name), 'mode='+String(r.diag.mode).padEnd(20), 'msgs='+String(r.messages.length).padEnd(3),
    'tools='+String(r.stats.toolCalls).padEnd(2), 'extras=['+Object.keys(r.extras).join('|')+']', kinds||'-');
}
