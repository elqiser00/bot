import { Telegraf, Markup } from 'telegraf';
import { BlobServiceClient } from '@azure/storage-blob';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// التحقق من وجود التوكن
if (!process.env.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN غير موجود في ملف .env');
    process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

// حالة المستخدمين المؤقتة (لجمع البيانات خطوة بخطوة)
const userSessions = new Map();

// الاتصال بـ Azure Blob Storage (اختياري حالياً)
let blobServiceClient;
let containerClient;

try {
    if (process.env.AZURE_CONNECTION_STRING) {
        blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_CONNECTION_STRING);
        containerClient = blobServiceClient.getContainerClient('blog-data');
        console.log('✅ متصل بـ Azure Blob Storage');
    } else {
        console.log('⚠️ Azure غير متصل - سيتم حفظ البيانات محلياً');
    }
} catch (error) {
    console.error('❌ فشل الاتصال بـ Azure:', error.message);
}

// دالة حفظ البيانات (Azure أو محلياً)
async function saveArticle(articleData) {
    const filename = `article_${Date.now()}.json`;
    
    if (containerClient) {
        // حفظ في Azure
        const blockBlobClient = containerClient.getBlockBlobClient(filename);
        await blockBlobClient.upload(
            JSON.stringify(articleData, null, 2),
            JSON.stringify(articleData).length,
            { blobHTTPHeaders: { blobContentType: 'application/json' } }
        );
        return blockBlobClient.url;
    } else {
        // حفظ محلياً (للتجربة)
        fs.writeFileSync(`./data/${filename}`, JSON.stringify(articleData, null, 2));
        return `local://data/${filename}`;
    }
}

// ============== أوامر البوت ==============

// أمر /start
bot.start(async (ctx) => {
    const welcomeMessage = `
🚀 *مرحباً بك في لوحة تحكم موقع التصنيفات!*

أنا البوت المساعد لإدارة محتوى موقعك.
يمكنك إضافة وحذف وتعديل المقالات بكل سهولة.

*ما الذي يمكنني فعله؟*
📝 إضافة مقالات جديدة
📂 عرض جميع المقالات
🗑️ حذف مقالات
✏️ تعديل المحتوى

اختر أحد الأزرار أدناه للبدء:
    `;
    
    await ctx.reply(welcomeMessage, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('📝 إضافة مقال جديد', 'add_article')],
            [Markup.button.callback('📂 عرض التصنيفات', 'show_categories')],
            [Markup.button.callback('📋 جميع المقالات', 'list_articles')],
            [Markup.button.url('🌐 زيارة الموقع', 'https://your-username.github.io')]
        ])
    });
});

// زر إضافة مقال جديد
bot.action('add_article', async (ctx) => {
    await ctx.answerCbQuery();
    
    // بدء جلسة جديدة للمستخدم
    userSessions.set(ctx.from.id, { step: 'waiting_title', data: {} });
    
    await ctx.reply('✏️ *أرسل عنوان المقال:*\n\nمثال: "أهم أخبار التكنولوجيا في 2026"', {
        parse_mode: 'Markdown'
    });
});

// زر عرض التصنيفات
bot.action('show_categories', async (ctx) => {
    await ctx.answerCbQuery();
    
    await ctx.reply('📂 *اختر التصنيف:*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('💻 تكنولوجيا', 'cat_tech')],
            [Markup.button.callback('⚽ رياضة', 'cat_sports')],
            [Markup.button.callback('💰 اقتصاد', 'cat_economy')],
            [Markup.button.callback('🎨 فن وثقافة', 'cat_culture')],
            [Markup.button.callback('🔙 رجوع', 'back_to_main')]
        ])
    });
});

// معالجة اختيار التصنيف
bot.action(/cat_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const category = ctx.match[1];
    const categoryNames = {
        tech: 'تكنولوجيا',
        sports: 'رياضة',
        economy: 'اقتصاد',
        culture: 'فن وثقافة'
    };
    
    await ctx.reply(`✨ *عرض مقالات تصنيف ${categoryNames[category] || category}*\n\n(سيتم جلب المقالات قريباً...)`, {
        parse_mode: 'Markdown'
    });
});

