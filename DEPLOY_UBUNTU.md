# 🚀 Guia de Implantação do AssDoc (TermoEP) em Ubuntu com Docker e Git

Este guia contém o passo a passo completo, prático e direto para clonar o repositório do **GitHub** e executar o sistema **AssDoc** em um servidor **Ubuntu Linux** utilizando **Docker** e **Docker Compose**, preservando todos os dados e liberando o acesso na rede interna.

---

## 📋 Sumário
1. [Repositório e Pré-requisitos](#1-repositório-e-pré-requisitos)
2. [Passo 1: Instalação do Docker e Git no Ubuntu](#passo-1-instalação-do-docker-e-git-no-ubuntu)
3. [Passo 2: Clonagem do Repositório](#passo-2-clonagem-do-repositório)
4. [Passo 3: Permissões de Pastas de Dados](#passo-3-permissões-de-pastas-de-dados)
5. [Passo 4: Configuração das Variáveis (.env)](#passo-4-configuração-das-variáveis-env)
6. [Passo 5: Inicialização com Docker Compose](#passo-5-inicialização-com-docker-compose)
7. [Passo 6: Liberação no Firewall e Acesso na Rede Interna](#passo-6-liberação-no-firewall-e-acesso-na-rede-interna)
8. [Como Atualizar o Sistema (Git Pull)](#como-atualizar-o-sistema-git-pull)
9. [Comandos Úteis e Backup](#comandos-úteis-e-backup)

---

## 1. Repositório e Pré-requisitos

* **URL do Repositório**: `https://github.com/jmarques029/Termos.git`
* **Porta padrão**: `3000` (ou `80`)
* **Sistema Operacional**: Ubuntu Server 20.04 LTS, 22.04 LTS ou 24.04 LTS

---

## Passo 1: Instalação do Docker e Git no Ubuntu

Conecte ao seu servidor Ubuntu via SSH ou abra o terminal dele:

```bash
# 1. Atualiza os pacotes do sistema
sudo apt update && sudo apt upgrade -y

# 2. Instala o Git, Docker e o plugin Docker Compose
sudo apt install -y git docker.io docker-compose-v2

# 3. Habilita o serviço do Docker para iniciar com o sistema
sudo systemctl enable --now docker

# 4. Adiciona seu usuário ao grupo docker (permite rodar comandos docker sem sudo)
sudo usermod -aG docker $USER
newgrp docker
```

---

## Passo 2: Clonagem do Repositório

Clone o código diretamente do GitHub para a pasta `~/assdoc`:

```bash
# Clona o repositório
git clone https://github.com/jmarques029/Termos.git ~/assdoc

# Entra na pasta do projeto
cd ~/assdoc
```

---

## Passo 3: Permissões de Pastas de Dados

O sistema armazena os bancos de dados (`database/`) e os uploads de fotos (`uploads/`) em volumes persistidos no disco do servidor. Garanta as permissões para o container:

```bash
# Cria as pastas de persistência se ainda não existirem
mkdir -p database uploads/fotos uploads/devolucao

# Garante permissões totais de gravação
sudo chmod -R 777 database uploads
```

---

## Passo 4: Configuração das Variáveis (.env)

Crie o arquivo `.env` a partir do modelo de exemplo:

```bash
cp .env.example .env
nano .env
```

Ajuste as configurações no editor:

```dotenv
# URL base do sistema para links de assinatura e e-mails
BASE_URL=http://10.32.83.20:3000

# Caminho interno do banco de dados no container (mantenha como /app/database)
DB_PATH=/app/database

# Se for usar login com Microsoft na rede interna, informe o IP do seu servidor:
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=http://10.32.83.20:3000/api/auth/microsoft/callback

# Configurações de envio de e-mail (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=seuemail@empresa.com
SMTP_PASS=sua_senha_de_app
SMTP_FROM=TermoEP <seuemail@empresa.com>
```

> *Pressione `Ctrl + O` e depois `Enter` para salvar; pressione `Ctrl + X` para sair.*

---

## Passo 5: Inicialização com Docker Compose

Construa a imagem e inicie o container em segundo plano:

```bash
docker compose up -d --build
```

### Verificar se está rodando:
```bash
docker compose ps
```

### Ver logs em tempo real:
```bash
docker compose logs -f
```
*(Para sair da visualização dos logs, pressione `Ctrl + C`)*

---

## Passo 6: Liberação no Firewall e Acesso na Rede Interna

### 1. Libere a porta no firewall (`ufw`):
```bash
sudo ufw allow 3000/tcp
sudo ufw reload
```

### 2. Acesse no navegador:
Em qualquer computador da rede interna ou VPN, abra o navegador e acesse:
```
http://10.32.83.20:3000
```
* **Login inicial**: `admin@empresa.com`
* **Senha inicial**: `admin123`

---

## 🌟 Opcional: Acessar na Porta 80 (sem precisar digitar `:3000`)

Se quiser que os usuários acessem digitando apenas `http://192.168.1.150`:

1. Edite o `docker-compose.yml`:
   ```bash
   nano docker-compose.yml
   ```
2. Mude `ports:` de `"3000:3000"` para `"80:3000"`.
3. Libere a porta 80 no firewall:
   ```bash
   sudo ufw allow 80/tcp
   ```
4. Reinicie o container:
   ```bash
   docker compose up -d
   ```

---

## Como Atualizar o Sistema (Git Pull)

Sempre que você fizer alterações no código no Windows e der `git push`, para atualizar o servidor Ubuntu basta executar:

```bash
cd ~/assdoc

# 1. Baixa as atualizações do GitHub
git pull origin main

# 2. Reconstrói e reinicia o container com o novo código
docker compose up -d --build
```
> 💡 **Nota**: Seus dados de termos, usuários e fotos cadastradas não serão apagados na atualização, pois estão preservados nos volumes de `./database` e `./uploads`.

---

## Comandos Úteis e Backup

### 🔄 Reiniciar o sistema
```bash
cd ~/assdoc && docker compose restart
```

### 🛑 Parar o sistema
```bash
cd ~/assdoc && docker compose down
```

### 💾 Fazer Backup dos Dados
```bash
cd ~/assdoc
tar -czvf backup_assdoc_$(date +%Y%m%d_%H%M%S).tar.gz database/ uploads/
```
