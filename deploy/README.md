# Обновление сайта на Azure VM

Путь на VM: `/home/tankist256/csn-test-solver`. После отправки изменений в
`main` GitHub VM проверяет новую версию раз в две минуты и обновляет контейнер
`solver`. База `solver/questions.json`, `solver/questions.js` и `solver/media/`
остаётся на диске VM и не передаётся через Git.

## Однократная настройка

1. На VM сохраните резервную копию и подключите уже существующую папку к GitHub:

   ```bash
   cd /home/tankist256
   cp -a csn-test-solver "csn-test-solver.backup.$(date +%Y%m%d-%H%M%S)"
   cd csn-test-solver
   git init -b main
   git remote add origin https://github.com/tankist256/csn-test-solver.git
   git fetch origin main
   git reset --hard origin/main
   test -s solver/questions.json && test -d solver/media
   ```

   Код берётся из GitHub; база и медиа остаются на VM, потому что эти пути
   исключены из Git. Резервная копия нужна только на время первого обновления.

2. На VM установите сервис и таймер:

   ```bash
   chmod +x /home/tankist256/csn-test-solver/deploy/update-from-github.sh
   sudo install -m 644 /home/tankist256/csn-test-solver/deploy/csn-solver-update.service /etc/systemd/system/
   sudo install -m 644 /home/tankist256/csn-test-solver/deploy/csn-solver-update.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now csn-solver-update.timer
   ```

## Проверка

```bash
sudo systemctl start csn-solver-update.service
sudo journalctl -u csn-solver-update.service -n 80 --no-pager
curl -fsS http://127.0.0.1:8080/index.html >/dev/null
```

Скрипт применяет только обновления `main` без конфликтов, собирает контейнер,
проверяет ответ сайта и при ошибке возвращает предыдущую версию кода. Если на VM
изменены отслеживаемые Git файлы, обновление останавливается, чтобы их не потерять.
