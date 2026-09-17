# 🚀 Guia de Implantação do AssDoc (TermoEP) em Ubuntu com Docker

Este guia contém o passo a passo completo e detalhado para transferir e executar o sistema **AssDoc** em um servidor **Ubuntu Linux**, utilizando **Docker** e **Docker Compose**, preservando todos os dados, usuários, termos gerados e fotos já cadastradas, além de disponibilizá-lo para a rede interna da empresa.

---

## 📋 Sumário
1. [Estrutura e Arquivos Necessários](#1-estrutura-e-arquivos-necessários)
2. [Passo 1: Empacotamento no Windows](#passo-1-empacotamento-no-windows)
3. [Passo 2: Transferência para o Servidor Ubuntu](#passo-2-transferência-para-o-servidor-ubuntu)
4. [Passo 3: Preparação do Ambiente no Ubuntu](#passo-3-preparação-do-ambiente-no-ubuntu)
5. [Passo 4: Configuração das Variáveis (.env)](#passo-4-configuração-das-variáveis-env)
6. [Passo 5: Inicialização com Docker Compose](#passo-5-inicialização-com-docker-compose)
7. [Passo 6: Liberação no Firewall e Acesso na Rede Interna](#passo-6-liberação-no-firewall-e-acesso-na-rede-interna)
8. [Manutenção, Logs e Backup](#manutenção-logs-e-backup)

---

## 1. Estrutura e Arquivos Necessários

Para que nada se perca, os seguintes diretórios e arquivos devem ser transferidos:

| Item | Descrição | Obrigatório |
|---|---|---|
| `database/` | Contém os arquivos `.db` (termos, usuários, configurações). | **Sim (Persistência)** |
| `uploads/` | Contém as fotos de equipamentos e devoluções. | **Sim (Persistência)** |
| `public/` | Interface web (HTML, CSS, JS, logos). | **Sim** |
| `server.js` | Backend da aplicação Express. | **Sim** |
| `package.json` e `package-lock.json` | Definição de dependências do Node.js. | **Sim** |
| `Dockerfile` | Configuração da imagem Docker. | **Sim** |
| `docker-compose.yml` | Orquestração do container e volumes. | **Sim** |
| `.dockerignore` | Evita envio de arquivos desnecessários ao build. | **Sim** |
| `.env` | Variáveis de ambiente (e-mail, caminhos, chaves). | **Sim** |

> ⚠️ **NÃO copie a pasta `node_modules/`**. O Docker fará a instalação limpa das dependências compatíveis com Linux durante a criação da imagem.

---

## Passo 1: Empacotamento no Windows

No seu computador Windows, abra o **PowerShell** dentro da pasta do projeto e execute o comando para criar um arquivo compactado:

```powershell
Compress-Archive -Path database, uploads, public, package.json, package-lock.json, server.js, Dockerfile, docker-compose.yml, .dockerignore, .env -DestinationPath assdoc-deploy.zip -Force
```

---

## Passo 2: Transferência para o Servidor Ubuntu

Você pode transferir o arquivo `assdoc-deploy.zip` usando qualquer um dos métodos abaixo:

### Método A: Via terminal (SCP)
```bash
# Substitua usuario pelo seu usuário e IP_DO_SERVIDOR pelo IP do Ubuntu
scp assdoc-deploy.zip usuario@192.168.X.X:/home/usuario/
```

### Método B: Via Interface Gráfica (WinSCP ou FileZilla)
1. Baixe e abra o **WinSCP** ou **FileZilla**.
2. Conecte ao servidor via **SFTP** usando o IP, usuário e senha do servidor Ubuntu.
3. Arraste o arquivo `assdoc-deploy.zip` para a pasta `/home/usuario/`.

---

## Passo 3: Preparação do Ambiente no Ubuntu

Acesse o terminal do servidor Ubuntu via SSH:
```bash
ssh usuario@192.168.X.X
```

### 1. Atualize o sistema e instale o Docker e utilitários
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y docker.io docker-compose-v2 unzip
```

### 2. Permita executar o Docker sem `sudo` (Opcional, mas recomendado)
```bash
sudo usermod -aG docker $USER
newgrp docker
```

### 3. Extraia o projeto
```bash
# Cria diretório de instalação
mkdir -p ~/assdoc && cd ~/assdoc

# Descompacta os arquivos
unzip ~/assdoc-deploy.zip -d ~/assdoc

# Garante permissões de gravação nas pastas de banco e uploads
chmod -R 777 database uploads
```

---

## Passo 4: Configuração das Variáveis (.env)

Edite o arquivo `.env` dentro da pasta `~/assdoc`:

```bash
nano .env
```

Verifique e ajuste as seguintes linhas:
```dotenv
# Caminho interno no container Docker (mantenha como /app/database)
DB_PATH=/app/database

# Se for habilitar Microsoft OAuth, coloque a URL interna ou domínio do servidor:
MICROSOFT_REDIRECT_URI=http://192.168.X.X:3000/api/auth/microsoft/callback

# Configurações de SMTP para envio de e-mails
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=seuemail@empresa.com
SMTP_PASS=sua_senha_de_app
SMTP_FROM=TermoEP <seuemail@empresa.com>
```

> *Pressione `Ctrl + O` e `Enter` para salvar, depois `Ctrl + X` para sair.*

---

## Passo 5: Inicialização com Docker Compose

Dentro da pasta `~/assdoc`, construa e inicie o container:

```bash
docker compose up -d --build
```

### Verifique se o container está rodando:
```bash
docker compose ps
```
A saída deve mostrar o serviço `assdoc_app` com status **Up**.

### Para acompanhar os logs em tempo real:
```bash
docker compose logs -f
```
Você verá:
```
🚀 Sistema AssDoc rodando em http://localhost:3000
   Login: admin@empresa.com | Senha: admin123
```

---

## Passo 6: Liberação no Firewall e Acesso na Rede Interna

### 1. Libere a porta no firewall do Ubuntu (`ufw`)
```bash
sudo ufw allow 3000/tcp
sudo ufw reload
```

### 2. Descubra o IP local do servidor Ubuntu
```bash
hostname -I
```
*(Exemplo: `192.168.1.150`)*

### 3. Acesse de qualquer máquina da empresa
Abra o navegador em qualquer computador conectado à rede interna ou VPN e digite:
```
http://192.168.1.150:3000
```

---

## 🌟 Configuração Opcional: Acesso direto na Porta 80 (sem `:3000`)

Se quiser que os usuários acessem simplesmente digitando `http://192.168.1.150` no navegador:

1. Edite o arquivo `docker-compose.yml`:
   ```bash
   nano docker-compose.yml
   ```
2. Altere a seção `ports:` de:
   ```yaml
   ports:
     - "3000:3000"
   ```
   Para:
   ```yaml
   ports:
     - "80:3000"
   ```
3. Libere a porta 80 no firewall:
   ```bash
   sudo ufw allow 80/tcp
   ```
4. Reinicie o container:
   ```bash
   docker compose up -d
   ```

---

## Manutenção, Logs e Backup

### 🔄 Como reiniciar o sistema
```bash
cd ~/assdoc
docker compose restart
```

### 🛑 Como parar o sistema
```bash
cd ~/assdoc
docker compose down
```

### 🔄 Como atualizar o código no futuro
1. Substitua os arquivos modificados na pasta `~/assdoc`.
2. Execute:
   ```bash
   docker compose up -d --build
   ```

### 💾 Como fazer Backup dos Dados
Como o `docker-compose.yml` mapeia as pastas `database` e `uploads` diretamente para o disco do Ubuntu, basta copiar essas duas pastas:
```bash
# Cria um backup compactado com data e hora
tar -czvf backup_assdoc_$(date +%Y%m%d_%H%M%S).tar.gz database/ uploads/
```
