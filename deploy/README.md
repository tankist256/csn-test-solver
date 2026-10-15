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

## Пополнение базы, когда CSDD не отвечает с Azure

На 16 октября 2026 года тестовый узел `csnt2.csdd.lv` отвечает с домашнего
компьютера, но соединение с Azure VM истекает по тайм-ауту. Сборщик на VM теперь
останавливается после первой сетевой ошибки и показывает её в окне сайта вместо
десятков безрезультатных повторов. Для обновления публичной базы запустите на
компьютере с доступом к CSDD:

```bash
cd /home/tankist256/Documents/CSN
./deploy/collect-and-sync.sh 5
```

Число проходов — от 1 до 50. Скрипт собирает вопросы локально, передаёт на VM
только недостающие медиа, затем проверяет и заменяет `questions.json` и
`questions.js`. На VM сохраняется резервная копия прежней базы в
`/home/tankist256/csn-data-backups/`. Для передачи уже собранной локальной базы
без нового прохода используется `./deploy/collect-and-sync.sh --sync-only`.
После завершения обновите страницу сайта. Компьютер должен быть включён во
время сбора и синхронизации; сайт Azure продолжает работать независимо от него.
