FROM node:20-alpine

# Define timezone para horário de Brasília
RUN apk add --no-cache tzdata
ENV TZ=America/Sao_Paulo

WORKDIR /app

# Copia manifestos de pacotes
COPY package*.json ./

# Instala apenas dependências de produção
RUN npm install --omit=dev

# Copia o restante da aplicação
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
