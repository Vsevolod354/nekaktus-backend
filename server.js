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
const db = {
    closedDays: new Set(),         // формат хранения YYYY-MM-DD
    busySlots: {},                 // YYYY-MM-DD -> Array of slots
    openWeekdayMorning: {}         // YYYY-MM-DD -> boolean
};

// Временное хранилище состояний для диалогов с админом (chatId -> действие)
const userStates = {};

// Функция конвертации из ДД.ММ.ГГГГ в ГГГГ-ММ-ДД
function parseDateRU(dateStr) {
    const parts = dateStr.trim().split('.');
    if (parts.length !== 3) return null;
    const [day, month, year] = parts;
    if (year.length !== 4 || day.length > 2 || month.length > 2) return null;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// Генерация слотов
function generateBaseSlots(dateStr) {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay(); // 0 = ВС, 6 = СБ
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    const slots = [];

    if (isWeekend) {
        for (let hour = 6; hour <= 21; hour++) {
            const hStr = hour < 10 ? `0${hour}` : `${hour}`;
            slots.push(`${hStr}:00`);
        }
    } else {
        const morningOpened = db.openWeekdayMorning[dateStr] || false;
        if (morningOpened) {
            for (let hour = 6; hour < 18; hour++) {
                const hStr = hour < 10 ? `0${hour}` : `${hour}`;
                slots.push(`${hStr}:00`);
            }
        }
        for (let hour = 18; hour <= 21; hour++) {
            slots.push(`${hour}:00`);
        }
    }
    return slots;
}

// API для сайта
app.get('/api/available-slots', (req, res) => {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'Не указана дата' });

    if (db.closedDays.has(date)) {
        return res.json({ available: false, slots: [] });
    }

    const baseSlots = generateBaseSlots(date);
    const busy = db.busySlots[date] || [];
    const availableSlots = baseSlots.filter(slot => !busy.includes(slot));

    res.json({ available: true, slots: availableSlots });
});

app.post('/api/book', async (req, res) => {
    const { name, phone, service, date, time, note } = req.body;
    if (!name || !phone || !date || !time) {
        return res.status(400).json({ success: false, message: 'Заполните все поля' });
    }

    if (!db.busySlots[date]) db.busySlots[date] = [];
    db.busySlots[date].push(time);

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
        res.json({ success: true });
    }
});

// КНОПКИ МЕНЮ ТЕЛЕГРАМ
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
    userStates[msg.chat.id] = null;
    bot.sendMessage(msg.chat.id, 
        `🌸 <b>Панель управления студией «Не кактус»</b>\n\n` +
        `Нажмите нужную кнопку внизу и просто отправьте дату в формате <b>ДД.ММ.ГГГГ</b> (например: <code>30.10.2026</code>):`, 
        { parse_mode: 'HTML', ...mainMenu }
    );
});

