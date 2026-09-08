-- Схема базы данных для бота-репетитора
-- Выполняется автоматически при старте бота (см. db.py -> init_db()),
-- но можно запустить и вручную в консоли Postgres на Render.

CREATE TABLE IF NOT EXISTS tb_students (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    meeting_link TEXT,
    board_link TEXT,
    comment TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Если таблица уже существовала из более старой версии бота — добавляем
-- недостающие столбцы. Ничего не удаляет и не перезатирает.
ALTER TABLE tb_students ADD COLUMN IF NOT EXISTS meeting_link TEXT;
ALTER TABLE tb_students ADD COLUMN IF NOT EXISTS board_link TEXT;
ALTER TABLE tb_students ADD COLUMN IF NOT EXISTS comment TEXT;

-- Регулярное расписание ученика (повторяется каждую неделю)
CREATE TABLE IF NOT EXISTS tb_schedule_slots (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES tb_students(id) ON DELETE CASCADE,
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = понедельник
    lesson_time TIME NOT NULL
);

-- Конкретные уроки (создаются из расписания автоматически или вручную)
CREATE TABLE IF NOT EXISTS tb_lessons (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES tb_students(id) ON DELETE CASCADE,
    lesson_date DATE NOT NULL,
    lesson_time TIME NOT NULL,
    price NUMERIC(10, 2) NOT NULL,   -- цена "снимается" на момент создания урока
    conducted BOOLEAN,                -- NULL = ещё не отмечен, TRUE/FALSE = отмечен
    comment TEXT,                     -- заметка к конкретному уроку
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (student_id, lesson_date, lesson_time)
);

ALTER TABLE tb_lessons ADD COLUMN IF NOT EXISTS comment TEXT;

CREATE INDEX IF NOT EXISTS idx_lessons_date ON tb_lessons (lesson_date);
CREATE INDEX IF NOT EXISTS idx_schedule_student ON tb_schedule_slots (student_id);

-- Отметка "оплатил ученик за месяц или нет" — по одной записи на
-- ученика и календарный месяц.
CREATE TABLE IF NOT EXISTS tb_monthly_payments (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES tb_students(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    paid BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (student_id, year, month)
);

-- Простые настройки приложения в формате ключ-значение (например, валюта).
CREATE TABLE IF NOT EXISTS tb_settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
