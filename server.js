const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());

// ТОКЕН БОТА И ВАШ CHAT ID
const TELEGRAM_TOKEN = '8604175231:AAG4Mda6Aq__x8YUtT9-6FVDpzKvfkiGqgA';
const ADMIN_CHAT_ID = '830748573';

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// База данных в памяти
// closedDays: списки полностью закрытых дат ['2026-10-30']
// customSlots: явное переопределение занятых или открытых слотов { '2026-10-30': ['14:00'] }
// openWeekdayMorning: даты будних дней, где ДО 18:00 открыта запись { '2026-10-30': true }
const db = {
    closedDays: new Set(),
    busySlots: {},         // date -> Array of busy slots
    openWeekdayMorning: {} // date -> boolean (открыто ли до 18:00 в будни)
};

// Генерация списка слотов в зависимости от дня недели
function generateBaseSlots(dateStr) {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay(); // 0 = Воскресенье, 6 = Суббота

    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    const slots = [];

    if (isWeekend) {
        // Выходные: с 06:00 до 21:00 с шагом 1 час
        for (let hour = 6; hour <= 21; hour++) {
            const hStr = hour < 10 ? `0${hour}` : `${hour}`;
            slots.push(`${hStr}:00`);
        }
    } else {
        // Будни:
        // Проверяем, открыли ли мы утро до 18:00 вручную через бота
        const morningOpened = db.openWeekdayMorning[dateStr] || false;

        if (morningOpened) {
            // Если утро открыто — с 06:00 до 18:00 с шагом 1 час
            for (let hour = 6; hour < 18; hour++) {
                const hStr = hour < 10 ? `0${hour}` : `${hour}`;
                slots.push(`${hStr}:00`);
            }
        }

        // Вечер после 18:00 в будни всегда доступен (с шагом 1 час: 18:00, 19:00, 20:00, 21:00)
        for (let hour = 18; hour <= 21; hour++) {
            slots.push(`${hour}:00`);
        }
    }

    return slots;
}

// API: Получение доступных слотов для сайта
app.get('/api/available-slots', (req, res) => {
    const { date } = req.query;

    if (!date) {
        return res.status(400).json({ error: 'Не указана дата' });
    }

    // Если день полностью закрыт администратором
    if (db.closedDays.has(date)) {
        return res.json({ available: false, slots: [] });
    }

    const baseSlots = generateBaseSlots(date);
    const busy = db.busySlots[date] || [];

    // Оставляем только те слоты, которые не заблокированы
    const availableSlots = baseSlots.filter(slot => !busy.includes(slot));

    res.json({
        available: true,
        slots: availableSlots
    });
});

// API: Запись с сайта
app.post('/api/book', async (req, res) => {
    const { name, phone, service, date, time, note } = req.body;

    if (!name || !phone || !date || !time) {
        return res.status(400).json({ success: false, message: 'Заполните все обязательные поля' });
    }

    // Вносим слот в список занятых
    if (!db.busySlots[date]) {
        db.busySlots[date] = [];
    }
    db.busySlots[date].push(time);

    // Уведомление в Telegram
    const message = `🌸 <b>НОВАЯ ЗАПИСЬ С САЙТА!</b>\n\n` +
        `👤 <b>Имя:</b> ${name}\n` +
        `📞 <b>Телефон:</b> ${phone}\n` +
        `💆‍♀️ <b>Услуга:</b> ${service || 'Не указана'}\n` +
        `📅 <b>Дата:</b> ${date}\n` +
        `⏰ <b>Время:</b> ${time}\n` +
        (note ? `💬 <b>Пожелания:</b> ${note}` : '');

    try {
        await bot.sendMessage(ADMIN_CHAT_ID, message, { parse_mode: 'HTML' });
        res.json({ success: true });
    } catch (err) {
        console.error('Ошибка отправки в Telegram:', err);
        res.json({ success: true, warning: 'Запись сохранена, но уведомление не отправлено.' });
    }
});

// TELEGRAM БОТ: КНОПКИ И МЕНЮ УПРАВЛЕНИЯ
const mainMenu = {
    reply_markup: {
        keyboard: [
            [{ text: '☀️ Открыть утро в будни' }, { text: '🌙 Закрыть утро в будни' }],
            [{ text: '🚫 Закрыть день' }, { text: '✅ Открыть день' }],
            [{ text: '🔒 Занять время' }, { text: '🔓 Освободить время' }],
            [{ text: '📊 Текущий статус' }]
        ],
        resize_keyboard: true
    }
};

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 
        `🌸 <b>Панель управления студией «Не кактус»</b>\n\n` +
        `<b>Правила расписания по умолчанию:</b>\n` +
        `• <b>Будни:</b> Запись до 18:00 закрыта (можно открыть кнопкой). После 18:00 — открыта с шагом в 1 час (18:00, 19:00, 20:00, 21:00).\n` +
        `• <b>Выходные:</b> Открыты с 06:00 до 21:00 с шагом 1 час.\n\n` +
        `Используйте меню ниже или быстрые команды:`, 
        { parse_mode: 'HTML', ...mainMenu }
    );
});

