FROM node:22-slim AS frontend

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY solver/index.html solver/style.css ./solver/
COPY solver/src ./solver/src
COPY vite.config.js vite.standalone.config.js ./
COPY scripts ./scripts
RUN npm run build:web

FROM python:3.12-slim

WORKDIR /app
ENV CSN_FRONTEND_BUILD_DIR=/app/web-build

# Install dependencies.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the project files.
COPY parser.py .
COPY solver/ ./solver/
COPY --from=frontend /build/solver/dist/ /app/web-build/

# Expose the website port.
EXPOSE 8080

# Start the web server with the question bank and search.
CMD ["python", "solver/serve.py"]
