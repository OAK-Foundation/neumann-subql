FROM node:20

WORKDIR /app

COPY package.json package-lock.json .

RUN npm i --ci

COPY . .

RUN npm run build

ENTRYPOINT ["node", "/app/dist/index.js"]
