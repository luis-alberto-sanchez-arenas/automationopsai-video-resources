type GenerateOptions = {
  system: string;
  prompt: string;
  schema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
};

const providerCooldownUntil=new Map<string,number>();
function cooling(provider:string){return (providerCooldownUntil.get(provider)||0)>Date.now();}
function cool(provider:string,error:unknown){
  const message=error instanceof Error?error.message:String(error);
  // Billing/suspension failures do not recover on the next minute. Retrying
  // them continuously wastes free quota on the remaining providers and fills
  // the operational log with noise.
  if(/\b402\b|insufficient balance|suspended due to insufficient/i.test(message)){
    providerCooldownUntil.set(provider,Date.now()+24*60*60_000);
    return;
  }
  if(/\b429\b|RESOURCE_EXHAUSTED/i.test(message)){
    const m=message.match(/retry-after=(\d+)/i);
    const seconds=m?Math.max(5,Number(m[1])):120;
    providerCooldownUntil.set(provider,Date.now()+seconds*1000);
    return;
  }
  if(/\b503\b|UNAVAILABLE/i.test(message))providerCooldownUntil.set(provider,Date.now()+15*60_000);
}

function parseJsonText(text:string) {
  return text.trim().replace(/^```json\s*/i,'').replace(/```$/,'').trim();
}

async function geminiGenerate(options:GenerateOptions, modelOverride?:string) {
  const key = process.env.GEMINI_API_KEY!;
  const model = modelOverride || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const generationConfig: Record<string,unknown> = {
    temperature: options.temperature ?? 0.3,
    maxOutputTokens: options.maxTokens || 6000,
    responseMimeType: options.schema ? 'application/json' : 'text/plain',
  };
  if (options.schema) generationConfig.responseSchema = options.schema;

  let response = await fetch(url,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      systemInstruction:{parts:[{text:options.system}]},
      contents:[{role:'user',parts:[{text:options.prompt}]}],
      generationConfig,
    }),
  });

  if (!response.ok && options.schema) {
    delete generationConfig.responseSchema;
    response = await fetch(url,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        systemInstruction:{parts:[{text:`${options.system}\nReturn valid JSON only.`}]},
        contents:[{role:'user',parts:[{text:`${options.prompt}\nSchema:\n${JSON.stringify(options.schema)}`}]}],
        generationConfig,
      }),
    });
  }

  const data = await response.json() as any;
  if (!response.ok) throw new Error(`Gemini failed (${response.status}): ${JSON.stringify(data).slice(0,700)}`);
  const text = data?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||'').join('') || '';
  if (!text.trim()) throw new Error('Gemini returned no text');
  return text;
}

type CompatibleProvider='deepseek'|'kimi'|'zai'|'qwen'|'groq'|'openrouter'|'cloudflare'|'compatible';
async function compatibleGenerate(options:GenerateOptions,provider:CompatibleProvider) {
  const prefix=provider==='compatible'?'AI':provider.toUpperCase();
  const defaults:Record<CompatibleProvider,{base:string;model:string}>={
    deepseek:{base:'https://api.deepseek.com',model:''},
    kimi:{base:'https://api.moonshot.ai/v1',model:''},
    zai:{base:'https://api.z.ai/api/paas/v4',model:'glm-4.7-flash'},
    qwen:{base:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',model:'qwen-turbo'},
    groq:{base:'https://api.groq.com/openai/v1',model:'qwen/qwen3.8-27b'},
    openrouter:{base:'https://openrouter.ai/api/v1',model:'openrouter/free'},
    cloudflare:{base:process.env.CLOUDFLARE_ACCOUNT_ID?`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`:'',model:'@cf/zai-org/glm-4.7-flash'},
    compatible:{base:'',model:''},
  };
  const base = (process.env[`${prefix}_BASE_URL`] || defaults[provider].base).replace(/\/$/,'');
  const key = provider==='cloudflare'?(process.env.CLOUDFLARE_API_TOKEN||''):(process.env[`${prefix}_API_KEY`] || '');
  const model = process.env[`${prefix}_MODEL`] || defaults[provider].model;
  if (!base || !key || !model) throw new Error('No AI provider configured');
  const payload:any = {
    model,
    messages:[
      {role:'system',content:options.system},
      {role:'user',content:options.prompt},
    ],
    temperature:options.temperature ?? 0.3,
    max_tokens:options.maxTokens || 6000,
  };
  if (options.schema) {
    payload.response_format={
      type:'json_schema',
      json_schema:{name:'result',strict:true,schema:options.schema},
    };
  }
  const models=provider==='groq'
    ? [...new Set([model,'openai/gpt-oss-20b','openai/gpt-oss-120b'])]
    : [model];
  const failures:string[]=[];
  for(const candidateModel of models){
    const attemptPayload={...payload,model:candidateModel};
    let response=await fetch(`${base}/chat/completions`,{
      method:'POST',
      headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},
      body:JSON.stringify(attemptPayload),
    });
    if (!response.ok && options.schema) {
      const fallbackPayload:any={...attemptPayload};
      delete fallbackPayload.response_format;
      fallbackPayload.messages=[
        {role:'system',content:`${options.system}\nReturn valid JSON only. Do not reveal reasoning.`},
        {role:'user',content:`${options.prompt}\nSchema:\n${JSON.stringify(options.schema)}`},
      ];
      response=await fetch(`${base}/chat/completions`,{
        method:'POST',
        headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},
        body:JSON.stringify(fallbackPayload),
      });
    }
    const data=await response.json() as any;
    if(!response.ok){
      const retryAfter=response.headers.get('retry-after');
      failures.push(`${candidateModel}: HTTP ${response.status}${retryAfter?` retry-after=${retryAfter}`:''} ${JSON.stringify(data).slice(0,420)}`);
      if(response.status===429||response.status>=500)continue;
      throw new Error(`AI provider failed (${response.status}): ${JSON.stringify(data).slice(0,700)}`);
    }
    const raw=data?.choices?.[0]?.message?.content;
    const text=typeof raw==='string'?raw:
      Array.isArray(raw)?raw.map((x:any)=>typeof x==='string'?x:(x?.text||'')).join(''):'';
    if(text.trim())return text;
    failures.push(`${candidateModel}: empty content`);
  }
  throw new Error(`AI provider returned no usable text: ${failures.join(' | ').slice(0,1200)}`);
}


