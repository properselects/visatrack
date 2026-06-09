FROM mcr.microsoft.com/playwright:v1.49.1-jammy

RUN npm install -g pnpm@9 --no-fund --no-audit

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/visatrack/package.json ./apps/visatrack/

RUN pnpm install --frozen-lockfile

COPY apps/visatrack/ ./apps/visatrack/

RUN pnpm --filter visatrack build

ENV PORT=3000
EXPOSE 3000
CMD ["pnpm", "--filter", "visatrack", "start"]
