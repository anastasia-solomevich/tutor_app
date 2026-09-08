"""
Все обращения к базе данных живут здесь. Остальной код бота
не пишет SQL напрямую — только вызывает эти функции.
"""
from contextlib import contextmanager
from datetime import date, time as dt_time
from decimal import Decimal

import psycopg2
import psycopg2.extras

from config import DATABASE_URL

WEEKDAY_NAMES = [
    "Понедельник", "Вторник", "Среда", "Четверг",
    "Пятница", "Суббота", "Воскресенье",
]


@contextmanager
def get_conn():
    conn = psycopg2.connect(DATABASE_URL, sslmode="require")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Создаёт таблицы, если их ещё нет. Вызывается один раз при старте бота."""
    with open("schema.sql", "r", encoding="utf-8") as f:
        schema = f.read()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(schema)


# ---------- Ученики ----------

def add_student(name: str, price: float, meeting_link: str = None,
                 board_link: str = None, comment: str = None) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tb_students (name, price, meeting_link, board_link, comment)
                VALUES (%s, %s, %s, %s, %s) RETURNING id
                """,
                (name, price, meeting_link, board_link, comment),
            )
            return cur.fetchone()[0]


def get_students(active_only: bool = True):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if active_only:
                cur.execute("SELECT * FROM tb_students WHERE is_active = TRUE ORDER BY name")
            else:
                cur.execute("SELECT * FROM tb_students ORDER BY name")
            return cur.fetchall()


def get_student(student_id: int):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM tb_students WHERE id = %s", (student_id,))
            return cur.fetchone()


def update_student_name(student_id: int, name: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE tb_students SET name = %s WHERE id = %s", (name, student_id))


def update_student_price(student_id: int, price: float):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE tb_students SET price = %s WHERE id = %s", (price, student_id))


def update_student_meeting_link(student_id: int, meeting_link: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE tb_students SET meeting_link = %s WHERE id = %s", (meeting_link, student_id))


def update_student_board_link(student_id: int, board_link: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE tb_students SET board_link = %s WHERE id = %s", (board_link, student_id))


def update_student_comment(student_id: int, comment: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE tb_students SET comment = %s WHERE id = %s", (comment, student_id))


def delete_student(student_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM tb_students WHERE id = %s", (student_id,))


# ---------- Расписание (регулярное, по дням недели) ----------

def add_schedule_slot(student_id: int, weekday: int, lesson_time: dt_time) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO tb_schedule_slots (student_id, weekday, lesson_time) "
                "VALUES (%s, %s, %s) RETURNING id",
                (student_id, weekday, lesson_time),
            )
            return cur.fetchone()[0]


def get_schedule_slots(student_id: int):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM tb_schedule_slots WHERE student_id = %s "
                "ORDER BY weekday, lesson_time",
                (student_id,),
            )
            return cur.fetchall()


def delete_schedule_slot(slot_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM tb_schedule_slots WHERE id = %s", (slot_id,))


# ---------- Уроки ----------

def ensure_lessons_for_date(target_date: date):
    """Если на target_date есть уроки по регулярному расписанию, но в таблице
    tb_lessons их ещё нет — создаёт их (со снимком текущей цены ученика)."""
    weekday = target_date.weekday()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT ss.student_id, ss.lesson_time, s.price
                FROM tb_schedule_slots ss
                JOIN tb_students s ON s.id = ss.student_id
                WHERE ss.weekday = %s AND s.is_active = TRUE
                """,
                (weekday,),
            )
            slots = cur.fetchall()
            for student_id, lesson_time, price in slots:
                cur.execute(
                    """
                    INSERT INTO tb_lessons (student_id, lesson_date, lesson_time, price)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (student_id, lesson_date, lesson_time) DO NOTHING
                    """,
                    (student_id, target_date, lesson_time, price),
                )


def get_lessons_for_date(target_date: date):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT l.*, s.name AS student_name
                FROM tb_lessons l
                JOIN tb_students s ON s.id = l.student_id
                WHERE l.lesson_date = %s
                ORDER BY l.lesson_time
                """,
                (target_date,),
            )
            return cur.fetchall()


def add_manual_lesson(student_id: int, lesson_date: date, lesson_time: dt_time) -> int:
    student = get_student(student_id)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tb_lessons (student_id, lesson_date, lesson_time, price)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (student_id, lesson_date, lesson_time) DO NOTHING
                RETURNING id
                """,
                (student_id, lesson_date, lesson_time, student["price"]),
            )
            row = cur.fetchone()
            return row[0] if row else None


def add_or_get_lesson(student_id: int, lesson_date: date, lesson_time: dt_time) -> int:
    """Для урока "вне расписания": создаёт урок на указанные дату/время,
    а если такой урок уже существует (например, был создан из регулярного
    расписания) — просто возвращает его id, чтобы можно было отметить статус."""
    student = get_student(student_id)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tb_lessons (student_id, lesson_date, lesson_time, price)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (student_id, lesson_date, lesson_time)
                DO UPDATE SET student_id = EXCLUDED.student_id
                RETURNING id
                """,
                (student_id, lesson_date, lesson_time, student["price"]),
            )
            return cur.fetchone()[0]


def set_lesson_status(lesson_id: int, conducted: bool):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE tb_lessons SET conducted = %s WHERE id = %s",
                (conducted, lesson_id),
            )


def set_lesson_comment(lesson_id: int, comment: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE tb_lessons SET comment = %s WHERE id = %s",
                (comment, lesson_id),
            )


def delete_lesson(lesson_id: int):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM tb_lessons WHERE id = %s", (lesson_id,))


def get_lesson(lesson_id: int):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT l.*, s.name AS student_name
                FROM tb_lessons l JOIN tb_students s ON s.id = l.student_id
                WHERE l.id = %s
                """,
                (lesson_id,),
            )
            return cur.fetchone()


def get_conducted_lessons(student_id: int, date_from: date, date_to: date):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT lesson_date, lesson_time, price
                FROM tb_lessons
                WHERE student_id = %s AND conducted = TRUE
                  AND lesson_date BETWEEN %s AND %s
                ORDER BY lesson_date, lesson_time
                """,
                (student_id, date_from, date_to),
            )
            return cur.fetchall()


