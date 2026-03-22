# Lanchinhos

Aplicação Next.js para organizar receitas rápidas com suporte offline e agora persistência em PostgreSQL (Neon).

## Pré-requisitos

- Node.js 18+
- Banco PostgreSQL compatível com conexões TLS (o projeto usa Neon)

## Configuração rápida

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Copie o arquivo de exemplo de variáveis de ambiente:

   ```bash
   cp .env.local.example .env.local
   ```

3. Edite `.env.local` preenchendo as variáveis necessárias:

   ```env
   DATABASE_URL="postgresql://usuario:senha@host/base?sslmode=require&channel_binding=require"
   AGENT_SHARED_SECRET="segredo-compartilhado"
   OPENAI_API_KEY="coloque-sua-chave-openai"
   OPENAI_MODEL="gpt-4o-mini"
   AUTH_SECRET="string-super-secreta"
   ```

   - `AGENT_SHARED_SECRET` é usado tanto pelo endpoint `/api/agent` quanto por automações internas.
   - `OPENAI_API_KEY` e `OPENAI_MODEL` habilitam o agente externo da OpenAI a interpretar receitas bagunçadas. Sem eles, o app cai automaticamente no parser local.
   - `AUTH_SECRET` assina os tokens de sessão (`/login`). Gere algo longo, ex.: `openssl rand -hex 32`.

4. Crie a tabela necessária (uma vez) na instância Postgres. Execute o SQL abaixo no painel da Neon ou via `psql`:

   ```sql
   CREATE TABLE IF NOT EXISTS recipes (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     ingredients JSONB NOT NULL,
     preparo TEXT NOT NULL,
     finalizacao TEXT NOT NULL,
     favorite BOOLEAN DEFAULT FALSE,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   ```

   Opcionalmente, insira algumas receitas iniciais:

   ```sql
   INSERT INTO recipes (id, name, ingredients, preparo, finalizacao, favorite)
   VALUES
     ('pao-queijo', 'Pão de queijo rápido', '["2 xícaras de polvilho doce","1 xícara de queijo meia cura","2 ovos","1/2 xícara de leite morno"]',
      'Misture tudo até formar massa lisa. Faça bolinhas e asse em forno alto por 15 minutos até dourar.',
      'Sirva quente com manteiga leve.', true)
   ON CONFLICT (id) DO NOTHING;
   ```

5. Inicie o servidor de desenvolvimento:

   ```bash
   npm run dev
   ```

A UI cliente agora consome `/api/recipes`, então qualquer alteração (criar, editar, favoritar, excluir) é persistida diretamente no banco informado acima.

## Autenticação

O fluxo de login depende da tabela `auth_users`. Crie-a (se ainda não existir) executando:

```sql
CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_idx
  ON auth_users (LOWER(email));
```

Para gerar o hash de senha localmente, use o helper incluído no projeto:

```bash
npm run hash-password -- minha-senha-super-secreta
```

Com o hash em mãos, insira ou atualize um usuário:

```sql
INSERT INTO auth_users (id, email, password_hash)
VALUES ('user-admin', 'admin@lanchinhos.app', '$2a$12$ExemploDeHashGeradoPeloScript')
ON CONFLICT (email) DO UPDATE
  SET password_hash = EXCLUDED.password_hash,
      updated_at = NOW();
```

A API `POST /api/auth/login` aceita `{ "email": "...", "password": "..." }` e responde `200` com o usuário autenticado ou `401/422` com um objeto `{ error, field }`. O formulário em `/login` já consome esse endpoint.

Para autoatendimento, o botão **Criar conta** usa `POST /api/auth/register`, que reutiliza os mesmos campos e retorna `201` com o usuário criado. Ambos os endpoints aplicam validações básicas (formato de e-mail e senha mínima de 6 caracteres) e setam o cookie `lanchinhos_session` assinado com `AUTH_SECRET`.

### Recuperação de senha

- `POST /api/auth/password-reset/request`: recebe `{ "email": "usuario@dominio" }` e sempre responde `200`. Em modo de desenvolvimento o token gerado vem no corpo (campo `token`) para facilitar testes.
- `POST /api/auth/password-reset/confirm`: recebe `{ "token": "...", "password": "novaSenha" }`, atualiza a senha e já autentica o usuário retornando o mesmo payload de login.

### Sessões e logout

- `GET /api/auth/session`: retorna o payload decodificado do cookie quando válido.
- `DELETE /api/auth/session`: remove o cookie (logout).

O middleware da aplicação redireciona qualquer usuário não autenticado para `/login` (e responde `401` em APIs). Depois do login/registro o cookie é criado automaticamente e o usuário volta para `/`.

## Integração com o agente de transformação

- Defina `AGENT_SHARED_SECRET` no `.env.local`. Esse segredo precisa ser enviado pelo agente para autenticar cada chamada.
- Endpoint: `POST /api/agent`
- Headers aceitos para autenticação:
  - `x-agent-secret: <AGENT_SHARED_SECRET>` (preferido), ou
  - `Authorization: Bearer <AGENT_SHARED_SECRET>`, ou
  - query string `?secret=<AGENT_SHARED_SECRET>`
- Corpo esperado (JSON):

  ```json
  {
    "data": {
      "id": "opc-id-estavel",
      "name": "Nome da receita",
      "ingredients": ["item 1", "item 2"],
      "preparo": "Resumo em uma frase",
      "finalizacao": "Linha de finalização",
      "favorite": false
    },
    "metadata": {
      "source": "text | image",
      "raw": "Texto original, OCR etc.",
      "imageUrl": "https://..."
    }
  }
  ```

  O bloco `metadata` é opcional e serve apenas para log/auditoria; atualmente não é salvo no banco.

- Resposta: o registro completo persistido em `recipes`.

Exemplo usando `curl` em desenvolvimento:

```bash
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -H "x-agent-secret: $AGENT_SHARED_SECRET" \
  -d '{
        "data": {
          "id": "pao-queijo",
          "name": "Pão de queijo rápido",
          "ingredients": ["Polvilho doce", "Queijo meia cura", "Ovos", "Leite"],
          "preparo": "Misture tudo até formar massa",
          "finalizacao": "Asse a 200 ºC por 15 minutos",
          "favorite": true
        },
        "metadata": { "source": "text" }
      }'
```

Em caso de dados inválidos o endpoint responde `400` com a mensagem de validação; se o segredo estiver incorreto responde `401`.

## Importador com OCR + agente OpenAI

Na tela principal clique em **Importar receita** para abrir o modal. Agora é possível:

- Colar texto bruto como antes (incluindo receitas copiadas da web ou PDFs).
- Colar diretamente uma imagem do clipboard (Ctrl/Cmd + V) ou arrastar um arquivo (JPG/PNG/HEIC) para o dropzone. O app usa OCR local (Tesseract.js) para extrair o texto e preenchê-lo automaticamente nos campos.
- Acompanhar o progresso de extração e revisar/editar o texto antes de clicar em **Transformar**. Esse botão chama `POST /api/import`, que usa a **OpenAI Responses API** (não Agents) quando `OPENAI_API_KEY` está definida, enviando apenas texto e o prompt estruturado que retorna `{ "name", "ingredients", "preparo", "finalizacao" }`. Sem a chave, o app volta ao parser heurístico local como fallback.

Essa rotina roda 100% no navegador; nenhuma imagem é enviada para terceiros. Depois da transformação, a receita abre no formulário para ajustes finais antes de salvar no banco.
