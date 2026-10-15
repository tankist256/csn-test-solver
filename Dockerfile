FROM python:3.12-slim

WORKDIR /app

# Установка зависимостей
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Копируем файлы проекта
COPY parser.py .
COPY solver/ ./solver/

# Открываем порт для веб-интерфейса
EXPOSE 8080

# По умолчанию запускаем веб-сервер с базой вопросов и поиском
CMD ["python", "solver/serve.py"]
