FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache curl
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
