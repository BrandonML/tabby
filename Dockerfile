FROM node:22-alpine
WORKDIR /app
COPY server ./server
EXPOSE 8787
CMD ["node", "server/index.js"]
