import os

# Тот же токен бота, что и у tutor_bot — нужен, чтобы проверять,
# что запросы к приложению действительно приходят из Telegram
# (Telegram подписывает данные этим токеном).
BOT_TOKEN = os.environ["BOT_TOKEN"]

# Та же база данных, что использует tutor_bot.
DATABASE_URL = os.environ["DATABASE_URL"]

# Тот же список разрешённых Telegram user_id, что и у tutor_bot.
ALLOWED_USER_IDS = {
    int(x) for x in os.environ.get("ALLOWED_USER_IDS", "").split(",") if x.strip()
}
