const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// НАСТРОЙКИ
const TELEGRAM_TOKEN = '8604175231:AAG4Mda6Aq__x8YUtT9-6FVDpzKvfkiGqgA';
const OWNER_CHAT_ID = '5657384333'; // Ваш Chat ID

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Простая база данных в JSON-файле
const DB_FILE = './schedule.json';

function loadData() {
    if (!fs.existsSync(DB_FILE)) {
        return { blockedDates: [], blockedSlots: {} }; // blockedSlots: { "2026-10-25": ["14:00", "16:00"] }
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveData(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ================= TELEGRAM BOT LOGIC =================
bot.onText(/\/start/, (msg) => {
    if (String(msg.chat.id) !== OWNER_CHAT_ID) return;
    
    bot.sendMessage(msg.chat.id, "🌸 **Панель управления студией «Не кактус»**\n\nИспользуйте команды:\n• `/off ГГГГ-ММ-ДД` — закрыть весь день (напр. `/off 2026-10-25`)\n• `/on ГГГГ-ММ-ДД` — открыть день\n• `/busy ГГГГ-ММ-ДД ЧЧ:ММ` — занять слот (напр. `/busy 2026-10-25 14:00`)\n• `/free ГГГГ-ММ-ДД ЧЧ:ММ` — освободить слот\n• `/status` — посмотреть заблокированные даты");
});

// Блокировка полного дня: /off 2026-10-25
bot.onText(/\/off (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== OWNER_CHAT_ID) return;
    const date = match[1].trim();
    const db = loadData();
    if (!db.blockedDates.includes(date)) {
        db.blockedDates.push(date);
        saveData(db);
    }
    bot.sendMessage(msg.chat.id, `⛔ День ${date} полностью закрыт для записи.`);
});

// Разблокировка дня: /on 2026-10-25
bot.onText(/\/on (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== OWNER_CHAT_ID) return;
    const date = match[1].trim();
    const db = loadData();
    db.blockedDates = db.blockedDates.filter(d => d !== date);
    saveData(db);
    bot.sendMessage(msg.chat.id, `✅ День ${date} снова открыт для записи.`);
});

// Блокировка отдельного слота: /busy 2026-10-25 14:00
bot.onText(/\/busy (.+) (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== OWNER_CHAT_ID) return;
    const date = match[1].trim();
    const time = match[2].trim();
    const db = loadData();
    if (!db.blockedSlots[date]) db.blockedSlots[date] = [];
    if (!db.blockedSlots[date].includes(time)) {
        db.blockedSlots[date].push(time);
        saveData(db);
    }
    bot.sendMessage(msg.chat.id, `🔒 Слот ${date} в ${time} заблокирован.`);
});

// Просмотр статуса: /status
bot.onText(/\/status/, (msg) => {
    if (String(msg.chat.id) !== OWNER_CHAT_ID) return;
    const db = loadData();
    let text = `📋 **Заблокированные дни:**\n${db.blockedDates.join(', ') || 'Нет'}\n\n**Занятые слоты:**\n`;
    for (const [date, slots] of Object.entries(db.blockedSlots)) {
        if (slots.length) text += `• ${date}: ${slots.join(', ')}\n`;
    }
    bot.sendMessage(msg.chat.id, text);
});

// ================= API ДЛЯ САЙТА =================

// Получить список доступных слотов для даты
app.get('/api/available-slots', (req, res) => {
    const { date } = req.query; // YYYY-MM-DD
    const db = loadData();

    const allSlots = ["10:00", "12:00", "14:00", "16:00", "18:00", "20:00"];

    // Если весь день закрыт
    if (db.blockedDates.includes(date)) {
        return res.json({ available: false, slots: [], reason: 'Выходной день' });
    }

    const blockedForDate = db.blockedSlots[date] || [];
    const availableSlots = allSlots.filter(slot => !blockedForDate.includes(slot));

    res.json({ available: true, slots: availableSlots });
});

// Забронировать слот с сайта
app.post('/api/book', (req, res) => {
    const { name, phone, date, time, service, note } = req.body;
    const db = loadData();

    // Занимаем слот
    if (!db.blockedSlots[date]) db.blockedSlots[date] = [];
    db.blockedSlots[date].push(time);
    saveData(db);

    // Отправляем уведомление владельцу
    const text = `🌸 <b>НОВАЯ ЗАПИСЬ НА САЙТЕ «НЕ КАКТУС»</b>\n\n` +
        `👤 <b>Имя:</b> ${name}\n` +
        `📞 <b>Телефон:</b> ${phone}\n` +
        `💆‍♀️ <b>Услуга:</b> ${service}\n` +
        `📅 <b>Дата:</b> ${date}\n` +
        `⏰ <b>Время:</b> ${time}\n` +
        (note ? `💬 <b>Комментарий:</b> ${note}` : '');

    bot.sendMessage(OWNER_CHAT_ID, text, { parse_mode: 'HTML' });

    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
