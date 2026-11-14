FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./

RUN npm install --production --legacy-peer-deps

COPY . .

RUN mkdir -p /app/data/sessions

ENV NODE_ENV=production
ENV PORT=3000
ENV IS_RAILWAY_BACKEND=true
ENV RAILWAY_VOLUME_MOUNT_PATH=/app/data

EXPOSE 3000

CMD ["node", "server.js"]
