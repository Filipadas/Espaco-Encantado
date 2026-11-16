# Espaço Encantado

Aplicação web do Espaço Encantado (Express + Pug + MongoDB/Mongoose) para catálogo, cadastro de clientes, solicitações de locação, agenda e área administrativa.

## Requisitos

- Node.js e npm
- Acesso a um banco MongoDB (local ou Atlas)

## Configuração

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Configure as variáveis de ambiente em um arquivo `.env` na raiz do projeto (não versionar nem compartilhar esse arquivo). Exemplo de variáveis usadas pela aplicação:

   ```env
   MONGO_URI=sua_string_de_conexao_mongodb
   # SESSION_SECRET=uma_chave_secreta_forte
   # Outras variáveis podem ser necessárias conforme recursos habilitados no ambiente (ex.: armazenamento de imagens, integrações).
   ```

   > Use valores reais apenas no ambiente local/servidor. Não inclua senhas, chaves, tokens ou strings de conexão reais no README ou em commits.

3. Inicie a aplicação:

   ```bash
   npm start
   ```

   Por padrão o servidor sobe em `http://localhost:3000` (conforme configuração do projeto).

## Verificação rápida

- Página inicial: `http://localhost:3000/`
- Saúde da conexão com o banco (API): `GET /api/produtos/saude` retorna o estado da conexão.
- Rotas `/api/produtos` são protegidas para uso administrativo; o gerenciamento de produtos pelo painel é feito em `/admin/produtos`.

## Contas e acesso

- O sistema não cria uma conta administrativa padrão.
- Para criar ou promover um administrador com segurança, com `MONGO_URI` configurada no ambiente, execute:

  ```bash
  npm run admin:create
  ```

  O comando solicita os dados necessários no terminal e armazena a senha como hash no banco.
- Permissões são validadas no servidor. A área `/admin` é restrita a administradores; clientes utilizam áreas como perfil, sacola e catálogo.

## Principais áreas do sistema

- **Público/cliente:** página inicial, catálogo e busca, página de produto, favoritos, sacola, cadastro/login, perfil e solicitação de reunião/locação.
- **Administrativo:** painel em `/admin` com módulos para gestão de produtos, estoque, usuários, solicitações/comprovantes, agenda/reuniões, carrossel e configurações do site (os caminhos e recursos disponíveis podem evoluir conforme o projeto).

## Modelos e dados

- Os schemas Mongoose ficam em `models/`.
- Produtos (`models/Product.js`) incluem campos como nome, categoria, preço, imagens, estoque, especificações, subcategorias e componentes (para kits/festas), entre outros conforme a evolução do cadastro.
- Mantenha credenciais e dados sensíveis apenas em variáveis de ambiente/segredos do ambiente de execução.
