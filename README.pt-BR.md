# Cinderbox Chat

Uma plataforma de mensagens efêmera com foco em privacidade, desenvolvida para auto-hospedagem. Sem contas, sem números de telefone, sem registros — apenas salas criptografadas que desaparecem.

O Cinderbox Chat foi desenvolvido desde o início para rodar em infraestrutura que você controla. Faz deploy em qualquer hospedagem PHP/MySQL padrão, sem etapa de build, sem Node.js, sem Docker e sem CDN.

| Desktop | Mobile |
|----------|---------------|
| <img height="400" alt="image" src="https://github.com/user-attachments/assets/c18afcca-2c83-4300-a6f5-8697b3a1be73" /> | <img height="400" alt="image" src="https://github.com/user-attachments/assets/207e9f06-e054-400b-a551-b6ac0e59d3af" />

## Demo ao Vivo

Uma instância pública está disponível em **[cc.outros.net](https://cc.outros.net)** — gratuita para testes e conversas reais. Sem cadastro necessário.

---

## Funcionalidades

### Mensagens
- **Texto, imagens e áudio** — envie texto, fotos e clipes de voz de até 2 minutos
- **Respostas a mensagens** — responda a qualquer mensagem específica; um trecho citado aparece em linha e clicar nele rola até a mensagem original
- **Mensagens de visualização única** — conteúdo que só pode ser aberto uma vez; o destinatário precisa estar online para abrir, e o conteúdo é permanentemente apagado do dispositivo após a visualização
- **Exclusão de mensagens** — exclua uma mensagem apenas para você ou solicite a exclusão de todos os dispositivos dos destinatários, com rastreamento de confirmação por destinatário

### Salas
- **Sem contas** — identifique-se com um apelido e uma senha, nada mais
- **Salas efêmeras** — escolha um período de retenção (1h, 6h, 12h, 24h) ou crie uma sala permanente; salas efêmeras e todas as suas mensagens são automaticamente eliminadas
- **Nomes e avatares personalizados** — os nomes ficam apenas no seu dispositivo, nunca armazenados no servidor
- **Múltiplas salas** — gerencie várias conversas simultaneamente em uma única interface

### Privacidade e Segurança
- **Criptografia de ponta a ponta** — todo o conteúdo das mensagens é criptografado no navegador antes de sair do seu dispositivo, usando AES-256-GCM com chaves derivadas via PBKDF2 (200.000 iterações, SHA-256)
- **Nenhum texto claro no servidor** — o servidor armazena apenas blobs de texto cifrado que não consegue ler
- **Sem correlação de identidade** — sua tag de identidade é `SHA-256(apelido + room_id)`, tornando impossível correlacionar sua presença em diferentes salas
- **Senha nunca sai do navegador** — a senha da sala é usada localmente para derivar a chave de criptografia e nunca é transmitida
- **Proteção offline para visualização única** — abrir uma mensagem de visualização única exige uma sincronização confirmada com o servidor primeiro; desativar a rede antes de tocar resulta em falha, não em exposição do conteúdo
- **Recuperação de falha para visualização única** — se o app for forçado a fechar durante a abertura, um sinalizador garante que o reconhecimento de exclusão seja enviado na próxima inicialização
- **Rastreamento de exclusão de mensagens** — "Excluir para todos" envia uma solicitação de exclusão assinada a cada destinatário e rastreia a confirmação; o remetente mantém uma marca de exclusão para auditar quem confirmou

### Interface
- **Temas escuro e claro** — persistidos por dispositivo
- **Internacionalização** — inglês e português brasileiro (pt-BR); seletor de idioma na barra de navegação
- **Ticks de entrega com 5 estados** — 🕐 na fila → ✓ recebido pelo servidor → ✓✓ baixado → ✓✓ (parcial) visualizado → ✓✓ todos visualizaram
- **Modal de informações da mensagem** — toque em qualquer mensagem enviada para ver o status de entrega, visualização e exclusão por destinatário
- **Menu de contexto** — clique com o botão direito ou pressione e segure qualquer mensagem para responder, excluir ou ver os dados da mensagem
- **Compressão de imagens** — fotos são automaticamente redimensionadas para 1000px e recodificadas como AVIF (com fallback para WebP/JPEG) antes do envio
- **Sem CDN, sem requisições externas** — todo o frontend é um único arquivo HTML autocontido

---

## Auto-Hospedagem

O Cinderbox Chat faz deploy como um pequeno conjunto de arquivos estáticos junto com um único script PHP. Sem etapa de build, sem gerenciador de pacotes e sem variáveis de ambiente.

| Arquivo | Função |
|---------|--------|
| `index.html` | Frontend SPA completo — toda a interface e lógica do lado do cliente |
| `api.php` | API backend — todas as interações com o banco de dados |
| `sw.js` | Service Worker — shell offline e ciclo de atualização do PWA |
| `manifest.json` | Manifesto PWA — habilita "Adicionar à tela inicial" |
| `icon.svg` | Ícone do aplicativo |
| `.htaccess` | Redirecionamento HTTP→HTTPS e cabeçalho HSTS (Apache) |

`index.html` e `api.php` são os únicos arquivos estritamente necessários para o funcionamento do app. Os outros três habilitam a instalação como PWA e o shell de fallback offline.

### Requisitos
- PHP 8.0+ com PDO e PDO_MySQL
- MySQL 8.0+ (ou MariaDB equivalente)
- Qualquer hospedagem web padrão (hospedagem compartilhada funciona)

### Configuração

1. Copie os arquivos para o diretório raiz do seu servidor:
   ```bash
   scp src/api.php src/index.html src/sw.js src/manifest.json src/icon.svg src/.htaccess usuario@seuservidor.com:~/public_html/
   ```

2. Acesse seu site no navegador. Uma tela de configuração aparecerá solicitando suas credenciais MySQL.

3. Envie o formulário. O `config.php` é gerado automaticamente e o esquema do banco de dados é criado. O endpoint de configuração é permanentemente desativado após o primeiro uso.

Pronto. Sem etapa de build, sem gerenciador de pacotes, sem variáveis de ambiente.

### Implantando Atualizações

```bash
scp src/api.php src/index.html src/sw.js src/manifest.json src/icon.svg src/.htaccess usuario@seuservidor.com:~/public_html/
```

Quaisquer novas migrações de banco de dados são executadas automaticamente na primeira requisição após a implantação.

**Importante — atualize a versão do Service Worker a cada implantação** que altere o `index.html`. Abra o `sw.js` e incremente o nome do cache (ex.: `cinderbox-v4` → `cinderbox-v5`) antes de fazer o upload. Isso aciona um ciclo de atualização automático: o novo SW é ativado imediatamente e todas as abas abertas recarregam com a nova versão. Sem essa etapa, usuários no PWA Android/iOS podem continuar executando a versão antiga indefinidamente.

---

## Design de Segurança

| Propriedade | Implementação |
|-------------|---------------|
| Algoritmo de criptografia | AES-256-GCM |
| Derivação de chave | PBKDF2, SHA-256, 200.000 iterações |
| Material da chave | Senha da sala (nunca transmitida) |
| Tag de identidade | SHA-256(apelido + room\_id) — por sala, não correlacionável |
| Conhecimento do servidor | Apenas texto cifrado — sem texto claro, sem metadados, sem logs de IP |
| Injeção de SQL | Prepared statements PDO em todo o código, sem exceções |
| Tokens de exclusão | Armazenados como hash SHA-256, verificados com `hash_equals` |
| Divulgação de erros | `error_reporting(0)` — sem stack traces ou saída de erros |
| Limite de taxa | 60 mensagens por tag de remetente por minuto |
| Tamanho da mensagem | Limite rígido de 2 MB aplicado no servidor |
| Endpoint de configuração | Desativado permanentemente após o primeiro uso (retorna 403) |
| Arquivo de configuração | Excluído do git via `.gitignore` |
| XSS — conteúdo recebido | Avatares validados com prefixo `data:image/`; todos os valores controlados pelo usuário são escapados em HTML antes da inserção no DOM |

---

## Documentação

| Documento | Descrição |
|-----------|-----------|
| [Manual do Usuário](docs/user_manual.md) | Guia do usuário final: salas, mensagens, visualização única, perfis, notificações |
| [Guia de Auto-Hospedagem](docs/setup.md) | Implantação, configuração do banco de dados, versionamento do Service Worker, configuração de proxy reverso |
| [Arquitetura](docs/architecture.md) | Modelo de sincronização, camadas de armazenamento, fluxo de mensagens, modelo de presença, sistema de ACK |
| [Criptografia](docs/encryption.md) | Primitivas criptográficas, derivação de chaves, modelo de ameaças |
| [Banco de Dados do Cliente](docs/client_database.md) | Esquema do IndexedDB, chaves do localStorage, estrutura do outbox |
| [Limpeza do Servidor](docs/server_cleanup.md) | Rotinas de expiração no servidor: expiração lazy, expiração global, entrega de inbox |

---

## Licença

Consulte [LICENSE](LICENSE).
