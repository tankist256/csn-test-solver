FROM python:3.12-slim

WORKDIR /app

# Install dependencies.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the project files.
COPY parser.py .
COPY solver/ ./solver/

# Expose the website port.
EXPOSE 8080

# Start the web server with the question bank and search.
CMD ["python", "solver/serve.py"]
