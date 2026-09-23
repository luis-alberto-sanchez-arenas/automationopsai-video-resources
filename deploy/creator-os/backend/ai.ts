type GenerateOptions = {
  system: string;
  prompt: string;
  schema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
};

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

async function compatibleGenerate(options:GenerateOptions,provider:'deepseek'|'kimi'|'compatible') {
  const prefix=provider==='compatible'?'AI':provider.toUpperCase();
  const base = (process.env[`${prefix}_BASE_URL`] || (provider==='deepseek'?'https://api.deepseek.com':provider==='kimi'?'https://api.moonshot.ai/v1':'')).replace(/\/$/,'');
  const key = process.env[`${prefix}_API_KEY`] || '';
  const model = process.env[`${prefix}_MODEL`] || '';
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
  let response=await fetch(`${base}/chat/completions`,{
    method:'POST',
    headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},
    body:JSON.stringify(payload),
  });
  if (!response.ok && options.schema) {
    delete payload.response_format;
    payload.messages=[
      {role:'system',content:`${options.system}\nReturn valid JSON only.`},
      {role:'user',content:`${options.prompt}\nSchema:\n${JSON.stringify(options.schema)}`},
    ];
    response=await fetch(`${base}/chat/completions`,{
      method:'POST',
      headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},
      body:JSON.stringify(payload),
    });
  }
  const data=await response.json() as any;
  if (!response.ok) throw new Error(`AI provider failed (${response.status}): ${JSON.stringify(data).slice(0,700)}`);
  const text=data?.choices?.[0]?.message?.content;
  if (typeof text!=='string'||!text.trim()) throw new Error('AI provider returned no text');
  return text;
}

export async function generateText(options:GenerateOptions) {
  const requested=(process.env.AI_PROVIDER_ORDER||'gemini,deepseek,kimi,compatible').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
  const providers=[...new Set(requested)] as Array<'gemini'|'deepseek'|'kimi'|'compatible'>;
  const failures:string[]=[];
  for(const provider of providers){
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
      const prefix=provider==='compatible'?'AI':provider.toUpperCase();
      if(!process.env[`${prefix}_API_KEY`])continue;
      return await compatibleGenerate(options,provider);
    }catch(error){failures.push(`${provider}: ${error instanceof Error?error.message:String(error)}`);}
  }
  throw new Error(`All configured AI providers failed: ${failures.join(' | ').slice(0,1800)}`);
}

export async function generateJson<T>(options:GenerateOptions):Promise<T> {
  const text=await generateText(options);
  return JSON.parse(parseJsonText(text)) as T;
}