# ---------- Выручка и налог по месяцу ----------

def get_month_lessons(year: int, month: int):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT l.student_id, s.name AS student_name, l.price, l.conducted
                FROM tb_lessons l
                JOIN tb_students s ON s.id = l.student_id
                WHERE EXTRACT(YEAR FROM l.lesson_date) = %s
                  AND EXTRACT(MONTH FROM l.lesson_date) = %s
                """,
                (year, month),
            )
            return cur.fetchall()


def get_revenue_overview(year: int, month: int) -> dict:
    """Считает по месяцу:
    - planned_total: сумма всех уроков, которые ещё не отмечены как
      "не проведён" (то есть либо ещё не отмечены, либо проведены) —
      это выручка, если всё запланированное состоится;
    - actual_total: сумма только фактически проведённых уроков;
    - налог 10% от каждой из этих сумм;
    а также разбивку по каждому ученику + отметку об оплате за месяц.
    """
    rows = get_month_lessons(year, month)
    planned_total = 0.0
    actual_total = 0.0
    per_student = {}
    for r in rows:
        price = float(r["price"])
        sid = r["student_id"]
        entry = per_student.setdefault(sid, {
            "student_id": sid,
            "student_name": r["student_name"],
            "planned": 0.0,
            "actual": 0.0,
        })
        if r["conducted"] is not False:
            planned_total += price
            entry["planned"] += price
        if r["conducted"] is True:
            actual_total += price
            entry["actual"] += price

    payments = get_payments_for_month(year, month)
    students = []
    for sid, entry in per_student.items():
        entry["paid"] = bool(payments.get(sid, False))
        students.append(entry)
    students.sort(key=lambda x: x["student_name"])

    return {
        "year": year,
        "month": month,
        "planned_total": round(planned_total, 2),
        "actual_total": round(actual_total, 2),
        "tax_planned": round(planned_total * 0.10, 2),
        "tax_actual": round(actual_total * 0.10, 2),
        "students": students,
    }


# ---------- Оплата за месяц ----------

def get_payments_for_month(year: int, month: int) -> dict:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT student_id, paid FROM tb_monthly_payments WHERE year = %s AND month = %s",
                (year, month),
            )
            return {student_id: paid for student_id, paid in cur.fetchall()}


def set_payment(student_id: int, year: int, month: int, paid: bool):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tb_monthly_payments (student_id, year, month, paid, updated_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (student_id, year, month)
                DO UPDATE SET paid = EXCLUDED.paid, updated_at = now()
                """,
                (student_id, year, month, paid),
            )


# ---------- Настройки ----------

def get_settings() -> dict:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT key, value FROM tb_settings")
            return {key: value for key, value in cur.fetchall()}


