from datetime import date, datetime, timedelta
from functools import wraps

from flask import Flask, jsonify, request

import db
from telegram_auth import AuthError, validate_init_data

app = Flask(__name__, static_folder="static", static_url_path="")

# Таблицы создаются один раз при старте приложения (безопасно —
# CREATE TABLE IF NOT EXISTS, ничего не перезатирает).
db.init_db()


@app.route("/")
def index():
    return app.send_static_file("index.html")


def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        init_data = request.headers.get("X-Telegram-Init-Data", "")
        try:
            request.tg_user = validate_init_data(init_data)
        except AuthError as e:
            return jsonify({"error": str(e)}), 403
        return f(*args, **kwargs)
    return wrapper


def to_json(rows):
    return db._rows_to_jsonable(rows)


def clean_str(value):
    """Обрезает пробелы и превращает пустую строку в None (для необязательных полей)."""
    if value is None:
        return None
    value = str(value).strip()
    return value or None


# ---------- Служебное ----------

@app.route("/api/me")
@require_auth
def me():
    return jsonify({"ok": True, "user": request.tg_user})


# ---------- Ученики ----------

@app.route("/api/students", methods=["GET"])
@require_auth
def list_students():
    return jsonify(to_json(db.get_students()))


@app.route("/api/students", methods=["POST"])
@require_auth
def create_student():
    body = request.get_json(force=True) or {}
    name = (body.get("name") or "").strip()
    try:
        price = float(body.get("price"))
    except (TypeError, ValueError):
        return jsonify({"error": "Некорректная цена"}), 400
    if not name:
        return jsonify({"error": "Укажите имя"}), 400
    student_id = db.add_student(
        name, price,
        meeting_link=clean_str(body.get("meeting_link")),
        board_link=clean_str(body.get("board_link")),
        comment=clean_str(body.get("comment")),
    )
    return jsonify(to_json([db.get_student(student_id)])[0]), 201


@app.route("/api/students/<int:student_id>", methods=["PATCH"])
@require_auth
def update_student(student_id):
    body = request.get_json(force=True) or {}
    if "name" in body:
        db.update_student_name(student_id, (body["name"] or "").strip())
    if "price" in body:
        try:
            db.update_student_price(student_id, float(body["price"]))
        except (TypeError, ValueError):
            return jsonify({"error": "Некорректная цена"}), 400
    if "meeting_link" in body:
        db.update_student_meeting_link(student_id, clean_str(body["meeting_link"]))
    if "board_link" in body:
        db.update_student_board_link(student_id, clean_str(body["board_link"]))
    if "comment" in body:
        db.update_student_comment(student_id, clean_str(body["comment"]))
    student = db.get_student(student_id)
    if not student:
        return jsonify({"error": "Ученик не найден"}), 404
    return jsonify(to_json([student])[0])


@app.route("/api/students/<int:student_id>", methods=["DELETE"])
@require_auth
def remove_student(student_id):
    db.delete_student(student_id)
    return jsonify({"ok": True})


# ---------- Расписание ----------

@app.route("/api/students/<int:student_id>/schedule", methods=["GET"])
@require_auth
def list_schedule(student_id):
    return jsonify(to_json(db.get_schedule_slots(student_id)))


@app.route("/api/students/<int:student_id>/schedule", methods=["POST"])
@require_auth
def add_schedule(student_id):
    body = request.get_json(force=True) or {}
    try:
        weekday = int(body.get("weekday"))
        t = datetime.strptime(body.get("time"), "%H:%M").time()
    except (TypeError, ValueError):
        return jsonify({"error": "Некорректный день или время"}), 400
    if not (0 <= weekday <= 6):
        return jsonify({"error": "День недели должен быть от 0 до 6"}), 400
    slot_id = db.add_schedule_slot(student_id, weekday, t)
    return jsonify({"id": slot_id}), 201


@app.route("/api/schedule/<int:slot_id>", methods=["DELETE"])
@require_auth
def remove_schedule(slot_id):
    db.delete_schedule_slot(slot_id)
    return jsonify({"ok": True})


# ---------- Уроки ----------

@app.route("/api/lessons", methods=["GET"])
@require_auth
def list_lessons():
    date_str = request.args.get("date")
    if not date_str:
        return jsonify({"error": "Укажите дату"}), 400
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"error": "Неверный формат даты"}), 400
    db.ensure_lessons_for_date(d)
    return jsonify(to_json(db.get_lessons_for_date(d)))


