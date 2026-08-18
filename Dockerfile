# Test merchant site — Node 20 (matches engines field).
#
# Two stages, because the storefront is now React and has to be compiled:
#   build   installs ALL dependencies (esbuild included) and produces
#           dist/ui.js (server render) + public/bundle.js (browser)
#   runtime installs production dependencies only and copies those artifacts in
#
# The result is that esbuild and its toolchain never ship in the deployed image,
# while the compiled UI does. Nothing has to be built on the server.

# ── build stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# Only what the build actually reads: the components and the build script.
COPY src ./src
COPY scripts/build.mjs ./scripts/build.mjs

RUN npm run build

# ── runtime stage ────────────────────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Production dependencies only — no esbuild, no build toolchain.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# App source.
COPY src ./src
COPY scripts ./scripts
COPY db ./db
COPY public ./public

# Compiled UI from the build stage. dist/ui.js is imported by the server at
# render time, bundle.js is served to the browser to hydrate.
COPY --from=build /app/dist ./dist
COPY --from=build /app/public/bundle.js ./public/bundle.js

# Images are downloaded by the scraper into ./images and served publicly.
# In compose this is a bind/volume mount so scraped files persist.
RUN mkdir -p images

# Run as the unprivileged `node` user that the base image already provides,
# rather than root. A container that is exposed to the internet should not be
# able to write to its own application code, and a defect in the app should not
# start life with root in the container.
#
# Ownership is set BEFORE dropping privileges: a named volume mounted over
# /app/images inherits the ownership of the image directory underneath it, so
# the scraper can still write images. `node` is uid 1000, which also matches the
# usual host user for the development bind mount.
RUN chown -R node:node /app
USER node

EXPOSE 4000

CMD ["node", "src/server.js"]
