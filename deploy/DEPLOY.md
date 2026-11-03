# Деплой Gym Telegram Bot на Oracle Cloud (Always Free)

Покрокова інструкція для розгортання бота на безкоштовній Ubuntu-VM.
Дані (SQLite) зберігаються на диску VM і **не губляться** при перезапусках.

> Бот працює через long polling (вихідні запити до Telegram), тож **відкривати порти/файрвол не потрібно**.

---

## Крок 1. Створити VM в OCI Console

1. Увійди в [cloud.oracle.com](https://cloud.oracle.com).
2. Меню (☰) → **Compute → Instances → Create instance**.
3. Налаштування:
   - **Name:** `gym-bot`
   - **Image:** Canonical **Ubuntu 22.04** (або 24.04).
   - **Shape:** натисни **Change shape**:
     - Простіше: **Ampere (ARM) — VM.Standard.A1.Flex**, 1 OCPU / 6 GB (входить у Always Free).
     - Якщо ARM «out of capacity»: бери **VM.Standard.E2.1.Micro** (AMD, Always Free).
4. **SSH keys** — секція «Add SSH keys»:
   - Обери **Generate a key pair for me** і **завантаж приватний ключ** (`.key`) — він знадобиться для входу. Або встав свій публічний ключ.
5. **Create**. За 1–2 хв інстанс буде `RUNNING`. Запиши **Public IP address**.

---

## Крок 2. Підключитися по SSH

З локального комп'ютера (PowerShell):

```powershell
# дай ключу правильні права (один раз)
icacls "C:\шлях\до\ssh-key.key" /inheritance:r /grant:r "$($env:USERNAME):R"

ssh -i "C:\шлях\до\ssh-key.key" ubuntu@ПУБЛІЧНИЙ_IP
```

Користувач для Ubuntu-образу — **`ubuntu`**.

---

## Крок 3. Завантажити код на VM

### Варіант A — через GitHub (рекомендовано)
На локальній машині (один раз) залий проєкт у приватний репозиторій:

```powershell
git init
git add .
git commit -m "Gym telegram bot"
git branch -M main
git remote add origin https://github.com/ТВІЙ_ЮЗЕР/gym-bot.git
git push -u origin main
```

На VM:

```bash
sudo apt-get update -y && sudo apt-get install -y git
git clone https://github.com/ТВІЙ_ЮЗЕР/gym-bot.git
cd gym-bot
```

### Варіант B — скопіювати папку напряму (без GitHub)
З локальної машини (PowerShell), без `node_modules`:

```powershell
scp -i "C:\шлях\ssh-key.key" -r d:\GymApp ubuntu@ПУБЛІЧНИЙ_IP:~/gym-bot
```

> `.env` у `.gitignore`, тож при варіанті A він **не** зальється — створимо його на VM у кроці 4.

---

## Крок 4. Створити `.env` на VM

```bash
cd ~/gym-bot
cp .env.example .env
nano .env
```

Заповни щонайменше:

```env
BOT_TOKEN=твій_токен_від_BotFather
OWNER_TELEGRAM_ID=твій_telegram_id   # дізнатись: @userinfobot; інших бот ігнорує
GEMINI_API_KEY=твій_ключ_Gemini
GEMINI_MODEL=gemini-3.5-flash
DATABASE_URL="file:./dev.db"
TZ_NAME=Europe/Brussels
ENABLE_SCHEDULER=true
```

> `APP_URL` на VM **залиш порожнім** — self-ping не потрібен, VM не засинає.

Збережи: `Ctrl+O`, `Enter`, `Ctrl+X`.

---

## Крок 5. Запустити автоустановку

```bash
bash deploy/setup.sh
```

Скрипт сам:
- встановить Node.js 22 + pm2,
- поставить залежності, збілдить проєкт,
- застосує міграції БД і заповнить програму,
- запустить бота під **pm2** і налаштує **автозапуск після перезавантаження**.

---

## Mini App (застосунок у Telegram)

`setup.sh` ставить **cloudflared** і запускає quick tunnel під pm2 як `gym-tunnel` — він дає
HTTPS-адресу `*.trycloudflare.com` без відкриття портів. Бот сам читає цю адресу з метрик
cloudflared і ставить її на кнопку меню «Тренування» (а також команда `/app`).

Адреса тунелю змінюється після його рестарту — бот підхоплює нову протягом ~2 хв.

### Постійна адреса (Caddy + DuckDNS, безкоштовно)

Зараз бот живе на **https://s4meb0dygym.duckdns.org** (DuckDNS → 193.123.37.20),
запасна адреса — `193-123-37-20.sslip.io`. Обидві обслуговує один блок у Caddyfile:
`s4meb0dygym.duckdns.org, 193-123-37-20.sslip.io { reverse_proxy localhost:3000 }`.
Якщо зміниться IP VM — онови його на duckdns.org, сервер чіпати не треба.

Потрібна для синхронізації Apple Health / Fitbit через iOS Shortcuts, бо шорткат
має знати незмінну адресу.

1. OCI Console → Subnet → Security List → Ingress: TCP **80** і **443** з `0.0.0.0/0`.
2. Файрвол VM (Ubuntu-образи Oracle блокують усе, крім 22):
   ```bash
   sudo iptables -I INPUT 5 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo iptables -I INPUT 5 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo netfilter-persistent save
   ```
3. Caddy (сам отримує сертифікат Let's Encrypt), `/etc/caddy/Caddyfile`:
   ```
   193-123-37-20.sslip.io {
   	reverse_proxy localhost:3000
   }
   ```
4. У `.env`: `WEBAPP_URL=https://s4meb0dygym.duckdns.org/app/` і
   `APP_URL=https://s4meb0dygym.duckdns.org`, прибрати `TUNNEL_METRICS_URL`,
   потім `bash deploy/setup.sh` — тимчасовий тунель зупиниться сам.

Локальна розробка інтерфейсу: `BOT_DISABLED=true` + `WEBAPP_DEV_USER_ID=<id>` у `.env`,
`npm run dev`, і в другому терміналі `npm run dev:webapp` (http://localhost:5173/app/).

## Керування ботом

```bash
pm2 status            # статус
pm2 logs gym-bot      # живі логи
pm2 restart gym-bot   # перезапуск
pm2 stop gym-bot      # зупинити
```

## Автодеплой

На VM кожні 5 хв cron запускає `deploy/auto-update.sh`: якщо в `origin/main` є нові
коміти — `git pull` і `bash deploy/setup.sh`. Достатньо запушити в `main`.

```bash
(crontab -l 2>/dev/null | grep -v auto-update.sh; \
 echo "*/5 * * * * bash $HOME/gym-bot/deploy/auto-update.sh >> $HOME/gym-bot-deploy.log 2>&1") | crontab -
tail -f ~/gym-bot-deploy.log   # журнал деплоїв
```

## Оновлення після змін коду

```bash
cd ~/gym-bot
git pull
bash deploy/setup.sh
```

---

## Поради
- **Один інстанс бота**: коли бот працює на VM, **зупини локальний** `npm run dev`, інакше Telegram поверне `409 Conflict`.
- **Бекап даних**: щоденний бекап БД у Telegram уже вбудований; додатково можна копіювати `~/gym-bot/prisma/dev.db`.
- Якщо `bash deploy/setup.sh` лається на `\r` (CRLF) — виконай: `sed -i 's/\r$//' deploy/setup.sh` і запусти ще раз.
