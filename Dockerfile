FROM node:22

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/mock/package.json apps/mock/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/rdf-io/package.json packages/rdf-io/package.json
COPY packages/profile-resolver/package.json packages/profile-resolver/package.json
COPY packages/semantic-access/package.json packages/semantic-access/package.json
COPY packages/layout-elk/package.json packages/layout-elk/package.json
COPY packages/profile-kit/package.json packages/profile-kit/package.json
COPY packages/presentation-tools/package.json packages/presentation-tools/package.json
COPY packages/host-conformance/package.json packages/host-conformance/package.json
COPY packages/agent-bridge/package.json packages/agent-bridge/package.json
COPY packages/vue-editor/package.json packages/vue-editor/package.json

RUN npm ci

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev"]