// Обработка текстовых кнопок меню
bot.on('message', (msg) => {
    const text = msg.text;
    const chatId = msg.chat.id;

    if (text === '☀️ Открыть утро в будни') {
        bot.sendMessage(chatId, 'Пришлите команду формата:\n<code>/openmorning ГГГГ-ММ-ДД</code>\n\nПример: <code>/openmorning 2026-10-30</code>', { parse_mode: 'HTML' });
    } else if (text === '🌙 Закрыть утро в будни') {
        bot.sendMessage(chatId, 'Пришлите команду формата:\n<code>/closemorning ГГГГ-ММ-ДД</code>\n\nПример: <code>/closemorning 2026-10-30</code>', { parse_mode: 'HTML' });
    } else if (text === '🚫 Закрыть день') {
        bot.sendMessage(chatId, 'Пришлите дату в формате:\n<code>/off ГГГГ-ММ-ДД</code>\n\nПример: <code>/off 2026-10-30</code>', { parse_mode: 'HTML' });
    } else if (text === '✅ Открыть день') {
        bot.sendMessage(chatId, 'Пришлите дату в формате:\n<code>/on ГГГГ-ММ-ДД</code>\n\nПример: <code>/on 2026-10-30</code>', { parse_mode: 'HTML' });
    } else if (text === '🔒 Занять время') {
        bot.sendMessage(chatId, 'Пришлите дату и время в формате:\n<code>/busy ГГГГ-ММ-ДД ЧЧ:ММ</code>\n\nПример: <code>/busy 2026-10-30 14:00</code>', { parse_mode: 'HTML' });
    } else if (text === '🔓 Освободить время') {
        bot.sendMessage(chatId, 'Пришлите дату и время в формате:\n<code>/free ГГГГ-ММ-ДД ЧЧ:ММ</code>\n\nПример: <code>/free 2026-10-30 14:00</code>', { parse_mode: 'HTML' });
    } else if (text === '📊 Текущий статус') {
        let status = '📋 <b>ТЕКУЩИЙ СТАТУС РАСПИСАНИЯ:</b>\n\n';
        
        status += '<b>Открытые утра в будни:</b>\n';
        const morningDates = Object.keys(db.openWeekdayMorning).filter(d => db.openWeekdayMorning[d]);
        status += morningDates.length ? morningDates.join(', ') + '\n' : 'Нет\n';

        status += '\n<b>Полностью закрытые дни:</b>\n';
        status += db.closedDays.size ? Array.from(db.closedDays).join(', ') + '\n' : 'Нет\n';

        status += '\n<b>Занятые/заблокированные слоты:</b>\n';
        const busyKeys = Object.keys(db.busySlots).filter(k => db.busySlots[k].length > 0);
        if (busyKeys.length) {
            busyKeys.forEach(k => {
                status += `• <b>${k}:</b> ${db.busySlots[k].join(', ')}\n`;
            });
        } else {
            status += 'Нет\n';
        }

        bot.sendMessage(chatId, status, { parse_mode: 'HTML' });
    }
});

// Команды для управления утренними слотами в будни
bot.onText(/\/openmorning (.+)/, (msg, match) => {
    const date = match[1].trim();
    db.openWeekdayMorning[date] = true;
    bot.sendMessage(msg.chat.id, `☀️ Утреннее время в будний день <b>${date}</b> (до 18:00) теперь <b>ОТКРЫТО</b> на сайте!`, { parse_mode: 'HTML' });
});

bot.onText(/\/closemorning (.+)/, (msg, match) => {
    const date = match[1].trim();
    db.openWeekdayMorning[date] = false;
    bot.sendMessage(msg.chat.id, `🌙 Утреннее время в будний день <b>${date}</b> (до 18:00) снова <b>ЗАКРЫТО</b> на сайте.`, { parse_mode: 'HTML' });
});

// Команды управления днями
bot.onText(/\/off (.+)/, (msg, match) => {
    const date = match[1].trim();
    db.closedDays.add(date);
    bot.sendMessage(msg.chat.id, `⛔ День <b>${date}</b> полностью <b>ЗАКРЫТ</b> для записи.`, { parse_mode: 'HTML' });
});

bot.onText(/\/on (.+)/, (msg, match) => {
    const date = match[1].trim();
    db.closedDays.delete(date);
    bot.sendMessage(msg.chat.id, `✅ День <b>${date}</b> снова <b>ОТКРЫТ</b> для записи.`, { parse_mode: 'HTML' });
});

// Команды управления слотами
bot.onText(/\/busy (.+) (.+)/, (msg, match) => {
    const date = match[1].trim();
    const time = match[2].trim();
    if (!db.busySlots[date]) db.busySlots[date] = [];
    if (!db.busySlots[date].includes(time)) db.busySlots[date].push(time);
    bot.sendMessage(msg.chat.id, `🔒 Слот <b>${time}</b> на <b>${date}</b> заблокирован.`, { parse_mode: 'HTML' });
});

bot.onText(/\/free (.+) (.+)/, (msg, match) => {
    const date = match[1].trim();
    const time = match[2].trim();
    if (db.busySlots[date]) {
        db.busySlots[date] = db.busySlots[date].filter(t => t !== time);
    }
    bot.sendMessage(msg.chat.id, `🔓 Слот <b>${time}</b> на <b>${date}</b> снова свободен.`, { parse_mode: 'HTML' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
