# Portable container image for the Labb POCT Control Tracker.
# Render uses the Node runtime via render.yaml, but this lets you run the app
# on any container host (Fly.io, Railway, a VPS, etc.).
FROM node:22-alpine

WORKDIR /app

# Install production dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source.
COPY . .

# Data is written here; mount a volume at /var/data to persist it.
ENV DATA_FILE=/var/data/poct.json \
    DB_FILE=/var/data/poct.db \
    NODE_ENV=production
RUN mkdir -p /var/data
VOLUME ["/var/data"]

EXPOSE 3000
CMD ["npm", "start"]
