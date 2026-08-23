FROM node:22

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/mock/package.json apps/mock/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/vue-editor/package.json packages/vue-editor/package.json

RUN npm ci

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]
