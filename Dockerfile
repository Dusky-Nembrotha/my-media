# Build the browser bundle with the dev dependencies present...
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ...then ship only what the server needs to run.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4123
ENV MYMEDIA_DATA=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY samples ./samples
COPY --from=build /app/dist ./dist

# The SQLite file lives on the mounted volume, not in the image.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 4123
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4123)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