def set_setting(key: str, value: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO tb_settings (key, value) VALUES (%s, %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
                """,
                (key, value),
            )


# ---------- Резервное копирование ----------

def _rows_to_jsonable(rows):
    """Переводит значения Decimal/date/time в обычные строки, чтобы их можно
    было сохранить в JSON и потом собрать обратно."""
    result = []
    for row in rows:
        d = dict(row)
        for key, value in d.items():
            if isinstance(value, Decimal):
                d[key] = str(value)
            elif hasattr(value, "isoformat"):
                d[key] = value.isoformat()
        result.append(d)
    return result


def export_all() -> dict:
    """Выгружает всех учеников, расписание, уроки, отметки об оплате и
    настройки в обычный словарь, пригодный для json.dumps()."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM tb_students ORDER BY id")
            students = cur.fetchall()
            cur.execute("SELECT * FROM tb_schedule_slots ORDER BY id")
            slots = cur.fetchall()
            cur.execute("SELECT * FROM tb_lessons ORDER BY id")
            lessons = cur.fetchall()
            cur.execute("SELECT * FROM tb_monthly_payments ORDER BY id")
            payments = cur.fetchall()
            cur.execute("SELECT * FROM tb_settings ORDER BY key")
            settings = cur.fetchall()

    return {
        "students": _rows_to_jsonable(students),
        "schedule_slots": _rows_to_jsonable(slots),
        "lessons": _rows_to_jsonable(lessons),
        "monthly_payments": _rows_to_jsonable(payments),
        "settings": _rows_to_jsonable(settings),
    }


def restore_all(data: dict):
    """Полностью заменяет данные в базе данными из резервной копии
    (результата export_all(), прочитанного из JSON-файла).
    ВНИМАНИЕ: удаляет всё, что было в таблицах бота, перед восстановлением.
    Совместимо и со старыми копиями (без ссылок/комментариев/оплат/настроек) —
    недостающие поля просто заполняются пустыми значениями."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "TRUNCATE tb_monthly_payments, tb_lessons, tb_schedule_slots, "
                "tb_students RESTART IDENTITY CASCADE"
            )
            cur.execute("DELETE FROM tb_settings")

            for s in data.get("students", []):
                cur.execute(
                    """
                    INSERT INTO tb_students (id, name, price, is_active, meeting_link, board_link, comment, created_at)
                    VALUES (%(id)s, %(name)s, %(price)s, %(is_active)s, %(meeting_link)s, %(board_link)s, %(comment)s, %(created_at)s)
                    """,
                    {
                        "id": s.get("id"),
                        "name": s.get("name"),
                        "price": s.get("price"),
                        "is_active": s.get("is_active", True),
                        "meeting_link": s.get("meeting_link"),
                        "board_link": s.get("board_link"),
                        "comment": s.get("comment"),
                        "created_at": s.get("created_at"),
                    },
                )
            for sl in data.get("schedule_slots", []):
                cur.execute(
                    """
                    INSERT INTO tb_schedule_slots (id, student_id, weekday, lesson_time)
                    VALUES (%(id)s, %(student_id)s, %(weekday)s, %(lesson_time)s)
                    """,
                    sl,
                )
            for l in data.get("lessons", []):
                cur.execute(
                    """
                    INSERT INTO tb_lessons (id, student_id, lesson_date, lesson_time, price, conducted, comment, created_at)
                    VALUES (%(id)s, %(student_id)s, %(lesson_date)s, %(lesson_time)s, %(price)s, %(conducted)s, %(comment)s, %(created_at)s)
                    """,
                    {"comment": None, **l},
                )
            for p in data.get("monthly_payments", []):
                cur.execute(
                    """
                    INSERT INTO tb_monthly_payments (id, student_id, year, month, paid, updated_at)
                    VALUES (%(id)s, %(student_id)s, %(year)s, %(month)s, %(paid)s, %(updated_at)s)
                    """,
                    p,
                )
            for kv in data.get("settings", []):
                cur.execute(
                    "INSERT INTO tb_settings (key, value) VALUES (%(key)s, %(value)s)",
                    kv,
                )

            # Чтобы новые записи после восстановления не конфликтовали по id
            # со старыми, "переводим" счётчики автоинкремента вперёд.
            for table in ("tb_students", "tb_schedule_slots", "tb_lessons", "tb_monthly_payments"):
                cur.execute(
                    "SELECT setval(pg_get_serial_sequence(%s, 'id'), "
                    "COALESCE((SELECT MAX(id) FROM " + table + "), 1))",
                    (table,),
                )
