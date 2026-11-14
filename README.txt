BIRGA Owner — bir nechta restoran va biznes egasi uchun kabinet

Node.js 24+ talab qilinadi. Tashqi npm paketlar talab qilinmaydi.
Ishga tushirish: npm start
Kabinet: http://127.0.0.1:4173/admin.html
Yangi hisob yarating, keyin restoran, do‘kon, xizmat yoki boshqa biznes qo‘shing.
Oldindan belgilangan login/parol yo‘q. Parol kamida 10 belgidan iborat.

Saqlash: mahalliy server SQLite bazasini data/birga.sqlite da yaratadi.
HOST (standart 127.0.0.1), PORT (4173) va BIRGA_DB_PATH muhit orqali sozlanadi.
data/ papkasini ommaviy web papkasiga qo‘ymang va Gitga qo‘shmang.
Jonli SQLite bazasining zaxirasi SQLite backup vositasi bilan olinishi kerak;
oddiy nusxa olishda serverni to‘xtatib, barcha baza fayllarini birga ko‘chiring.

Internetdagi versiya: Cloudflare Worker + Sites tomonidan beriladigan D1.
npm run build orqali barcha brauzer fayllari dist/server/index.js ga yig‘iladi.
.openai/hosting.json dagi d1=DB bindingi serverda ishlatiladi.
drizzle/0000_owner.sql — foydalanuvchilar, sessiyalar, bizneslar va rate limit
jadvallari. Har biznesning kabinet holati JSON sifatida alohida qatorda saqlanadi.
Mahalliy SQLite va joylangan D1 bir-biridan mustaqil bazalardir.
Production bazaga demo ma’lumotlar yoki standart hisob avtomatik yozilmaydi.

Umumiy ko‘rinish barcha bizneslarning 30 kunlik sotuvlari, yakunlangan va
jarayondagi buyurtmalari hamda filiallarini ko‘rsatadi. Biznesni tanlanganda
uning mahsulotlari, buyurtmalari, jadvali, aksiyalari va jamoasi ochiladi.
Yangi buyurtmalar egasi tomonidan qo‘lda kiritiladi. Narx va mahsulot serverda
tekshiriladi. Jarayon: yangi -> tayyorlanmoqda -> tayyor -> yakunlangan.
Yangi buyurtmani sabab bilan rad etish ham mumkin.
Yakunlangan buyurtmalar sotuv ko‘rsatkichlariga kiritiladi.

Hisob va bizneslarga kirish serverda tekshiriladi; boshqa egaga tegishli biznes
o‘qilmaydi va o‘zgartirilmaydi. Parollar PBKDF2-SHA256, tasodifiy salt bilan
hashlanadi. 7 kunlik sessiya HttpOnly/SameSite cookie orqali saqlanadi,
HTTPS da Secure yoqiladi. Bazada sessiya tokenining faqat hashi saqlanadi.
Kirish urinishlari cheklangan; yozish so‘rovlari origin va maxsus header bilan
tekshiriladi. Parallel o‘zgarishlar revision orqali himoyalanadi: eski oynadan
yozish 409 qaytaradi. Xatoda muvaffaqiyat ko‘rsatilmaydi va ma’lumot yo‘qolmaydi.

Tekshiruvlar: npm run build, keyin npm test
Chrome bilan brauzer tekshiruvi: npm run test:browser
Chrome standart Windows manzilida bo‘lishi kerak. Testlar o‘z vaqtinchalik
bazasidan foydalanadi; skrinshotlar .qa/owner-desktop.png va owner-mobile.png.

Excel import: kabinet shablonidagi Excel XML (.xls) yoki UTF-8 CSV.
XLSX faylini Excel orqali CSV ko‘rinishida saqlang. Majburiy ustunlar:
nom, kategoriya, narx. Ixtiyoriy ustunlar: rasm, modifikator.
Import mavjud mahsulotlarni almashtirmaydi. Kategoriyalarni avval yarating.
Barcha qatorlar tekshiruvdan o‘tgach serverga birga saqlanadi.

Ish jadvali shu biznesning barcha filiallariga tegishli; vaqt Asia/Tashkent.
Filiallar alohida yopilishi mumkin. Band/yopiq holatda yangi buyurtma
yaratilmaydi, mavjud buyurtmalar boshqariladi.

Hali ulanmagan: xaridor saytidan buyurtma qabul qilish, Click/Payme/bank,
fiskal printer, email tasdiqlash/parolni tiklash, xodimlarning alohida logini
va sharhlar moderatsiyasi. Xodim rollari hozir biznes ichidagi konfiguratsiya;
kabinetga faqat biznes egasi kiradi. Bank to‘lovlari sotuv bilan tenglashtirilmaydi.
Chek brauzerning chop etish oynasini ochadi, fiskal chek hisoblanmaydi.

Oldingi market.html prototipi va localStorage katalogi alohida saqlangan;
egasi kabinetining API/bazasiga ulanmagan. Eski demo ma’lumotlar egasi hisobiga
avtomatik ko‘chirilmaydi. D1 yoki SQLite ichidagi haqiqiy ma’lumotlar ustuvor.
