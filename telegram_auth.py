"""
Telegram подписывает данные, которые передаёт открытому Mini App
(initData), секретом на основе токена бота. Проверяя эту подпись,
мы убеждаемся, что запрос действительно пришёл из Telegram, а не
от постороннего человека, который просто открыл наш сайт в браузере.

Подробности алгоритма: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
"""
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

from config import ALLOWED_USER_IDS, BOT_TOKEN


class AuthError(Exception):
    pass


def validate_init_data(init_data: str, max_age_seconds: int = 86400) -> dict:
    """Проверяет initData, присланную фронтендом. Возвращает данные
    пользователя Telegram (dict) или бросает AuthError."""
    if not init_data:
        raise AuthError("Нет данных авторизации Telegram.")

    parsed = dict(parse_qsl(init_data, strict_parsing=True))
    received_hash = parsed.pop("hash", None)
    if not received_hash:
        raise AuthError("Нет подписи в данных авторизации.")

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(computed_hash, received_hash):
        raise AuthError("Неверная подпись — запрос не из Telegram.")

    auth_date = int(parsed.get("auth_date", "0"))
    if time.time() - auth_date > max_age_seconds:
        raise AuthError("Сессия устарела, откройте приложение заново.")

    user = json.loads(parsed.get("user", "{}"))
    user_id = user.get("id")

    if ALLOWED_USER_IDS and user_id not in ALLOWED_USER_IDS:
        raise AuthError("У вас нет доступа к этому приложению.")

    return user
