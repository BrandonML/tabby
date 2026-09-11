FROM node:22-alpine
WORKDIR /app
# package.json declares "type": "module" -- server/index.js and
# server/rescuegroups.js rely on that for import/export syntax to parse as
# ESM. Node 22 happens to auto-detect module syntax when no package.json is
# present at all, which is why this worked before without it, but that's an
# implicit, version-specific fallback -- copying the real package.json makes
# module resolution explicit and correct regardless of the Node version this
# image is ever rebased to.
COPY package.json ./package.json
COPY server ./server
EXPOSE 8787
CMD ["node", "server/index.js"]
