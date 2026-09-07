-- Схема базы данных для бота-репетитора
-- Выполняется автоматически при старте бота (см. db.py -> init_db()),
-- но можно запустить и вручную в консоли Postgres на Render.

CREATE TABLE IF NOT EXISTS tb_students (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

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
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (student_id, lesson_date, lesson_time)
);

CREATE INDEX IF NOT EXISTS idx_lessons_date ON tb_lessons (lesson_date);
CREATE INDEX IF NOT EXISTS idx_schedule_student ON tb_schedule_slots (student_id);
