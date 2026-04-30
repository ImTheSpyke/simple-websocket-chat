# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm install

# Copy source
COPY tsconfig.json ./
COPY src ./src
COPY public ./public


# Build the project
RUN npm run build

# ---- Production stage ----
FROM node:20-alpine

WORKDIR /app

# Only install production deps
COPY package*.json ./
RUN npm install --omit=dev

# Copy built output and public assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY config.json ./config.json

# Expose your app port (adjust if needed)
EXPOSE 3000

# Start the app
CMD ["node", "dist/index.js"]