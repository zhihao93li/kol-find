// Traditional or simplified Chinese, told apart by common characters written differently in the two.
// Only pairs where neither form is also an everyday character of the other script are listed
// (so not 后/後, 里/裡, 面/麵, 干/乾, 台/臺, 云/雲, 志/誌, 着/著, 余/餘, 游/遊).

const SIMPLIFIED =
  "们这说个为时会来对么发国学爱妈宝儿亲乐买卖视频电东车长见关开门问间无与从动现经过还进运边让话语读谢请认识应该样头实体点欢业产务达网页号联络环庆广场饭馆鸡鱼鸟马华湾汉写画书线红绿蓝岁节礼课练习级师园图单双观价钱银铁钟镜饮养馒妆肤护婴医药疗减戏剧机厅杂讯码设计质优购货订预约宠猫鲜烧汤酱盐鸭虾当气帮带别选际张纪录规则历灵梦恋丽颜尔弥贝亚韩汇涨辆处报纸笔记讲论评词译诗声响团队员赛奖胜败输赢战军枪极简难题众职资财层楼厨卫灯树叶风阳阴热温湿净洁脏坏纯绘摄辑";
const TRADITIONAL =
  "們這說個為時會來對麼發國學愛媽寶兒親樂買賣視頻電東車長見關開門問間無與從動現經過還進運邊讓話語讀謝請認識應該樣頭實體點歡業產務達網頁號聯絡環慶廣場飯館雞魚鳥馬華灣漢寫畫書線紅綠藍歲節禮課練習級師園圖單雙觀價錢銀鐵鐘鏡飲養饅妝膚護嬰醫藥療減戲劇機廳雜訊碼設計質優購貨訂預約寵貓鮮燒湯醬鹽鴨蝦當氣幫帶別選際張紀錄規則歷靈夢戀麗顏爾彌貝亞韓匯漲輛處報紙筆記講論評詞譯詩聲響團隊員賽獎勝敗輸贏戰軍槍極簡難題眾職資財層樓廚衛燈樹葉風陽陰熱溫濕淨潔髒壞純繪攝輯";

export const SCRIPT_PAIRS = [...SIMPLIFIED].map((s, i) => [s, [...TRADITIONAL][i]] as const);
const SIMP = new Set(SCRIPT_PAIRS.map(([s]) => s));
const TRAD = new Set(SCRIPT_PAIRS.map(([, t]) => t));

export type Script = "traditional" | "simplified";

/** Which script the text is mostly in, or "" when it doesn't say (no telling characters, or as many of each). */
export function script(text: string): Script | "" {
  let simp = 0;
  let trad = 0;
  for (const ch of text) {
    if (SIMP.has(ch)) simp++;
    else if (TRAD.has(ch)) trad++;
  }
  return trad > simp ? "traditional" : simp > trad ? "simplified" : "";
}