type ExtraProvider={name:string;baseUrl:string;model:string;apiKeyEnv:string};
function extraProviders():ExtraProvider[]{
  const raw=process.env.AI_EXTRA_PROVIDERS_JSON?.trim();
  if(!raw)return [];
  try{
    const parsed=JSON.parse(raw);
    if(!Array.isArray(parsed))return [];
    return parsed.filter((x:any)=>x&&typeof x.name==='string'&&typeof x.baseUrl==='string'&&typeof x.model==='string'&&typeof x.apiKeyEnv==='string');
  }catch{return [];}
}
async function extraCompatibleGenerate(options:GenerateOptions,p:ExtraProvider){
  const key=process.env[p.apiKeyEnv]||'';
  if(!key)throw new Error(`${p.name}: missing ${p.apiKeyEnv}`);
  const base=p.baseUrl.replace(/\/$/,'');
  const payload:any={
    model:p.model,
    messages:[{role:'system',content:options.system},{role:'user',content:options.prompt}],
    temperature:options.temperature??0.3,
    max_tokens:options.maxTokens||6000,
  };
  if(options.schema)payload.response_format={type:'json_object'};
  const response=await fetch(`${base}/chat/completions`,{
    method:'POST',
    headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},
    body:JSON.stringify(payload),
  });
  const data=await response.json() as any;
  if(!response.ok)throw new Error(`${p.name} failed (${response.status}): ${JSON.stringify(data).slice(0,700)}`);
  const text=data?.choices?.[0]?.message?.content;
  if(typeof text!=='string'||!text.trim())throw new Error(`${p.name} returned no text`);
  return text;
}

const FREE_PROVIDERS=new Set(['groq','openrouter','cloudflare','gemini']);
export async function generateText(options:GenerateOptions) {
  const freeOnly=process.env.FREE_ONLY_MODE==='true';
  const requested=(process.env.AI_PROVIDER_ORDER||'groq,openrouter,cloudflare,gemini').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  const providers=[...new Set(requested)].filter(x=>!freeOnly||FREE_PROVIDERS.has(x)) as Array<'gemini'|CompatibleProvider>;
  const failures:string[]=[];
  for(const provider of providers){
    if(cooling(provider)){failures.push(`${provider}: cooling down after quota/transient failure`);continue;}
    try{
      if(provider==='gemini'){
        if(!process.env.GEMINI_API_KEY)continue;
        try{return await geminiGenerate(options);}
        catch(error){
          const fallback=process.env.GEMINI_FALLBACK_MODEL?.trim();
          if(fallback&&fallback!==process.env.GEMINI_MODEL){
            try{return await geminiGenerate(options,fallback);}catch(fallbackError){failures.push(`gemini-fallback: ${fallbackError instanceof Error?fallbackError.message:String(fallbackError)}`);}
          }
          throw error;
        }
      }
      if(provider==='cloudflare'){
        if(!process.env.CLOUDFLARE_API_TOKEN||!process.env.CLOUDFLARE_ACCOUNT_ID)continue;
      }else{
        const prefix=provider==='compatible'?'AI':provider.toUpperCase();
        if(!process.env[`${prefix}_API_KEY`])continue;
      }
      return await compatibleGenerate(options,provider);
    }catch(error){cool(provider,error);failures.push(`${provider}: ${error instanceof Error?error.message:String(error)}`);}
  }
  for(const extra of freeOnly?[]:extraProviders()){
    const id=`extra:${extra.name}`;
    if(cooling(id)){failures.push(`${extra.name}: cooling down after quota/transient failure`);continue;}
    try{return await extraCompatibleGenerate(options,extra);}
    catch(error){cool(id,error);failures.push(`${extra.name}: ${error instanceof Error?error.message:String(error)}`);}
  }
  throw new Error(`All configured AI providers failed: ${failures.join(' | ').slice(0,1800)}`);
}

export async function generateJson<T>(options:GenerateOptions):Promise<T> {
  let last='';
  for(let attempt=0;attempt<2;attempt++){
    const strictSystem=attempt===0?options.system:`${options.system}\nCRITICAL: Return ONLY one valid JSON value matching the schema. No markdown, headings, prose, comments or code fences.`;
    const strictPrompt=attempt===0?options.prompt:`${options.prompt}\n\nReturn JSON only. Do not explain the answer.`;
    const text=await generateText({...options,system:strictSystem,prompt:strictPrompt,temperature:attempt===0?options.temperature:0});
    last=text;
    try{return JSON.parse(parseJsonText(text)) as T;}catch{}
  }
  throw new Error(`AI returned invalid JSON after strict retry: ${last.slice(0,500)}`);
}
