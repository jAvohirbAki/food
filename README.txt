BIRGA Owner — bir nechta restoran va biznes egasi uchun kabinet

Node.js 24+ talab qilinadi. Tashqi npm paketlar talab qilinmaydi.
Ishga tushirish: npm start
Kabinet: http://127.0.0.1:4173/admin.html
Yangi hisob yarating, keyin restoran, do‘kon, xizmat yoki boshqa biznes qo‘shing.
Oldindan belgilangan login/parol yo‘q. Parol kamida 10 belgidan iborat.

KURYER KABINETI
Havola: http://127.0.0.1:4173/courier
Internetda ham o‘sha saytning /courier yo‘li ishlaydi. Egasi va kuryer uchun
alohida hisoblar hamda cookie sessiyalari bor; bir brauzerda ikkalasi ishlaydi.
Kuryer ro‘yxatdan o‘tishda telefon, transport va shaharni kiritadi.

Egasi biznesni tanlab Kuryerlar bo‘limida taklif kodi yaratadi. Kod 7 kun
amal qiladi; yangi kod oldingisini bekor qiladi. Kuryer kod orqali biznesga
ulanadi, keyin Ishni boshlash tugmasi bilan onlayn bo‘ladi.
Yangi courier_* jadvallari va deliveries drizzle/0001_couriers.sql orqali
yaratiladi. Oldingi egasi ma’lumotlari saqlanadi.

Yetkazish jarayoni:
1. Egasi yetkazib berish buyurtmasida mijoz telefoni va manzilini kiritadi.
   Filialning haqiqiy manzili Ish vaqti bo‘limida, telefon Sozlamalarda kiritiladi.
2. Buyurtma tayyor bo‘lganda Kuryerga yuborish bosiladi va yetkazish haqi yoziladi.
3. Faqat biznesga ulangan onlayn kuryerlar tayyor yetkazishni ko‘radi.
4. Kuryer Buyurtmani olish -> Buyurtmani oldim -> Mijozga yetkazdim orqali ishlaydi.
5. Yakunlanganda egasi buyurtmasi ham bazada atomik tarzda yakunlanadi,
   uning sotuviga va kuryerning hisoblangan haqiga kiritiladi.

Bir buyurtmani faqat bir kuryer olishi va kuryerda faqat bitta faol yetkazish
bo‘lishi serverda tekshiriladi. Kuryer hali olib ketmagan buyurtmani sabab bilan
qaytarishi mumkin. Olib ketilgan buyurtma qaytarilmaydi. Egasi faqat kuryer
olmagan yetkazishni bekor qila oladi. Faol yetkazishi bor kuryer uzilmaydi;
ulanish uzilganda eski taklif kodi ham bekor bo‘ladi. Boshqa ulangan kuryerlar qoladi.
Mijozning telefoni, manzili va buyurtma tarkibi faqat olgan kuryerga ochiladi;
yakunlangan tarixda bu shaxsiy ma’lumotlar berilmaydi.

Kabinet manzilni tashqi xaritada ochish va telefon qilish havolalarini beradi.
Jonli GPS kuzatuv, yo‘l masofasi hisoblash, SMS, push va avtomatik pul chiqarish
ulanmagan. Daromad — biznes belgilagan hisoblangan haq, bank tushumi emas.
Kuryer ekrani 20 soniyada, egasining Buyurtmalar/Kuryerlar bo‘limlari 15 soniyada
yangilanadi; har ikkala tomonda qo‘lda Yangilash tugmasi ham mavjud.

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

Hali ulanmagan: Click/Payme/bank,
fiskal printer, email tasdiqlash/parolni tiklash, xodimlarning alohida logini
va sharhlar moderatsiyasi. Xodim rollari hozir biznes ichidagi konfiguratsiya;
kabinetga faqat biznes egasi kiradi. Bank to‘lovlari sotuv bilan tenglashtirilmaydi.
Chek brauzerning chop etish oynasini ochadi, fiskal chek hisoblanmaydi.

Xaridor sahifasi: / yoki /market.html. Restoran menyulari /api/food/restaurants dan olinadi.
Buyurtmalar /api/food/orders orqali egasi kabinetiga yoziladi. Narx, ish vaqti,
filial va taom mavjudligi serverda tekshiriladi. Takror yuborish requestId orqali
bitta buyurtma sifatida qaytariladi. To‘lov yetkazilganda naqd; yetkazish narxi va
vaqtini restoran tasdiqlaydi. Namuna menyulardan haqiqiy buyurtma yuborilmaydi.
Restoran katalogi bo‘sh bo‘lsa namuna menyular ko‘rinadi.
Xaridor brauzer tekshiruvi: node scripts/food-browser-qa.cjs
