# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies (using pnpm as seen in lockfile, but standard npm install works too if pnpm not enforced, 
# but better to use npm ci if lockfile is present. The user has pnpm-lock.yaml.
# I will check if pnpm is available or just use npm for simplicity as requested "create a dockerfile". 
# Usually if pnpm-lock is present, we should use pnpm.
# However, to avoid complexity if pnpm is not in the base image, I'll install it or just use npm if the user is okay with it.
# Wait, the user has pnpm-lock.yaml. I should probably use pnpm.
# Let's check if I can just use npm to keep it simple, or installing pnpm in the container.
# node:22-alpine comes with corepack enabled often, or I can enable it.
# Let's try to stick to npm for standard boilerplate unless I see strict pnpm usage.
# Actually, mixing package managers is bad. I should use pnpm if pnpm-lock.yaml exists.
# I will enable codecore pack or install pnpm.

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build

# Stage 2: Production
FROM node:22-alpine AS production

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "-r", "./dist/instrumentation.js", "dist/main"]
