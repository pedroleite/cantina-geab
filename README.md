# Cantina do Grupo — PDV

App de caixa (PDV) para a cantina do grupo escoteiro, feito para uso no celular. Hospedado
de graça no Firebase (Hosting + Firestore + Authentication).

## Já está no ar

- **App:** <https://cantina-geab.web.app> (abra no celular e adicione à tela inicial)
- **Console do Firebase:** <https://console.firebase.google.com/project/cantina-geab/overview>
- **Projeto:** `cantina-geab` · conta dona: `bytetecn@gmail.com`
- **Login do app:** conta única de e-mail/senha, criada em Authentication > Users no Console.

O restante deste README documenta como esse deploy foi feito (útil para recriar em outra conta
ou entender a configuração).

## Testando sem mexer nos dados reais (staging)

Existe um segundo projeto Firebase, `geab-a7d70`, com Firestore e Authentication próprios —
totalmente isolado da produção. O mesmo `public/index.html` decide sozinho qual usar, com base
no domínio onde está rodando (veja `IS_PRODUCTION` perto do início do `<script type="module">`):
só `cantina-geab.web.app`/`cantina-geab.firebaseapp.com` falam com o banco de produção — qualquer
outro lugar (staging publicado, `localhost`, uma prévia local) cai em staging por padrão, com um
aviso vermelho "AMBIENTE DE TESTE" no topo da tela.

Isso significa que **testar localmente não precisa de URL nenhuma nem de trocar config**: basta
subir um servidor estático na pasta `public/` (ex.: `npx http-server public` ou
`firebase serve --project staging`) e abrir `http://localhost:<porta>` — automaticamente usa o
Firestore de staging.

- **Deploy pro staging:** `firebase deploy --project staging`
- **Deploy pra produção:** `firebase deploy --project production`
- **Login de staging:** `teste@geab.org.br` (criado em Authentication > Users do projeto `geab-a7d70`)

## Estrutura do projeto

```text
GEAB/
  public/index.html    <- o app em si (é isso que fica hospedado)
  original/             <- cópia da versão original (artifact), guardada como referência
  firebase.json         <- configuração do Firebase Hosting
  firestore.rules       <- regras de segurança do banco de dados
```

## Passo a passo para colocar no ar (gratuito)

### 1. Criar o projeto no Firebase

1. Acesse <https://console.firebase.google.com> e clique em **Adicionar projeto**.
2. Dê um nome (ex.: `cantina-geab`) e conclua a criação (pode desativar o Google Analytics).
3. Fique no **plano Spark (gratuito)** — é o padrão e cobre com folga o uso de uma cantina de grupo.

### 2. Ativar Authentication (login)

1. No menu lateral, vá em **Build > Authentication > Get started**.
2. Na aba **Sign-in method**, ative o provedor **E-mail/senha**.
3. Na aba **Users**, clique em **Add user** e crie a conta única que os chefes vão usar para
   abrir o caixa, por exemplo:
   - E-mail: `cantina@seugrupo.org.br` (não precisa ser um e-mail real, só precisa ter esse formato)
   - Senha: escolha uma senha e compartilhe só com os chefes responsáveis pela cantina.

### 3. Ativar o Firestore (banco de dados)

1. No menu lateral, vá em **Build > Firestore Database > Create database**.
2. Escolha a localização mais próxima (ex.: `southamerica-east1`) e comece em **modo produção**
   (as regras de segurança do projeto já cuidam do acesso).

### 4. Pegar as credenciais do app web

1. No Console, clique na engrenagem (⚙) > **Configurações do projeto**.
2. Em **Seus apps**, clique no ícone `</>` para registrar um app da Web (nome livre, ex.: `cantina-web`).
3. Copie o objeto `firebaseConfig` que aparece na tela.
4. Abra [public/index.html](public/index.html), procure por `firebaseConfig` (perto do início do
   `<script type="module">`) e substitua os valores `SUA_API_KEY`, `SEU_PROJETO` etc. pelos que
   você copiou.

### 5. Instalar o Firebase CLI e publicar

No terminal, dentro da pasta `GEAB`:

```bash
npm install -g firebase-tools
firebase login
firebase use --add        # selecione o projeto que você criou
firebase deploy
```

Ao final, o terminal mostra a URL pública (algo como `https://cantina-geab.web.app`) — é esse
link que os chefes vão abrir no celular. Pode adicionar à tela inicial do celular como um app
(Chrome/Safari > "Adicionar à tela de início") para abrir como se fosse um aplicativo.

Para publicar atualizações depois, basta editar `public/index.html` e rodar `firebase deploy`
de novo.

### 6. Publicar as regras de segurança do Firestore

Isso garante que só quem estiver logado consegue ler/gravar dados:

```bash
firebase deploy --only firestore:rules
```

(O comando `firebase deploy` do passo 5 já publica tudo — hosting e regras — de uma vez, então
esse passo só é necessário se você quiser publicar só as regras.)

## Como funciona o armazenamento

O app original foi escrito para rodar no ambiente de Artifacts do Claude, usando uma API de
armazenamento chamada `window.storage`. Essa API não existe fora dali, então ela foi substituída
por chamadas ao Firestore, mas o restante do app (toda a lógica de vendas, fiado, relatório etc.)
continua exatamente igual.

- Dados **compartilhados** entre todos os chefes/aparelhos (vendas, estoque, catálogo, fiados,
  cadastros extras, chave Pix) ficam na coleção `cantina_kv` do Firestore.
- O nome do chefe digitado no topo da tela fica salvo só no aparelho local (`localStorage`), como
  já era antes.

## Limites do plano gratuito

Para o volume de uma cantina de grupo escoteiro (algumas dezenas de vendas por sábado), o uso
fica bem abaixo dos limites diários gratuitos do Firebase (Hosting, Firestore e Authentication).
Não é necessário cadastrar cartão de crédito para usar o plano Spark.
