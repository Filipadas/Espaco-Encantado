# Espaco-Encantado

## MongoDB com Mongoose

O projeto já possui uma integração inicial com Mongoose para testes. Ela usa a variável `MONGODB_URI` e um modelo de produto.

### 1. Instale as dependências

```powershell
npm install
```

### 2. Configure o banco

Copie o arquivo de exemplo:

```powershell
Copy-Item .env.example .env
```

Para MongoDB local, mantenha esta URI no `.env`:

```text
MONGODB_URI=mongodb://127.0.0.1:27017/espaco_encantado
```

Se usar MongoDB Atlas, substitua a URI pela connection string do seu cluster. O arquivo `.env` não deve ser commitado.

### 3. Inicie a aplicação

```powershell
npm start
```

O servidor ficará disponível em `http://localhost:3000`.

### 4. Verifique a conexão

Abra `http://localhost:3000/api/produtos/saude`. A resposta deve indicar `"conectado"` quando o MongoDB estiver disponível.

### 5. Teste a API

Listar produtos:

```powershell
Invoke-RestMethod http://localhost:3000/api/produtos
```

Criar um produto:

```powershell
$body = @{ name = 'Kit Festa Encantada'; category = 'kit-montagem'; price = 59.90 } | ConvertTo-Json
Invoke-RestMethod http://localhost:3000/api/produtos -Method Post -ContentType 'application/json' -Body $body
```

O schema está em `models/Product.js`. Ele exige `name`, `category` e `price`, e adiciona automaticamente `createdAt` e `updatedAt`.

## Acesso e gerenciamento

As contas e permissões de administrador são armazenadas no MongoDB. O servidor não cria uma conta administrativa padrão. Para criar ou promover uma conta administrativa com segurança, configure `MONGO_URI` no ambiente do servidor e execute no terminal:

```text
npm run admin:create
```

O comando solicita o nome, e-mail e senha sem gravar esses dados no código ou no histórico do terminal. A senha é armazenada no MongoDB como hash.

Depois do login, o ícone de perfil abre `/perfil` e o ícone de coroa abre `/admin`. O painel administrativo possui:

- `/admin/usuarios`: gerenciamento de usuários e permissões;
- `/admin/produtos`: gerenciamento de produtos;
- `/admin/produtos/novo`: cadastro de produtos;
- `/admin/solicitacoes`: solicitações de locação;
- `/admin/comprovantes`: criação e visualização de comprovantes;
- `/sacola`: sacola do cliente comum.

A autorização é verificada no servidor. Um cliente comum pode acessar a sacola, mas recebe `403` ao tentar acessar `/admin` diretamente.

### Login social e recuperação de senha

Para ativar o login com Google, configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e o callback `http://localhost:3000/auth/google/callback` no console OAuth do Google. Em produção, use o domínio HTTPS do site em `GOOGLE_REDIRECT_URI` e cadastre exatamente a mesma URL como callback autorizado.

Para ativar o login com Apple, configure um identificador de serviço web, Team ID, Key ID e a chave privada `.p8` em `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` e `APPLE_PRIVATE_KEY`. Cadastre e verifique o domínio HTTPS e o callback `/auth/apple/callback` nas configurações do Sign in with Apple, e informe a URL completa em `APPLE_REDIRECT_URI`. A Apple não aceita `localhost` como domínio de retorno. Como o callback Apple usa um POST externo, atrás de proxy HTTPS defina `TRUST_PROXY=1` para manter o cookie de sessão seguro. Quebras de linha da chave privada podem ser representadas como `\n` no valor da variável.

Os botões sociais usam OAuth e validam o `state` e os tokens de identidade antes de associar a conta. A tela “Esqueci minha senha” solicita e-mail ou telefone e abre uma conversa pré-preenchida com a loja pelo WhatsApp para validação manual. O projeto ainda não tem serviço de e-mail ou SMS para envio automático de códigos ou links de redefinição.

No MongoDB, a estrutura usada é um database `espaco_encantado` com as collections `users` e `products`. As categorias `brinquedos`, `decoracoes`, `kit-montagem` e `festa-infantil` são valores do campo `category` dos produtos, o que mantém o catálogo organizado sem criar bancos separados para cada categoria.
