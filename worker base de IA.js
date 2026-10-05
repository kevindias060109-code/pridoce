// Assistente de ideias da Pri Doce&ria — Cloudflare Worker
// Segredos (Settings > Variables and Secrets):  OPENAI_API_KEY, GEMINI_API_KEY
// Variáveis opcionais: ALLOWED_ORIGIN (ex.: https://seusite.com.br), OPENAI_MODEL,
//   GEMINI_IMAGE_MODEL, CHAT_LIMIT (mensagens/dia por visitante), IMAGE_LIMIT (imagens/dia por visitante)
// KV opcional: crie um namespace e ligue com o nome RATE para ativar o limite diário por visitante.

const MENU = `
BOLOS TRADICIONAIS (massa branca ou chocolate)
Sabores: Ninho com Morango; Chocolate com Morango; Chocolate com Cacau 50%; Dois Amores (chocolate e Ninho); Ouro Branco; Abacaxi com Creme Belga; Prestígio; Chocolate com Maracujá.
Tamanhos: Redondo 20 cm (15 fatias) R$160; Redondo 25 cm (22 fatias) R$203; Retangular 20x30 cm (24 fatias) R$203; Retangular 25x37 cm (48 fatias) R$269; Retangular 30x45 cm (60 fatias) R$443.

BOLOS ESPECIAIS
Sabores: Limão Siciliano com Mirtilo; Mousse de Chocolate Branco com Frutas Vermelhas; Floresta Negra; Floresta Branca; Tropical (morango, kiwi, abacaxi e uva verde com Creme Belga); Ninho com Nutella.
Tamanhos: Redondo 20 cm (15 fatias) R$176; Redondo 25 cm (22 fatias) R$223,30; Retangular 20x30 cm (24 fatias) R$223,30; Retangular 25x37 cm (48 fatias) R$295,90; Retangular 30x45 cm (60 fatias) R$488.

BOLOS PREMIUM
Sabores: Bolo Pudim; Cacau 100%; Red Velvet.
Tamanhos: 20x20 cm (15 fatias) R$174; 30x30 cm (30 fatias) R$350.

DOCINHOS (preço por cento)
Tradicionais: Brigadeiro R$150; Beijinho R$150; Bicho de pé R$181,25; Ninho R$150.
Gourmet: Brigadeiro cacau 70% com granulado nobre R$319; Brigadeiro meio amargo R$319; Beijinho coco fresco R$304,50; Ninho com Nutella R$391,50; Dois amores R$348; Ninho com uva R$217,50.

REGRAS
- Só trabalhamos com frutas frescas; sabores com fruta pedem confirmação de disponibilidade e, de preferência, 2 dias de antecedência.
- Topper personalizado: R$20. A decoração é combinada pelo WhatsApp.
- A entrega é cobrada por bairro (de R$5 a R$25) e calculada no pedido pelo site.
- Bolos de andar: só com orçamento direto pelo WhatsApp.
- O pedido é feito pelo site (escolhendo categoria, sabor e tamanho) ou pelo WhatsApp.
`;

const SYSTEM = `Você é a assistente virtual da Pri Doce&ria, confeitaria artesanal. Fale em português do Brasil, com simpatia e frases curtas (no máximo uns 120 palavras por resposta), pensando em quem lê no celular.
Seu trabalho: responder dúvidas sobre bolos e doces, sugerir sabores, massas, tamanhos (pela quantidade de pessoas) e ideias de decoração para a ocasião do cliente, e criar imagens de inspiração.
Use SOMENTE os sabores, tamanhos e preços do cardápio abaixo; nunca invente itens ou preços. Se algo não estiver no cardápio, diga que dá para combinar pelo WhatsApp.
Quando o cliente pedir para ver, mostrar ou criar uma imagem, ou quando uma imagem ajudar muito na decoração, chame a função gerar_imagem com uma descrição detalhada (formato, cores, decoração, topo, estilo de foto). Depois avise que a imagem é uma inspiração e que o resultado final pode variar um pouco.
Ao organizar a ideia do cliente, entregue um resumo com: ocasião, número de pessoas, sabor e massa, tamanho sugerido do cardápio com preço, decoração e observações. Aponte o que ainda falta.
Assuntos fora de bolos, doces, festas e decoração: redirecione com gentileza para o tema.

CARDÁPIO
${MENU}`;

