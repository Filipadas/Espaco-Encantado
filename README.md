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

Abra `http://localhost:3000/api/products/health`. A resposta deve indicar `"conectado"` quando o MongoDB estiver disponível.

### 5. Teste a API

Listar produtos:

```powershell
Invoke-RestMethod http://localhost:3000/api/products
```

Criar um produto:

```powershell
$body = @{ name = 'Kit Festa Encantada'; category = 'kit-montagem'; price = 59.90 } | ConvertTo-Json
Invoke-RestMethod http://localhost:3000/api/products -Method Post -ContentType 'application/json' -Body $body
```

O schema está em `models/Product.js`. Ele exige `name`, `category` e `price`, e adiciona automaticamente `createdAt` e `updatedAt`.

## Acesso e gerenciamento

Para testes, a aplicação cria ou atualiza automaticamente este administrador quando conecta ao Atlas:

```text
E-mail: admin@espacoencantado.com
Senha: admin123
```

Depois do login, o ícone de perfil abre `/perfil` e o ícone de coroa abre `/admin`. O painel administrativo possui:

- `/admin/users`: gerenciamento de usuários e permissões;
- `/admin/products`: gerenciamento de produtos;
- `/admin/products/new`: cadastro de produtos;
- `/sacola`: sacola do cliente comum.

A autorização é verificada no servidor. Um cliente comum pode acessar a sacola, mas recebe `403` ao tentar acessar `/admin` diretamente.

No MongoDB, a estrutura usada é um database `espaco_encantado` com as collections `users` e `products`. As categorias `brinquedos`, `decoracoes`, `kit-montagem` e `festa-infantil` são valores do campo `category` dos produtos, o que mantém o catálogo organizado sem criar bancos separados para cada categoria.