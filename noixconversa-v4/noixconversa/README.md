# NoixConversa

Sem Supabase. Backend em função serverless da Vercel (`api/room.js`) e banco Redis da própria Vercel (Upstash).

## Hospedar
1. Suba este projeto na Vercel (deploy normal).
2. No projeto, abra a aba **Storage → Create Database → Upstash for Redis** (plano gratuito) e conecte ao projeto, marcando todos os ambientes. A Vercel cria as variáveis sozinha.
3. Vá em **Deployments → Redeploy**.

Pronto: não precisa copiar chave nenhuma. As mensagens atualizam por consulta a cada 2 segundos.
