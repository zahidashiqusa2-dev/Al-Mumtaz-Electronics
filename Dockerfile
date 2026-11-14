FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./

RUN npm install --omit=dev --legacy-peer-deps --no-audit --no-fund

COPY . .

RUN mkdir -p tmp data /app/data/sessions && chmod -R 777 tmp data /app/data

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "server.js"]