// زر عرض جميع المقالات
bot.action('list_articles', async (ctx) => {
    await ctx.answerCbQuery();
    
    // هنا هتجيب المقالات من Azure
    await ctx.reply('📋 *جميع المقالات*\n\nلا توجد مقالات حتى الآن. أضف مقالاً جديداً باستخدام الزر أعلاه!', {
        parse_mode: 'Markdown'
    });
});

// زر رجوع للقائمة الرئيسية
bot.action('back_to_main', async (ctx) => {
    await ctx.answerCbQuery();
    
    await ctx.reply('🔙 *القائمة الرئيسية:*', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('📝 إضافة مقال جديد', 'add_article')],
            [Markup.button.callback('📂 عرض التصنيفات', 'show_categories')],
            [Markup.button.callback('📋 جميع المقالات', 'list_articles')],
            [Markup.button.url('🌐 زيارة الموقع', 'https://your-username.github.io')]
        ])
    });
});

// ============== استقبال النصوص من المستخدمين ==============

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const session = userSessions.get(userId);
    const text = ctx.message.text;
    
    // إذا لم يكن المستخدم في جلسة إضافة مقال
    if (!session) return;
    
    // معالجة الخطوات المتتالية لإضافة المقال
    switch (session.step) {
        case 'waiting_title':
            session.data.title = text;
            session.step = 'waiting_content';
            await ctx.reply('📄 *أرسل محتوى المقال:*\n\n(يمكنك إرسال نص طويل، وسيتم حفظه بالكامل)', {
                parse_mode: 'Markdown'
            });
            break;
            
        case 'waiting_content':
            session.data.content = text;
            session.step = 'waiting_category';
            
            await ctx.reply('🏷️ *اختر تصنيف المقال:*', {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('💻 تكنولوجيا', 'category_tech')],
                    [Markup.button.callback('⚽ رياضة', 'category_sports')],
                    [Markup.button.callback('💰 اقتصاد', 'category_economy')],
                    [Markup.button.callback('🎨 فن وثقافة', 'category_culture')]
                ])
            });
            break;
            
        default:
            break;
    }
});

// معالجة اختيار التصنيف أثناء إضافة المقال
bot.action(/category_(.+)/, async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const session = userSessions.get(userId);
    const category = ctx.match[1];
    
    if (session && session.step === 'waiting_category') {
        session.data.category = category;
        session.data.date = new Date().toISOString();
        session.data.author = ctx.from.first_name || ctx.from.username;
        
        // حفظ المقال
        try {
            const articleUrl = await saveArticle(session.data);
            
            const summary = `
✅ *تم حفظ المقال بنجاح!*

📌 *العنوان:* ${session.data.title}
📂 *التصنيف:* ${category}
👤 *الكاتب:* ${session.data.author}
📅 *التاريخ:* ${new Date().toLocaleDateString('ar-EG')}

🔗 *رابط الحفظ:* ${articleUrl}
            `;
            
            await ctx.reply(summary, { parse_mode: 'Markdown' });
            
            // عرض خيارات إضافية
            await ctx.reply('🎯 *ماذا تريد أن تفعل الآن؟*', {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('📝 إضافة مقال آخر', 'add_article')],
                    [Markup.button.callback('🔙 القائمة الرئيسية', 'back_to_main')]
                ])
            });
            
            // إنهاء الجلسة
            userSessions.delete(userId);
            
        } catch (error) {
            await ctx.reply(`❌ حدث خطأ أثناء حفظ المقال: ${error.message}`);
        }
    }
});

// ============== تشغيل البوت ==============

// إنشاء مجلد data للتجربة المحلية
if (!fs.existsSync('./data')) {
    fs.mkdirSync('./data');
}

// تشغيل البوت (Polling mode - يعمل على طول)
bot.launch()
    .then(() => {
        console.log('🚀 البوت شغال الآن على طول!');
        console.log('👤 ابحث عن البوت في تليجرام وابعتله /start');
        console.log('📡 وضع التشغيل: Polling (يعمل 24/7 طالما هذا السكريبت شغال)');
    })
    .catch((err) => {
        console.error('❌ فشل تشغيل البوت:', err);
    });

// إيقاف تشغيل البوت بشكل نظيف عند إغلاق البرنامج
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
