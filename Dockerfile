# Test merchant site — Node 20 (matches engines field).
FROM node:20-slim

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# App source.
COPY src ./src
COPY scripts ./scripts
COPY db ./db
COPY public ./public

# Images are downloaded by the scraper into ./images and served publicly.
# In compose this is a bind/volume mount so scraped files persist.
RUN mkdir -p images

EXPOSE 4000

CMD ["node", "src/server.js"]
