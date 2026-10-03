# 🔥 ReForge

🌐 [🇷🇺 Русский](#русский) · [🇬🇧 English](#english)

## Русский

**Твоя VPS-инфраструктура — с проверяемым восстановлением.**

ReForge — self-hosted панель управления небольшой VPS-инфраструктурой. Подключи сервер по SSH, изучи его сервисы, создай зашифрованный backup и проверь восстановление на отдельном VPS.

![Панель ReForge](docs/screenshots/dashboard.png)

## 💡 Главная идея

Сообщение «backup успешно создан» ещё не доказывает, что сервисы можно восстановить.

ReForge сохраняет результаты реального восстановления: какие контейнеры запустились, прошли ли Docker healthcheck и отвечают ли приложения на HTTP-запросы. Каждая проверка привязана к конкретному backup и целевому серверу.

**🚀 DEPLOY → 🔎 DISCOVER → 🛡️ PROTECT → ♻️ RECOVER**

## 🧰 Что реализовано

| Направление | Возможности |
|---|---|
| 🚀 **DEPLOY** | Установка Docker/Compose, SSH-доступ только по ключу, UFW, fail2ban, BBR при поддержке ядра и проверка нового SSH-подключения |
| 🔎 **DISCOVER** | Инвентаризация Ubuntu, Docker/Compose-проектов, контейнеров, named volumes, портов и доменных меток; обнаружение PostgreSQL/MySQL |
| 🛡️ **PROTECT** | Согласованные cold snapshots volumes, файлы проектов и `.env`, дампы БД, фиксация образов по digest и шифрование AES-256-GCM |
| ☁️ **STORAGE** | Локальное хранение, зашифрованные копии в S3/SFTP и загрузка внешней копии при отсутствии локального файла |
| ♻️ **RECOVER** | Проверка отдельного пустого сервера, аутентификация архива, безопасная распаковка, восстановление Compose/volumes и сохранение результатов healthcheck |
| 🎛️ **CONTROL** | Web-панель, API с owner token, история заданий в SQLite, ежедневные backup по выбранному расписанию и Telegram-уведомления |

Проверка охватывает **выбранные Docker Compose-проекты**. Панель показывает фактический статус проверки и измеренное время восстановления. Проценты готовности и прогнозы времени не выдумываются.

## ⚡ Быстрый запуск

На машине ReForge нужны **Node.js 24+** и клиент **OpenSSH**. Дополнительных npm-зависимостей нет.

```sh
git clone https://github.com/BUSH-xanta/ReForge.git
cd ReForge
npm run setup
npm start
```

Открой **http://127.0.0.1:8787** и введи `REFORGE_TOKEN` из созданного `.env`.

Команда setup создаёт независимые ключи для авторизации и шифрования. Существующий `.env` она не перезаписывает.

На удалённых серверах нужны **Python 3** и доступ **root** либо **sudo без пароля**. Автоматическая настройка сейчас поддерживает **Ubuntu 24.04**.

## 🗺️ Первый recovery test

1. 🔑 Проверь SSH fingerprint сервера независимо и добавь его в `known_hosts`.
2. 🔌 Подключи исходный VPS, указав путь к SSH-ключу на машине ReForge.
3. 🔎 Запусти **Discover** и выбери Compose-проекты для backup.
4. 🛡️ Укажи HTTP-healthcheck целевого localhost и подтверди краткую остановку выбранных сервисов для cold snapshot.
5. ♻️ Подключи отдельный пустой Ubuntu VPS с Docker/Compose и запусти **Test Recovery**.
6. ✅ Изучи результаты в **Recovery tests** и журнал в **Activity**.

Восстановленные сервисы остаются на целевом VPS после проверки.

## 🔐 Ключи и данные

- SSH-ключи остаются на машине ReForge; реестр хранит только пути к ним.
- Сохрани `REFORGE_BACKUP_KEY` отдельно: без него архивы не расшифровать.
- Сохраняй реестр SQLite вместе с ключом шифрования отдельно от внешних архивов.
- Полный recovery manifest находится внутри зашифрованного архива и содержит чувствительную Compose-конфигурацию.
- Для удалённого доступа к панели используй SSH-туннель или HTTPS reverse proxy.

## 📦 Текущие границы

Поддерживаются обычные local named volumes и файлы внутри выбранного проекта. Внешние bind mounts, external volumes/networks, anonymous volumes, симлинки, специальные файлы и неопубликованные локальные образы отклоняются.

Host-сервисы, DNS и внешние managed databases не восстанавливаются.

| Ограничение | Значение |
|---|---|
| Локальные / SFTP-архивы | До 20 GiB |
| S3 single-object upload | До 5 GiB |
| Процессы control plane для одного реестра | Один |
| Автоматическое удаление старых backup | Пока не реализовано |
| Создание и удаление VPS для recovery test | Выполняет оператор |

## 🧪 Проверки и статус

```sh
npm test
npm run check
python -m unittest discover -s test -p 'test_*.py'
```

Тесты покрывают авторизацию API, сохранение данных, запрет параллельных операций, расписание, шифрование и повреждение архивов, пример подписи AWS, безопасную распаковку, отказ от восстановления на исходный сервер и перезапуск сервисов после ошибки snapshot. CI также настроен на сборку Docker-образа.

**🚧 Это начальная реализация.** Панель проверена локально. Полный цикл на двух реальных VPS, live S3/SFTP-передача и Telegram-доставка ещё требуют интеграционного прогона с инфраструктурой. Восстановление production пока не доказано.

## 📚 Документация

[Инструкция оператора на английском](docs/operations.md) — настройка, Docker-запуск, хранение, расписание, ограничения и восстановление.

---

## English

**Your VPS infrastructure — with verifiable recovery.**

ReForge is a self-hosted control plane for small VPS infrastructure. Connect a server over SSH, discover its services, create an encrypted backup, and test recovery on a separate VPS.

![ReForge dashboard](docs/screenshots/dashboard.png)

## 💡 The idea

“Backup completed successfully” does not prove your services can be restored.

ReForge records evidence from an actual recovery: which containers started, whether Docker healthchecks passed, and whether applications respond to HTTP requests. Every test is tied to a specific backup and destination server.

**🚀 DEPLOY → 🔎 DISCOVER → 🛡️ PROTECT → ♻️ RECOVER**

## 🧰 What is implemented

| Direction | Features |
|---|---|
| 🚀 **DEPLOY** | Docker/Compose installation, SSH key-only access, UFW, fail2ban, BBR when supported by the kernel, and a fresh SSH connection check |
| 🔎 **DISCOVER** | Ubuntu inventory, Docker/Compose projects, containers, named volumes, ports and domain labels; PostgreSQL/MySQL detection |
| 🛡️ **PROTECT** | Consistent cold volume snapshots, project files and `.env`, database dumps, image digest pins, and AES-256-GCM encryption |
| ☁️ **STORAGE** | Local archives, encrypted S3/SFTP mirrors, and remote retrieval when the local file is missing |
| ♻️ **RECOVER** | Separate empty-target enforcement, archive authentication, safe extraction, Compose/volume restoration, and healthcheck evidence |
| 🎛️ **CONTROL** | Web dashboard, owner-token API, SQLite job history, opt-in daily backups, and Telegram notifications |

Tests cover **selected Docker Compose projects**. The dashboard shows actual test results and measured recovery duration. It does not fabricate readiness percentages or time estimates.

## ⚡ Quick start

The control-plane host needs **Node.js 24+** and an **OpenSSH** client. There are no additional npm dependencies.

```sh
git clone https://github.com/BUSH-xanta/ReForge.git
cd ReForge
npm run setup
npm start
```

Open **http://127.0.0.1:8787** and enter `REFORGE_TOKEN` from the generated `.env`.

Setup generates independent authentication and encryption keys. It never overwrites an existing `.env`.

Remote servers require **Python 3** and **root** or **passwordless sudo**. Automatic provisioning currently supports **Ubuntu 24.04**.

## 🗺️ Your first recovery test

1. 🔑 Independently verify the server's SSH fingerprint and add it to `known_hosts`.
2. 🔌 Connect the source VPS using the SSH key path on the control-plane host.
3. 🔎 Run **Discover** and select Compose projects for the backup.
4. 🛡️ Define target-local HTTP healthchecks and acknowledge brief service downtime for a cold snapshot.
5. ♻️ Connect a separate empty Ubuntu VPS with Docker/Compose and run **Test Recovery**.
6. ✅ Review the results in **Recovery tests** and the job log in **Activity**.

Restored services remain on the destination VPS after the test.

## 🔐 Keys and data

- SSH private keys stay on the control-plane host; the registry stores only their paths.
- Save `REFORGE_BACKUP_KEY` separately: losing it makes archives unrecoverable.
- Preserve the SQLite registry and encryption key separately from external archives.
- The full recovery manifest lives inside the encrypted archive and contains sensitive rendered Compose configuration.
- Use an SSH tunnel or an HTTPS reverse proxy for remote dashboard access.

## 📦 Current scope

Snapshots support default local named volumes and project-local files. External bind mounts, external volumes/networks, anonymous volumes, symlinks, special files, and unpublished local images are rejected.

Host services, DNS, and external managed databases are not restored.

| Limit | Value |
|---|---|
| Local / SFTP archives | Up to 20 GiB |
| S3 single-object upload | Up to 5 GiB |
| Control-plane processes per registry | One |
| Automatic backup retention deletion | Not implemented yet |
| Recovery VPS creation and teardown | Operator-managed |

## 🧪 Validation and status

```sh
npm test
npm run check
python -m unittest discover -s test -p 'test_*.py'
```

Tests cover API authentication, persistence, operation concurrency, scheduling, encryption and tampering, the AWS signing example, safe extraction, source-target refusal, and service restart after snapshot failure. CI is also configured to build the Docker image.

**🚧 This is an initial implementation.** The dashboard is checked locally. A full run on two real VPS instances, live S3/SFTP transfers, and Telegram delivery still need an infrastructure integration run. Production recovery has not yet been demonstrated.

## 📚 Documentation

[Operator guide](docs/operations.md) — configuration, Docker deployment, storage, scheduling, coverage, and recovery details.