const TOOLS = [{
  type: 'function',
  function: {
    name: 'gerar_imagem',
    description: 'Cria uma imagem realista de um bolo ou doce decorado, para inspirar o cliente.',
    parameters: {
      type: 'object',
      properties: {
        descricao: { type: 'string', description: 'Descrição detalhada do bolo: formato, cores, decoração, topo, estilo.' }
      },
      required: ['descricao']
    }
  }
}];

function corsFor(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN || '*';
  const list = allowed.split(',').map(s => s.trim());
  const ok = allowed === '*' || list.includes(origin);
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': allowed === '*' ? '*' : (ok ? origin : list[0]),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin'
    }
  };
}

const json = (obj, status, headers) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

async function hit(env, ip, kind, limit) {
  if (!env.RATE) return true;
  const key = `${kind}:${ip}:${new Date().toISOString().slice(0, 10)}`;
  const n = Number(await env.RATE.get(key)) || 0;
  if (n >= limit) return false;
  await env.RATE.put(key, String(n + 1), { expirationTtl: 90000 });
  return true;
}

async function openai(env, messages, withTools) {
  const body = { model: env.OPENAI_MODEL || 'gpt-5.4-mini', messages };
  if (withTools) body.tools = TOOLS;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });
  if (!r.ok) throw new Error('openai ' + r.status);
  return r.json();
}

async function gerarImagem(env, descricao) {
  const model = env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview'; // Nano Banana Pro
  const prompt = `Fotografia profissional de confeitaria, luz suave de estúdio, fundo limpo. ${descricao}. Bolo artesanal brasileiro, aparência apetitosa e realista. Sem texto escrito na imagem, a menos que tenha sido pedido.`;
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '4:5' } }
    }),
    signal: AbortSignal.timeout(75000)
  });
  if (!r.ok) throw new Error('gemini ' + r.status);
  const data = await r.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const part = parts.find(p => p.inlineData || p.inline_data);
  const d = part && (part.inlineData || part.inline_data);
  if (!d) throw new Error('sem imagem');
  return `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`;
}

export default {
  async fetch(req, env) {
    const c = corsFor(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.headers });
    const url = new URL(req.url);
    if (req.method !== 'POST' || url.pathname !== '/chat') return json({ error: 'Não encontrado.' }, 404, c.headers);
    if (!c.ok) return json({ error: 'Origem não permitida.' }, 403, c.headers);

    try {
      const body = await req.json();
      const history = (Array.isArray(body.messages) ? body.messages : [])
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-16)
        .map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));
      if (!history.length || history[history.length - 1].role !== 'user') return json({ error: 'Mensagem inválida.' }, 400, c.headers);

      const ip = req.headers.get('CF-Connecting-IP') || 'anon';
      if (!(await hit(env, ip, 'chat', Number(env.CHAT_LIMIT || 80)))) {
        return json({ error: 'Você atingiu o limite de mensagens de hoje. Continue pelo WhatsApp que a gente te ajuda!' }, 429, c.headers);
      }

      const messages = [{ role: 'system', content: SYSTEM }, ...history];
      const first = (await openai(env, messages, true)).choices[0].message;
      const images = [];
      let reply = first.content;

      if (first.tool_calls?.length) {
        let result;
        try {
          const args = JSON.parse(first.tool_calls[0].function.arguments || '{}');
          if (!(await hit(env, ip, 'img', Number(env.IMAGE_LIMIT || 10)))) {
            result = 'Limite de imagens de hoje atingido. Avise o cliente com gentileza e sugira continuar pelo WhatsApp.';
          } else {
            images.push(await gerarImagem(env, String(args.descricao || '').slice(0, 1200)));
            result = 'Imagem criada e já exibida ao cliente.';
          }
        } catch (e) {
          result = 'Não foi possível criar a imagem agora. Peça desculpas e ofereça descrever a ideia em palavras.';
        }
        const toolMsgs = first.tool_calls.map((tc, i) => ({
          role: 'tool', tool_call_id: tc.id, content: i === 0 ? result : 'Ignorado: uma imagem por vez.'
        }));
        const second = await openai(env, [
          ...messages,
          { role: 'assistant', content: first.content || null, tool_calls: first.tool_calls },
          ...toolMsgs
        ], false);
        reply = second.choices[0].message.content;
      }

      return json({ reply: reply || '', images }, 200, c.headers);
    } catch (e) {
      return json({ error: 'Não consegui responder agora. Tente de novo em instantes.' }, 502, c.headers);
    }
  }
};