// ОБРАБОТКА НАЖАТИЙ КНОПОК И ВВОДА ДАТ
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';

    if (text.startsWith('/')) return; // Команды обрабатываются отдельно

    // 1. Кнопки меню
    if (text === '☀️ Открыть утро в будни') {
        userStates[chatId] = 'WAITING_FOR_OPEN_MORNING';
        return bot.sendMessage(chatId, '📅 Введите дату для открытия утра (до 18:00) в формате <b>ДД.ММ.ГГГГ</b>:', { parse_mode: 'HTML' });
    }
    if (text === '🌙 Закрыть утро в будни') {
        userStates[chatId] = 'WAITING_FOR_CLOSE_MORNING';
        return bot.sendMessage(chatId, '📅 Введите дату для закрытия утра в формате <b>ДД.ММ.ГГГГ</b>:', { parse_mode: 'HTML' });
    }
    if (text === '🚫 Закрыть день') {
        userStates[chatId] = 'WAITING_FOR_CLOSE_DAY';
        return bot.sendMessage(chatId, '📅 Введите дату, которую нужно полностью закрыть, в формате <b>ДД.ММ.ГГГГ</b>:', { parse_mode: 'HTML' });
    }
    if (text === '✅ Открыть день') {
        userStates[chatId] = 'WAITING_FOR_OPEN_DAY';
        return bot.sendMessage(chatId, '📅 Введите дату, которую нужно снова открыть, в формате <b>ДД.ММ.ГГГГ</b>:', { parse_mode: 'HTML' });
    }
    if (text === '🔒 Занять время') {
        userStates[chatId] = 'WAITING_FOR_BUSY_SLOT';
        return bot.sendMessage(chatId, '⏰ Введите дату и время через пробел в формате:\n<b>ДД.ММ.ГГГГ ЧЧ:ММ</b>\n(Пример: <code>30.10.2026 14:00</code>)', { parse_mode: 'HTML' });
    }
    if (text === '🔓 Освободить время') {
        userStates[chatId] = 'WAITING_FOR_FREE_SLOT';
        return bot.sendMessage(chatId, '⏰ Введите дату и время через пробел в формате:\n<b>ДД.ММ.ГГГГ ЧЧ:ММ</b>\n(Пример: <code>30.10.2026 14:00</code>)', { parse_mode: 'HTML' });
    }
    if (text === '📊 Текущий статус') {
        userStates[chatId] = null;
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

        return bot.sendMessage(chatId, status, { parse_mode: 'HTML', ...mainMenu });
    }

    // 2. Обработка введенных данных на основе текущего шага (состояния)
    const currentState = userStates[chatId];
    if (!currentState) return;

    if (currentState === 'WAITING_FOR_OPEN_MORNING' || currentState === 'WAITING_FOR_CLOSE_MORNING' || 
        currentState === 'WAITING_FOR_CLOSE_DAY' || currentState === 'WAITING_FOR_OPEN_DAY') {
        
        const isoDate = parseDateRU(text);
        if (!isoDate) {
            return bot.sendMessage(chatId, '❌ Неверный формат даты! Пожалуйста, отправьте в формате <b>ДД.ММ.ГГГГ</b> (например: <code>30.10.2026</code>):', { parse_mode: 'HTML' });
        }

        if (currentState === 'WAITING_FOR_OPEN_MORNING') {
            db.openWeekdayMorning[isoDate] = true;
            bot.sendMessage(chatId, `☀️ Утро в будни <b>${text}</b> (до 18:00) успешно <b>ОТКРЫТО</b>!`, { parse_mode: 'HTML', ...mainMenu });
        } else if (currentState === 'WAITING_FOR_CLOSE_MORNING') {
            db.openWeekdayMorning[isoDate] = false;
            bot.sendMessage(chatId, `🌙 Утро в будни <b>${text}</b> (до 18:00) снова <b>ЗАКРЫТО</b>.`, { parse_mode: 'HTML', ...mainMenu });
        } else if (currentState === 'WAITING_FOR_CLOSE_DAY') {
            db.closedDays.add(isoDate);
            bot.sendMessage(chatId, `⛔ День <b>${text}</b> полностью <b>ЗАКРЫТ</b> для записи.`, { parse_mode: 'HTML', ...mainMenu });
        } else if (currentState === 'WAITING_FOR_OPEN_DAY') {
            db.closedDays.delete(isoDate);
            bot.sendMessage(chatId, `✅ День <b>${text}</b> снова <b>ОТКРЫТ</b> для записи.`, { parse_mode: 'HTML', ...mainMenu });
        }

        userStates[chatId] = null; // Сбрасываем состояние
    } 
    else if (currentState === 'WAITING_FOR_BUSY_SLOT' || currentState === 'WAITING_FOR_FREE_SLOT') {
        const parts = text.split(' ');
        if (parts.length < 2) {
            return bot.sendMessage(chatId, '❌ Ошибка! Введите дату и время через пробел:\nПример: <code>30.10.2026 14:00</code>', { parse_mode: 'HTML' });
        }

        const isoDate = parseDateRU(parts[0]);
        const time = parts[1].trim();

        if (!isoDate) {
            return bot.sendMessage(chatId, '❌ Неверный формат даты в начале! Используйте <b>ДД.ММ.ГГГГ ЧЧ:ММ</b>', { parse_mode: 'HTML' });
        }

        if (currentState === 'WAITING_FOR_BUSY_SLOT') {
            if (!db.busySlots[isoDate]) db.busySlots[isoDate] = [];
            if (!db.busySlots[isoDate].includes(time)) db.busySlots[isoDate].push(time);
            bot.sendMessage(chatId, `🔒 Слот <b>${time}</b> на <b>${parts[0]}</b> заблокирован.`, { parse_mode: 'HTML', ...mainMenu });
        } else {
            if (db.busySlots[isoDate]) {
                db.busySlots[isoDate] = db.busySlots[isoDate].filter(t => t !== time);
            }
            bot.sendMessage(chatId, `🔓 Слот <b>${time}</b> на <b>${parts[0]}</b> снова свободен.`, { parse_mode: 'HTML', ...mainMenu });
        }

        userStates[chatId] = null; // Сбрасываем состояние
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