@app.route("/api/lessons", methods=["POST"])
@require_auth
def create_lesson():
    body = request.get_json(force=True) or {}
    try:
        student_id = int(body["student_id"])
        d = datetime.strptime(body["date"], "%Y-%m-%d").date()
        t = datetime.strptime(body["time"], "%H:%M").time()
    except (KeyError, ValueError, TypeError):
        return jsonify({"error": "Некорректные данные урока"}), 400
    lesson_id = db.add_or_get_lesson(student_id, d, t)
    return jsonify(to_json([db.get_lesson(lesson_id)])[0]), 201


@app.route("/api/lessons/<int:lesson_id>", methods=["PATCH"])
@require_auth
def update_lesson(lesson_id):
    body = request.get_json(force=True) or {}
    if "conducted" not in body and "comment" not in body:
        return jsonify({"error": "Нечего обновлять"}), 400
    if "conducted" in body:
        db.set_lesson_status(lesson_id, bool(body["conducted"]))
    if "comment" in body:
        db.set_lesson_comment(lesson_id, clean_str(body["comment"]))
    lesson = db.get_lesson(lesson_id)
    if not lesson:
        return jsonify({"error": "Урок не найден"}), 404
    return jsonify(to_json([lesson])[0])


@app.route("/api/lessons/<int:lesson_id>", methods=["DELETE"])
@require_auth
def remove_lesson(lesson_id):
    db.delete_lesson(lesson_id)
    return jsonify({"ok": True})


# ---------- Неделя ----------

@app.route("/api/week", methods=["GET"])
@require_auth
def week_overview():
    start_str = request.args.get("start")
    if start_str:
        try:
            start = datetime.strptime(start_str, "%Y-%m-%d").date()
        except ValueError:
            return jsonify({"error": "Неверный формат даты"}), 400
    else:
        today = date.today()
        start = today - timedelta(days=today.weekday())

    days = []
    for i in range(7):
        d = start + timedelta(days=i)
        db.ensure_lessons_for_date(d)
        lessons = db.get_lessons_for_date(d)
        days.append({
            "date": d.isoformat(),
            "weekday_name": db.WEEKDAY_NAMES[d.weekday()],
            "lessons": to_json(lessons),
        })
    return jsonify({"start": start.isoformat(), "days": days})


# ---------- Расчёт ----------

@app.route("/api/calc", methods=["GET"])
@require_auth
def calc():
    try:
        student_id = int(request.args["student_id"])
        date_from = datetime.strptime(request.args["date_from"], "%Y-%m-%d").date()
        date_to = datetime.strptime(request.args["date_to"], "%Y-%m-%d").date()
    except (KeyError, ValueError):
        return jsonify({"error": "Некорректные параметры"}), 400

    student = db.get_student(student_id)
    if not student:
        return jsonify({"error": "Ученик не найден"}), 404

    lessons = db.get_conducted_lessons(student_id, date_from, date_to)
    total = sum(float(l["price"]) for l in lessons)
    return jsonify({
        "student": to_json([student])[0],
        "lessons": to_json(lessons),
        "count": len(lessons),
        "total": total,
    })


# ---------- Выручка / налог по месяцу и оплата ----------

@app.route("/api/revenue", methods=["GET"])
@require_auth
def revenue_overview():
    try:
        year = int(request.args.get("year", date.today().year))
        month = int(request.args.get("month", date.today().month))
    except (TypeError, ValueError):
        return jsonify({"error": "Некорректные параметры"}), 400
    if not (1 <= month <= 12):
        return jsonify({"error": "Некорректный месяц"}), 400
    return jsonify(db.get_revenue_overview(year, month))


@app.route("/api/payments", methods=["PATCH"])
@require_auth
def set_payment():
    body = request.get_json(force=True) or {}
    try:
        student_id = int(body["student_id"])
        year = int(body["year"])
        month = int(body["month"])
        paid = bool(body["paid"])
    except (KeyError, ValueError, TypeError):
        return jsonify({"error": "Некорректные данные"}), 400
    db.set_payment(student_id, year, month, paid)
    return jsonify({"ok": True})


# ---------- Настройки ----------

@app.route("/api/settings", methods=["GET"])
@require_auth
def get_settings():
    return jsonify(db.get_settings())


@app.route("/api/settings", methods=["PATCH"])
@require_auth
def update_settings():
    body = request.get_json(force=True) or {}
    for key, value in body.items():
        db.set_setting(str(key), "" if value is None else str(value))
    return jsonify(db.get_settings())


# ---------- Резервная копия ----------

@app.route("/api/backup/export", methods=["GET"])
@require_auth
def backup_export():
    return jsonify(db.export_all())


@app.route("/api/backup/restore", methods=["POST"])
@require_auth
def backup_restore():
    data = request.get_json(force=True, silent=True)
    if not data:
        return jsonify({"error": "Не удалось прочитать файл"}), 400
    db.restore_all(data)
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
