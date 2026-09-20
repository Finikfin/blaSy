-- weekly_reviews хранил даты как TEXT, из-за чего сравнение period_from с
-- параметром типа date падало (operator does not exist: text = date).
-- Приводим колонки к DATE, как в остальных таблицах схемы.
ALTER TABLE weekly_reviews ALTER COLUMN period_from TYPE DATE USING period_from::date;
ALTER TABLE weekly_reviews ALTER COLUMN period_to TYPE DATE USING period_to::date;
