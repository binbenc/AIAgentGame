/**
 * 远方旅行社的产品库：8 个城市的交通、酒店、餐厅、景点。仿照 TravelPlanner 的沙盒数据库，规模缩小、改成中文场景。
 * 时刻表每天相同，有效期 2026-11-01 ~ 2026-12-15；交通 id = 车次/航班号-月日，例如 G1974-1106。
 */
import { L } from '../../../engine/locale'

export type Mode = '高铁' | '飞机' | 'train' | 'flight'

export interface Transport {
  id: string
  code: string
  mode: Mode
  from: string
  to: string
  date: string
  depart: string
  arrive: string
  /** 每人票价（元） */
  price: number
}

export interface Hotel {
  id: string
  city: string
  name: string
  /** 每间每晚（元）；青旅床位是每床每晚 */
  price: number
  rating: number
  roomType: '大床房' | '双床房' | '家庭房' | '青旅床位' | 'king room' | 'twin room' | 'family room' | 'dorm bed'
  /** 每间最多住几人 */
  maxOccupancy: number
  /** 最少连续入住晚数 */
  minNights: number
  petsAllowed: boolean
  barrierFree: boolean
  /** 给人看的规则说明 */
  rules: string[]
}

export interface Restaurant {
  id: string
  city: string
  name: string
  cuisine: string
  /** 人均消费（元） */
  avgCost: number
  /** 营业时间，多段用逗号分隔；结束时间小于开始时间表示营业到次日凌晨 */
  hours: string
  rating: number
}

export interface Attraction {
  id: string
  city: string
  name: string
  /** 每人门票（元），0 表示免费 */
  ticket: number
  /** 建议游览时长（小时） */
  duration: number
  /** 每周闭馆日，例如 "周一"；null 表示全年开放 */
  closedOn: string | null
  barrierFree: boolean
  rating: number
}

/** English names for everything in the tables below (cities, modes, room types, cuisines, weekdays, hotels, restaurants, attractions) */
const EN: Record<string, string> = {
  北京: 'Beijing',
  上海: 'Shanghai',
  杭州: 'Hangzhou',
  成都: 'Chengdu',
  西安: "Xi'an",
  厦门: 'Xiamen',
  广州: 'Guangzhou',
  重庆: 'Chongqing',
  高铁: 'train',
  飞机: 'flight',
  大床房: 'king room',
  双床房: 'twin room',
  家庭房: 'family room',
  青旅床位: 'dorm bed',
  京菜: 'Beijing cuisine',
  火锅: 'hotpot',
  小吃: 'snacks',
  川菜: 'Sichuan',
  素食: 'vegetarian',
  本帮菜: 'Shanghainese',
  浙菜: 'Zhejiang cuisine',
  海鲜: 'seafood',
  杭帮菜: 'Hangzhou cuisine',
  烧烤: 'barbecue',
  串串: 'skewers',
  陕菜: 'Shaanxi cuisine',
  闽菜: 'Fujian cuisine',
  粤菜: 'Cantonese',
  周日: 'Sunday',
  周一: 'Monday',
  周二: 'Tuesday',
  周三: 'Wednesday',
  周四: 'Thursday',
  周五: 'Friday',
  周六: 'Saturday',
  王府井文华东方酒店: 'Mandarin Oriental Wangfujing',
  北京饭店诺金: 'NUO Hotel Beijing',
  南锣鼓巷四合院客栈: 'Nanluoguxiang Courtyard Inn',
  前门亚朵酒店: 'Atour Hotel Qianmen',
  国贸如家精选: 'Home Inn Selected Guomao',
  胡同青年旅舍: 'Hutong Youth Hostel',
  外滩华尔道夫酒店: 'Waldorf Astoria on the Bund',
  和平饭店: 'Fairmont Peace Hotel',
  新天地朗廷酒店: 'Langham Xintiandi',
  静安亚朵酒店: "Atour Hotel Jing'an",
  人民广场全季酒店: "JI Hotel People's Square",
  城市青年旅舍: 'City Youth Hostel',
  西湖国宾馆: 'West Lake State Guesthouse',
  灵隐宠物友好民宿: 'Lingyin Pet-Friendly B&B',
  湖滨亚朵酒店: 'Atour Hotel Hubin',
  西湖边汉庭酒店: 'Hanting Hotel West Lake',
  武林全季酒店: 'JI Hotel Wulin',
  西湖青年旅舍: 'West Lake Youth Hostel',
  太古里博舍: 'The Temple House',
  锦江宾馆: 'Jinjiang Hotel',
  宽窄巷子院落民宿: 'Kuanzhai Alley Courtyard B&B',
  春熙路全季酒店: 'JI Hotel Chunxi Road',
  天府家庭公寓: 'Tianfu Family Apartments',
  熊猫青年旅舍: 'Panda Youth Hostel',
  索菲特人民大厦: 'Sofitel Renmin Square',
  钟楼威斯汀酒店: 'Westin Bell Tower',
  回民街精品民宿: 'Muslim Quarter Boutique B&B',
  大雁塔亚朵酒店: 'Atour Hotel Big Wild Goose Pagoda',
  钟楼全季酒店: 'JI Hotel Bell Tower',
  书院青年旅舍: 'Shuyuan Youth Hostel',
  鼓浪屿海景别墅: 'Gulangyu Sea View Villa',
  厦门康莱德酒店: 'Conrad Xiamen',
  曾厝垵海边民宿: "Zengcuo'an Seaside B&B",
  中山路亚朵酒店: 'Atour Hotel Zhongshan Road',
  环岛路全季酒店: 'JI Hotel Huandao Road',
  鹭岛青年旅舍: 'Egret Island Youth Hostel',
  广州四季酒店: 'Four Seasons Guangzhou',
  白天鹅宾馆: 'White Swan Hotel',
  东山口洋房民宿: 'Dongshankou Villa B&B',
  北京路亚朵酒店: 'Atour Hotel Beijing Road',
  天河全季酒店: 'JI Hotel Tianhe',
  珠江青年旅舍: 'Pearl River Youth Hostel',
  来福士洲际酒店: 'InterContinental Raffles City',
  洪崖洞江景酒店: 'Hongyadong Riverview Hotel',
  观音桥亚朵酒店: 'Atour Hotel Guanyinqiao',
  南山宠物友好民宿: 'Nanshan Pet-Friendly B&B',
  解放碑汉庭酒店: 'Hanting Hotel Jiefangbei',
  山城青年旅舍: 'Mountain City Youth Hostel',
  四季民福烤鸭店: 'Siji Minfu Roast Duck',
  东来顺涮肉: 'Donglaishun Mutton Hotpot',
  护国寺小吃: 'Huguosi Snacks',
  簋街胡大饭馆: 'Hu Da (Gui Street)',
  方砖厂炸酱面: 'Fangzhuanchang Zhajiang Noodles',
  京兆尹素食: "King's Joy Vegetarian",
  庆丰包子铺: 'Qingfeng Steamed Buns',
  便宜坊烤鸭店: 'Bianyifang Roast Duck',
  老吉士酒家: 'Old Jesse',
  南翔馒头店: 'Nanxiang Bun Shop',
  新荣记: 'Xin Rong Ji',
  鹿园: 'Lu Yuan',
  小杨生煎: "Yang's Fried Dumplings",
  蜀地源冒菜: 'Shudiyuan Maocai',
  功德林素食: 'Gongdelin Vegetarian',
  外滩海鲜夜宵: 'Bund Late-Night Seafood',
  楼外楼: 'Louwailou',
  知味观: 'Zhiweiguan',
  外婆家: "Grandma's Kitchen",
  新白鹿餐厅: 'Xin Bai Lu',
  绿茶餐厅: 'Green Tea Restaurant',
  胜利河烧烤夜市: 'Shengli River BBQ Night Market',
  灵隐素斋: 'Lingyin Vegetarian',
  川味观: 'Chuanweiguan',
  玉芝兰: 'Yu Zhi Lan',
  小龙坎火锅: 'Xiaolongkan Hotpot',
  陈麻婆豆腐: 'Chen Mapo Tofu',
  钟水饺: 'Zhong Dumplings',
  夜猫子串串香: 'Night Owl Skewers',
  龙抄手: 'Long Wontons',
  文殊院素斋: 'Wenshu Monastery Vegetarian',
  蜀九香火锅: 'Shu Jiu Xiang Hotpot',
  长安大牌档: "Chang'an Dapaidang",
  老孙家泡馍: 'Lao Sun Jia Paomo',
  德发长饺子宴: 'De Fa Chang Dumpling Banquet',
  回民街烤肉夜市: 'Muslim Quarter BBQ Night Market',
  魏家凉皮: 'Wei Jia Liangpi',
  西安饭庄: "Xi'an Restaurant",
  蜀香川菜馆: 'Shu Xiang Sichuan Kitchen',
  大慈恩素斋: "Da Ci'en Vegetarian",
  临家闽南菜: 'Linjia Minnan Kitchen',
  八市海鲜大排档: 'Bashi Seafood Dapaidang',
  黄则和花生汤: 'Huang Zehe Peanut Soup',
  宴遇: 'Yan Yu',
  沙茶面老店: 'Old Satay Noodle Shop',
  南普陀素菜馆: 'Nanputuo Vegetarian',
  潮汕牛肉火锅: 'Chaoshan Beef Hotpot',
  曾厝垵小吃街: "Zengcuo'an Snack Street",
  点都德: 'Dian Dou De',
  炳胜品味: 'Bingsheng Pinwei',
  宵夜大排档: 'Late-Night Dapaidang',
  陶陶居: 'Tao Tao Ju',
  广州酒家: 'Guangzhou Restaurant',
  银记肠粉: 'Yin Ji Rice Rolls',
  太二酸菜鱼: 'Tai Er Pickled Fish',
  素社素食: 'Sushe Vegetarian',
  珮姐老火锅: 'Pei Jie Hotpot',
  陶然居: 'Taoranju',
  好又来酸辣粉: 'Haoyoulai Hot & Sour Noodles',
  洞子老火锅: 'Dongzi Hotpot',
  九园包子: 'Jiuyuan Buns',
  磁器口毛血旺: 'Ciqikou Maoxuewang',
  江湖菜烧烤夜市: 'Jianghu BBQ Night Market',
  慈云寺素斋: 'Ciyun Temple Vegetarian',
  故宫博物院: 'The Palace Museum',
  八达岭长城: 'Badaling Great Wall',
  颐和园: 'Summer Palace',
  天坛公园: 'Temple of Heaven',
  中国国家博物馆: 'National Museum of China',
  南锣鼓巷: 'Nanluoguxiang',
  '798 艺术区': '798 Art District',
  外滩: 'The Bund',
  上海博物馆: 'Shanghai Museum',
  豫园: 'Yu Garden',
  东方明珠: 'Oriental Pearl Tower',
  上海迪士尼乐园: 'Shanghai Disneyland',
  田子坊: 'Tianzifang',
  朱家角古镇: 'Zhujiajiao Water Town',
  西湖: 'West Lake',
  灵隐寺: 'Lingyin Temple',
  西溪湿地: 'Xixi Wetland',
  浙江省博物馆: 'Zhejiang Provincial Museum',
  宋城: 'Songcheng',
  河坊街: 'Hefang Street',
  龙井村: 'Longjing Village',
  大熊猫繁育研究基地: 'Giant Panda Breeding Base',
  四川博物院: 'Sichuan Museum',
  都江堰: 'Dujiangyan',
  宽窄巷子: 'Kuanzhai Alley',
  武侯祠: 'Wuhou Shrine',
  杜甫草堂: 'Du Fu Thatched Cottage',
  青城山: 'Mount Qingcheng',
  陕西历史博物馆: 'Shaanxi History Museum',
  秦始皇兵马俑: 'Terracotta Warriors',
  大雁塔: 'Big Wild Goose Pagoda',
  西安城墙: "Xi'an City Wall",
  大唐不夜城: 'Datang Everbright City',
  华清宫: 'Huaqing Palace',
  回民街: 'Muslim Quarter',
  鼓浪屿: 'Gulangyu Island',
  南普陀寺: 'Nanputuo Temple',
  厦门大学: 'Xiamen University',
  环岛路: 'Huandao Road',
  曾厝垵: "Zengcuo'an",
  胡里山炮台: 'Hulishan Fortress',
  厦门科技馆: 'Xiamen Science and Technology Museum',
  广州塔: 'Canton Tower',
  陈家祠: 'Chen Clan Ancestral Hall',
  沙面岛: 'Shamian Island',
  长隆野生动物世界: 'Chimelong Safari Park',
  越秀公园: 'Yuexiu Park',
  广东省博物馆: 'Guangdong Museum',
  北京路步行街: 'Beijing Road Pedestrian Street',
  洪崖洞: 'Hongyadong',
  武隆天生三桥: 'Wulong Three Natural Bridges',
  长江索道: 'Yangtze River Cableway',
  磁器口古镇: 'Ciqikou Ancient Town',
  重庆中国三峡博物馆: 'Three Gorges Museum',
  解放碑步行街: 'Jiefangbei Pedestrian Street',
  李子坝轻轨穿楼: 'Liziba Monorail Station',
}
/** 把表里的中文名换成当前语言的名字 */
const tr = <T extends string>(s: T): T => L(s, (EN[s] ?? s) as T)

const CITIES_ZH = ['北京', '上海', '杭州', '成都', '西安', '厦门', '广州', '重庆']
export const CITIES: string[] = CITIES_ZH.map(tr)
const CODE_ZH: Record<string, string> = { 北京: 'BJ', 上海: 'SH', 杭州: 'HZ', 成都: 'CD', 西安: 'XA', 厦门: 'XM', 广州: 'GZ', 重庆: 'CQ' }
/** 城市（当前语言的名字）→ id 里用的两字母代码 */
export const CITY_CODE: Record<string, string> = Object.fromEntries(CITIES_ZH.map((c) => [tr(c), CODE_ZH[c]]))

export const FLIGHT: Mode = tr('飞机')

/** 英文城市名的比较键：忽略大小写、空格、撇号和结尾的 "city"（Xi'an / Xian / xi an city 都算同一个） */
export const cityKey = (s: string) => s.toLowerCase().replace(/\s*city$/, '').replace(/[^a-z]/g, '')

export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'].map(tr)

// —————————————— 交通时刻表 ——————————————
// [车次/航班, 方式, 出发城市, 到达城市, 出发, 到达, 票价]
type Line = [string, Mode, string, string, string, string, number]

const LINES_ZH: Line[] = [
  // 上海 ⇄ 成都
  ['G1974', '高铁', '上海', '成都', '06:52', '18:40', 960],
  ['MU5401', '飞机', '上海', '成都', '07:30', '10:45', 1180],
  ['CA4502', '飞机', '上海', '成都', '13:10', '16:20', 860],
  ['3U8962', '飞机', '上海', '成都', '19:00', '22:10', 690],
  ['G1975', '高铁', '成都', '上海', '07:25', '19:10', 960],
  ['MU5402', '飞机', '成都', '上海', '08:10', '11:20', 1150],
  ['CA4511', '飞机', '成都', '上海', '15:20', '18:30', 820],
  ['3U8961', '飞机', '成都', '上海', '19:30', '22:40', 720],
  // 上海 ⇄ 西安
  ['G1918', '高铁', '上海', '西安', '07:00', '13:05', 670],
  ['MU2161', '飞机', '上海', '西安', '08:20', '11:00', 980],
  ['G1920', '高铁', '上海', '西安', '12:30', '18:40', 650],
  ['FM9201', '飞机', '上海', '西安', '17:40', '20:20', 620],
  ['G1919', '高铁', '西安', '上海', '08:10', '14:20', 670],
  ['MU2162', '飞机', '西安', '上海', '12:00', '14:30', 960],
  ['G1923', '高铁', '西安', '上海', '15:30', '21:40', 650],
  ['FM9202', '飞机', '西安', '上海', '20:10', '22:40', 600],
  // 上海 ⇄ 杭州（只有高铁）
  ['G7301', '高铁', '上海', '杭州', '07:10', '08:15', 73],
  ['G7311', '高铁', '上海', '杭州', '09:00', '10:05', 73],
  ['G7355', '高铁', '上海', '杭州', '13:30', '14:35', 73],
  ['G7381', '高铁', '上海', '杭州', '18:00', '19:05', 73],
  ['G7302', '高铁', '杭州', '上海', '07:30', '08:35', 73],
  ['G7320', '高铁', '杭州', '上海', '12:15', '13:20', 73],
  ['G7368', '高铁', '杭州', '上海', '17:30', '18:35', 73],
  ['G7392', '高铁', '杭州', '上海', '20:30', '21:35', 73],
  // 上海 ⇄ 北京
  ['G1', '高铁', '上海', '北京', '07:00', '11:28', 560],
  ['MU5101', '飞机', '上海', '北京', '08:00', '10:15', 1050],
  ['G13', '高铁', '上海', '北京', '13:00', '17:30', 560],
  ['CA1858', '飞机', '上海', '北京', '18:30', '20:45', 780],
  ['G2', '高铁', '北京', '上海', '07:00', '11:30', 560],
  ['CA1501', '飞机', '北京', '上海', '08:30', '10:45', 1020],
  ['G16', '高铁', '北京', '上海', '14:00', '18:30', 560],
  ['MU5138', '飞机', '北京', '上海', '19:00', '21:15', 760],
  // 上海 ⇄ 厦门
  ['MF8502', '飞机', '上海', '厦门', '07:40', '09:35', 880],
  ['D3135', '高铁', '上海', '厦门', '08:30', '15:20', 520],
  ['MU5571', '飞机', '上海', '厦门', '12:20', '14:15', 760],
  ['D3205', '高铁', '上海', '厦门', '13:00', '19:50', 500],
  ['MF8501', '飞机', '厦门', '上海', '08:00', '09:55', 860],
  ['D3136', '高铁', '厦门', '上海', '09:10', '16:00', 520],
  ['D3206', '高铁', '厦门', '上海', '14:00', '20:50', 500],
  ['MU5572', '飞机', '厦门', '上海', '15:30', '17:25', 740],
  // 上海 ⇄ 广州
  ['G1301', '高铁', '上海', '广州', '07:20', '14:10', 790],
  ['CZ3524', '飞机', '上海', '广州', '08:30', '10:50', 980],
  ['MU5303', '飞机', '上海', '广州', '13:00', '15:20', 720],
  ['G1305', '高铁', '上海', '广州', '14:30', '21:20', 760],
  ['G1302', '高铁', '广州', '上海', '07:40', '14:30', 790],
  ['CZ3523', '飞机', '广州', '上海', '09:00', '11:20', 960],
  ['G1306', '高铁', '广州', '上海', '15:10', '22:00', 760],
  ['MU5304', '飞机', '广州', '上海', '16:20', '18:40', 700],
  // 上海 ⇄ 重庆
  ['G1978', '高铁', '上海', '重庆', '07:05', '18:55', 900],
  ['MU2501', '飞机', '上海', '重庆', '07:50', '10:40', 1020],
  ['3U8964', '飞机', '上海', '重庆', '14:30', '17:20', 700],
  ['G1977', '高铁', '重庆', '上海', '08:00', '19:50', 900],
  ['MU2502', '飞机', '重庆', '上海', '11:30', '14:15', 1000],
  ['3U8963', '飞机', '重庆', '上海', '18:00', '20:45', 680],
  // 北京 ⇄ 西安
  ['G651', '高铁', '北京', '西安', '07:00', '11:30', 515],
  ['CA1201', '飞机', '北京', '西安', '08:30', '10:35', 860],
  ['G659', '高铁', '北京', '西安', '13:00', '17:30', 515],
  ['MU2102', '飞机', '北京', '西安', '19:30', '21:35', 620],
  ['G652', '高铁', '西安', '北京', '07:30', '12:00', 515],
  ['CA1202', '飞机', '西安', '北京', '11:30', '13:35', 840],
  ['G660', '高铁', '西安', '北京', '15:00', '19:30', 515],
  ['MU2101', '飞机', '西安', '北京', '20:20', '22:25', 600],
  // 北京 ⇄ 成都
  ['G89', '高铁', '北京', '成都', '06:58', '14:40', 778],
  ['CA4101', '飞机', '北京', '成都', '07:20', '10:20', 1250],
  ['CA4115', '飞机', '北京', '成都', '14:00', '17:00', 980],
  ['3U8886', '飞机', '北京', '成都', '19:30', '22:30', 760],
  ['CA4102', '飞机', '成都', '北京', '08:00', '10:50', 1200],
  ['G90', '高铁', '成都', '北京', '08:10', '15:50', 778],
  ['CA4116', '飞机', '成都', '北京', '18:00', '20:50', 940],
  ['3U8885', '飞机', '成都', '北京', '20:40', '23:30', 740],
  // 北京 ⇄ 重庆
  ['CA4141', '飞机', '北京', '重庆', '07:30', '10:20', 1080],
  ['G309', '高铁', '北京', '重庆', '07:50', '19:40', 880],
  ['CA4145', '飞机', '北京', '重庆', '13:40', '16:30', 820],
  ['3U8823', '飞机', '北京', '重庆', '19:10', '22:00', 690],
  ['CA4142', '飞机', '重庆', '北京', '08:10', '10:55', 1060],
  ['G310', '高铁', '重庆', '北京', '08:30', '20:20', 880],
  ['CA4146', '飞机', '重庆', '北京', '17:20', '20:05', 800],
  ['3U8824', '飞机', '重庆', '北京', '20:00', '22:45', 680],
  // 北京 ⇄ 杭州
  ['G31', '高铁', '北京', '杭州', '07:00', '11:38', 540],
  ['CA1702', '飞机', '北京', '杭州', '08:00', '10:10', 900],
  ['G39', '高铁', '北京', '杭州', '14:00', '18:38', 540],
  ['G32', '高铁', '杭州', '北京', '07:30', '12:08', 540],
  ['CA1703', '飞机', '杭州', '北京', '12:30', '14:40', 880],
  ['G40', '高铁', '杭州', '北京', '16:00', '20:38', 540],
  // 北京 ⇄ 厦门（只有航班）
  ['MF8102', '飞机', '北京', '厦门', '08:00', '11:05', 1100],
  ['CA1815', '飞机', '北京', '厦门', '15:00', '18:05', 900],
  ['MF8101', '飞机', '厦门', '北京', '12:00', '15:00', 1080],
  ['CA1816', '飞机', '厦门', '北京', '19:00', '22:05', 880],
  // 北京 ⇄ 广州
  ['CZ3100', '飞机', '北京', '广州', '08:00', '11:15', 1200],
  ['G79', '高铁', '北京', '广州', '10:00', '18:00', 862],
  ['CZ3112', '飞机', '北京', '广州', '15:30', '18:45', 900],
  ['G80', '高铁', '广州', '北京', '10:00', '18:00', 862],
  ['CZ3101', '飞机', '广州', '北京', '12:30', '15:40', 1180],
  ['CZ3113', '飞机', '广州', '北京', '19:00', '22:15', 880],
  // 广州 ⇄ 厦门
  ['D2322', '高铁', '广州', '厦门', '07:50', '11:20', 260],
  ['CZ3851', '飞机', '广州', '厦门', '09:30', '10:50', 620],
  ['D2328', '高铁', '广州', '厦门', '14:10', '17:40', 240],
  ['CZ3855', '飞机', '广州', '厦门', '19:20', '20:40', 450],
  ['D2321', '高铁', '厦门', '广州', '08:20', '11:50', 260],
  ['CZ3852', '飞机', '厦门', '广州', '11:40', '13:00', 600],
  ['D2329', '高铁', '厦门', '广州', '16:30', '20:00', 240],
  ['CZ3856', '飞机', '厦门', '广州', '21:10', '22:30', 430],
  // 广州 ⇄ 成都
  ['G2943', '高铁', '广州', '成都', '07:50', '15:20', 700],
  ['CZ3401', '飞机', '广州', '成都', '08:10', '10:40', 980],
  ['3U8732', '飞机', '广州', '成都', '17:00', '19:30', 720],
  ['G2944', '高铁', '成都', '广州', '09:00', '16:30', 700],
  ['CZ3402', '飞机', '成都', '广州', '11:30', '14:00', 960],
  ['3U8731', '飞机', '成都', '广州', '20:00', '22:30', 700],
  // 广州 ⇄ 重庆
  ['CZ3409', '飞机', '广州', '重庆', '08:00', '10:10', 820],
  ['G2902', '高铁', '广州', '重庆', '09:00', '16:10', 560],
  ['CZ3411', '飞机', '广州', '重庆', '18:30', '20:40', 650],
  ['G2901', '高铁', '重庆', '广州', '08:20', '15:30', 560],
  ['CZ3410', '飞机', '重庆', '广州', '11:00', '13:10', 800],
  ['CZ3412', '飞机', '重庆', '广州', '19:20', '21:30', 630],
  // 西安 ⇄ 成都
  ['G2201', '高铁', '西安', '成都', '08:00', '11:20', 263],
  ['3U8742', '飞机', '西安', '成都', '09:30', '11:00', 680],
  ['G2215', '高铁', '西安', '成都', '14:00', '17:20', 263],
  ['G2202', '高铁', '成都', '西安', '08:30', '11:50', 263],
  ['3U8741', '飞机', '成都', '西安', '12:30', '14:00', 660],
  ['G2216', '高铁', '成都', '西安', '17:30', '20:50', 263],
  // 成都 ⇄ 重庆（只有高铁）
  ['G8501', '高铁', '成都', '重庆', '07:30', '08:40', 154],
  ['G8513', '高铁', '成都', '重庆', '12:00', '13:10', 154],
  ['G8541', '高铁', '成都', '重庆', '17:30', '18:40', 154],
  ['G8502', '高铁', '重庆', '成都', '08:00', '09:10', 154],
  ['G8520', '高铁', '重庆', '成都', '13:30', '14:40', 154],
  ['G8558', '高铁', '重庆', '成都', '19:00', '20:10', 154],
  // 杭州 ⇄ 厦门
  ['D3125', '高铁', '杭州', '厦门', '08:20', '13:30', 380],
  ['MF8516', '飞机', '杭州', '厦门', '12:00', '13:40', 650],
  ['D3126', '高铁', '厦门', '杭州', '14:30', '19:40', 380],
  ['MF8517', '飞机', '厦门', '杭州', '17:40', '19:20', 620],
]

const LINES: Line[] = LINES_ZH.map(([code, mode, from, to, depart, arrive, price]) => [code, tr(mode), tr(from), tr(to), depart, arrive, price])

const FIRST_DAY = Date.UTC(2026, 10, 1)
const LAST_DAY = Date.UTC(2026, 11, 15)
const DAY_MS = 86_400_000

export function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10)
}

function inService(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const [y, m, d] = date.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d)
  return t >= FIRST_DAY && t <= LAST_DAY
}

const toTransport = ([code, mode, from, to, depart, arrive, price]: Line, date: string): Transport => ({
  id: `${code}-${date.slice(5, 7)}${date.slice(8, 10)}`,
  code,
  mode,
  from,
  to,
  date,
  depart,
  arrive,
  price,
})

/** 某天某线路的全部班次（按出发时间排序） */
export function transportsOn(from: string, to: string, date: string): Transport[] {
  if (!inService(date)) return []
  return LINES.filter((l) => l[2] === from && l[3] === to)
    .map((l) => toTransport(l, date))
    .sort((a, b) => a.depart.localeCompare(b.depart))
}

/** 按 id 查交通：G1974-1106 → 2026-11-06 的 G1974 */
export function transportById(id: string): Transport | undefined {
  const m = /^([A-Z0-9]+)-(\d{2})(\d{2})$/.exec(String(id).trim())
  if (!m) return undefined
  const line = LINES.find((l) => l[0] === m[1])
  const date = `2026-${m[2]}-${m[3]}`
  if (!line || !inService(date)) return undefined
  return toTransport(line, date)
}

// —————————————— 酒店 ——————————————
// [名称, 每间每晚, 评分, 房型, 每间最多人数, 最少入住晚数, 可带宠物, 无障碍]
type H = [string, number, number, Hotel['roomType'], number, number, boolean, boolean]

const HOTELS_BY_CITY: Record<string, H[]> = {
  北京: [
    ['王府井文华东方酒店', 1880, 4.9, '大床房', 2, 1, false, true],
    ['北京饭店诺金', 1460, 4.8, '双床房', 2, 1, false, true],
    ['南锣鼓巷四合院客栈', 680, 4.7, '家庭房', 4, 2, true, false],
    ['前门亚朵酒店', 520, 4.6, '双床房', 2, 1, false, true],
    ['国贸如家精选', 360, 4.4, '大床房', 2, 1, true, true],
    ['胡同青年旅舍', 110, 4.2, '青旅床位', 1, 1, false, false],
  ],
  上海: [
    ['外滩华尔道夫酒店', 2100, 4.9, '大床房', 2, 1, false, true],
    ['和平饭店', 1650, 4.8, '大床房', 2, 1, false, true],
    ['新天地朗廷酒店', 1280, 4.7, '双床房', 2, 1, true, true],
    ['静安亚朵酒店', 560, 4.6, '双床房', 2, 1, false, true],
    ['人民广场全季酒店', 420, 4.4, '家庭房', 3, 1, false, true],
    ['城市青年旅舍', 120, 4.2, '青旅床位', 1, 1, false, false],
  ],
  杭州: [
    ['西湖国宾馆', 1680, 4.9, '大床房', 2, 1, false, true],
    ['灵隐宠物友好民宿', 580, 4.8, '大床房', 2, 2, true, false],
    ['湖滨亚朵酒店', 620, 4.7, '双床房', 2, 1, false, true],
    ['西湖边汉庭酒店', 360, 4.5, '双床房', 2, 1, true, false],
    ['武林全季酒店', 400, 4.4, '家庭房', 3, 1, false, true],
    ['西湖青年旅舍', 100, 4.3, '青旅床位', 1, 1, false, false],
  ],
  成都: [
    ['太古里博舍', 1580, 4.9, '大床房', 2, 1, false, true],
    ['锦江宾馆', 1180, 4.8, '大床房', 2, 1, false, true],
    ['宽窄巷子院落民宿', 420, 4.6, '双床房', 2, 2, true, false],
    ['春熙路全季酒店', 330, 4.5, '双床房', 2, 1, false, true],
    ['天府家庭公寓', 560, 4.4, '家庭房', 4, 3, true, true],
    ['熊猫青年旅舍', 90, 4.3, '青旅床位', 1, 1, false, false],
  ],
  西安: [
    ['索菲特人民大厦', 1280, 4.8, '大床房', 2, 1, false, true],
    ['钟楼威斯汀酒店', 980, 4.7, '大床房', 2, 1, false, true],
    ['回民街精品民宿', 380, 4.6, '双床房', 2, 2, true, false],
    ['大雁塔亚朵酒店', 460, 4.5, '双床房', 2, 1, false, true],
    ['钟楼全季酒店', 330, 4.4, '家庭房', 3, 1, true, true],
    ['书院青年旅舍', 80, 4.2, '青旅床位', 1, 1, false, false],
  ],
  厦门: [
    ['鼓浪屿海景别墅', 1380, 4.9, '家庭房', 4, 2, false, false],
    ['厦门康莱德酒店', 1180, 4.8, '大床房', 2, 1, false, true],
    ['曾厝垵海边民宿', 360, 4.6, '家庭房', 3, 1, true, false],
    ['中山路亚朵酒店', 480, 4.5, '双床房', 2, 1, false, true],
    ['环岛路全季酒店', 520, 4.4, '家庭房', 3, 1, false, true],
    ['鹭岛青年旅舍', 90, 4.2, '青旅床位', 1, 1, false, false],
  ],
  广州: [
    ['广州四季酒店', 1580, 4.9, '大床房', 2, 1, false, true],
    ['白天鹅宾馆', 1180, 4.8, '双床房', 2, 1, false, true],
    ['东山口洋房民宿', 420, 4.6, '大床房', 2, 2, true, false],
    ['北京路亚朵酒店', 450, 4.5, '双床房', 2, 1, false, true],
    ['天河全季酒店', 360, 4.4, '家庭房', 3, 1, true, true],
    ['珠江青年旅舍', 90, 4.2, '青旅床位', 1, 1, false, false],
  ],
  重庆: [
    ['来福士洲际酒店', 1080, 4.8, '大床房', 2, 1, false, true],
    ['洪崖洞江景酒店', 760, 4.7, '大床房', 2, 1, true, false],
    ['观音桥亚朵酒店', 420, 4.6, '双床房', 2, 1, false, true],
    ['南山宠物友好民宿', 300, 4.5, '家庭房', 4, 2, true, false],
    ['解放碑汉庭酒店', 260, 4.3, '双床房', 2, 1, false, true],
    ['山城青年旅舍', 70, 4.2, '青旅床位', 1, 1, false, false],
  ],
}

// —————————————— 餐厅 ——————————————
// [名称, 菜系, 人均, 营业时间, 评分]
type R = [string, string, number, string, number]

const RESTAURANTS_BY_CITY: Record<string, R[]> = {
  北京: [
    ['四季民福烤鸭店', '京菜', 220, '11:00-14:00,17:00-21:30', 4.8],
    ['东来顺涮肉', '火锅', 160, '11:00-22:00', 4.7],
    ['护国寺小吃', '小吃', 40, '06:30-20:00', 4.6],
    ['簋街胡大饭馆', '川菜', 150, '16:00-04:00', 4.6],
    ['方砖厂炸酱面', '京菜', 45, '10:30-21:00', 4.5],
    ['京兆尹素食', '素食', 380, '11:30-14:00,17:30-21:30', 4.5],
    ['庆丰包子铺', '小吃', 25, '06:00-21:00', 4.3],
    ['便宜坊烤鸭店', '京菜', 180, '11:00-21:00', 4.3],
  ],
  上海: [
    ['老吉士酒家', '本帮菜', 260, '11:00-14:00,17:00-22:00', 4.8],
    ['南翔馒头店', '小吃', 60, '07:00-20:30', 4.7],
    ['新荣记', '浙菜', 600, '11:30-14:00,17:30-21:30', 4.6],
    ['鹿园', '本帮菜', 180, '11:00-21:30', 4.6],
    ['小杨生煎', '小吃', 30, '07:00-21:00', 4.5],
    ['蜀地源冒菜', '川菜', 70, '10:30-22:00', 4.4],
    ['功德林素食', '素食', 150, '11:00-14:00,17:00-21:00', 4.4],
    ['外滩海鲜夜宵', '海鲜', 90, '18:00-03:00', 4.3],
  ],
  杭州: [
    ['楼外楼', '杭帮菜', 230, '11:00-14:00,16:30-21:00', 4.8],
    ['知味观', '小吃', 50, '06:30-21:00', 4.7],
    ['外婆家', '杭帮菜', 70, '10:30-21:30', 4.6],
    ['新白鹿餐厅', '杭帮菜', 60, '10:00-22:00', 4.5],
    ['绿茶餐厅', '浙菜', 80, '11:00-21:30', 4.4],
    ['胜利河烧烤夜市', '烧烤', 60, '17:00-01:00', 4.3],
    ['灵隐素斋', '素食', 100, '11:00-20:00', 4.3],
    ['川味观', '川菜', 90, '11:00-22:00', 4.2],
  ],
  成都: [
    ['玉芝兰', '川菜', 680, '11:30-14:00,17:30-21:30', 4.9],
    ['小龙坎火锅', '火锅', 130, '11:00-02:00', 4.7],
    ['陈麻婆豆腐', '川菜', 80, '10:30-21:00', 4.6],
    ['钟水饺', '小吃', 35, '07:00-20:00', 4.5],
    ['夜猫子串串香', '串串', 70, '17:00-02:00', 4.5],
    ['龙抄手', '小吃', 40, '07:30-21:00', 4.4],
    ['文殊院素斋', '素食', 90, '11:00-14:00,17:00-21:00', 4.3],
    ['蜀九香火锅', '火锅', 110, '11:00-23:00', 4.3],
  ],
  西安: [
    ['长安大牌档', '陕菜', 120, '10:30-22:00', 4.7],
    ['老孙家泡馍', '小吃', 50, '07:00-21:00', 4.7],
    ['德发长饺子宴', '陕菜', 150, '11:00-14:00,17:00-21:00', 4.6],
    ['回民街烤肉夜市', '烧烤', 70, '17:00-02:00', 4.5],
    ['魏家凉皮', '小吃', 25, '08:00-21:00', 4.4],
    ['西安饭庄', '陕菜', 130, '11:00-21:00', 4.4],
    ['蜀香川菜馆', '川菜', 80, '11:00-22:00', 4.3],
    ['大慈恩素斋', '素食', 90, '11:00-19:30', 4.2],
  ],
  厦门: [
    ['临家闽南菜', '闽菜', 150, '11:00-14:00,17:00-21:30', 4.7],
    ['八市海鲜大排档', '海鲜', 180, '16:00-01:00', 4.7],
    ['黄则和花生汤', '小吃', 30, '06:30-21:00', 4.6],
    ['宴遇', '闽菜', 120, '11:00-21:30', 4.5],
    ['沙茶面老店', '小吃', 35, '07:00-14:00', 4.5],
    ['南普陀素菜馆', '素食', 80, '10:30-19:00', 4.4],
    ['潮汕牛肉火锅', '火锅', 110, '11:00-23:00', 4.3],
    ['曾厝垵小吃街', '小吃', 50, '10:00-23:00', 4.2],
  ],
  广州: [
    ['点都德', '粤菜', 90, '07:00-14:30', 4.8],
    ['炳胜品味', '粤菜', 220, '11:00-14:30,17:00-22:00', 4.7],
    ['宵夜大排档', '小吃', 60, '18:00-03:00', 4.6],
    ['陶陶居', '粤菜', 150, '07:00-22:00', 4.6],
    ['广州酒家', '粤菜', 160, '11:00-14:30,17:00-21:30', 4.5],
    ['银记肠粉', '小吃', 30, '07:00-22:00', 4.4],
    ['太二酸菜鱼', '川菜', 90, '11:00-22:00', 4.3],
    ['素社素食', '素食', 100, '11:30-21:00', 4.2],
  ],
  重庆: [
    ['珮姐老火锅', '火锅', 130, '11:00-02:00', 4.8],
    ['陶然居', '川菜', 120, '11:00-14:00,17:00-21:30', 4.7],
    ['好又来酸辣粉', '小吃', 20, '08:00-22:00', 4.6],
    ['洞子老火锅', '火锅', 120, '11:30-23:30', 4.5],
    ['九园包子', '小吃', 25, '06:30-20:00', 4.4],
    ['磁器口毛血旺', '川菜', 90, '10:00-21:00', 4.4],
    ['江湖菜烧烤夜市', '烧烤', 70, '18:00-03:00', 4.3],
    ['慈云寺素斋', '素食', 60, '11:00-14:00', 4.2],
  ],
}

// —————————————— 景点 ——————————————
// [名称, 门票, 游览时长, 闭馆日, 无障碍, 评分]
type A = [string, number, number, string | null, boolean, number]

const ATTRACTIONS_BY_CITY: Record<string, A[]> = {
  北京: [
    ['故宫博物院', 60, 4, '周一', true, 4.9],
    ['八达岭长城', 40, 5, null, false, 4.8],
    ['颐和园', 30, 3.5, null, true, 4.7],
    ['天坛公园', 15, 2.5, null, true, 4.6],
    ['中国国家博物馆', 0, 3, '周一', true, 4.6],
    ['南锣鼓巷', 0, 1.5, null, true, 4.4],
    ['798 艺术区', 0, 2, null, true, 4.3],
  ],
  上海: [
    ['外滩', 0, 2, null, true, 4.9],
    ['上海博物馆', 0, 3, '周一', true, 4.8],
    ['豫园', 40, 2, '周一', false, 4.7],
    ['东方明珠', 199, 2, null, true, 4.6],
    ['上海迪士尼乐园', 599, 8, null, true, 4.6],
    ['田子坊', 0, 1.5, null, false, 4.4],
    ['朱家角古镇', 0, 4, null, false, 4.3],
  ],
  杭州: [
    ['西湖', 0, 3, null, true, 4.9],
    ['灵隐寺', 75, 2.5, null, false, 4.8],
    ['西溪湿地', 80, 3, null, true, 4.6],
    ['浙江省博物馆', 0, 2, '周一', true, 4.6],
    ['宋城', 320, 4, null, true, 4.5],
    ['河坊街', 0, 1.5, null, false, 4.4],
    ['龙井村', 0, 2, null, false, 4.3],
  ],
  成都: [
    ['大熊猫繁育研究基地', 55, 3, null, true, 4.9],
    ['四川博物院', 0, 2.5, '周一', true, 4.8],
    ['都江堰', 80, 4, null, false, 4.7],
    ['宽窄巷子', 0, 2, null, true, 4.6],
    ['武侯祠', 50, 2, null, true, 4.5],
    ['杜甫草堂', 50, 2, '周二', true, 4.4],
    ['青城山', 80, 5, null, false, 4.3],
  ],
  西安: [
    ['陕西历史博物馆', 0, 3, '周一', true, 4.9],
    ['秦始皇兵马俑', 120, 4, null, true, 4.9],
    ['大雁塔', 40, 1.5, null, false, 4.7],
    ['西安城墙', 54, 2.5, null, false, 4.7],
    ['大唐不夜城', 0, 2, null, true, 4.6],
    ['华清宫', 120, 3, null, false, 4.5],
    ['回民街', 0, 1.5, null, true, 4.4],
  ],
  厦门: [
    ['鼓浪屿', 35, 5, null, false, 4.9],
    ['南普陀寺', 0, 2, null, true, 4.7],
    ['厦门大学', 0, 2, null, true, 4.6],
    ['环岛路', 0, 2, null, true, 4.6],
    ['曾厝垵', 0, 2, null, false, 4.5],
    ['胡里山炮台', 25, 1.5, null, false, 4.3],
    ['厦门科技馆', 70, 3, '周一', true, 4.3],
  ],
  广州: [
    ['广州塔', 150, 2, null, true, 4.8],
    ['陈家祠', 10, 1.5, '周一', false, 4.7],
    ['沙面岛', 0, 1.5, null, true, 4.6],
    ['长隆野生动物世界', 300, 6, null, true, 4.6],
    ['越秀公园', 0, 2, null, false, 4.4],
    ['广东省博物馆', 0, 2.5, '周一', true, 4.4],
    ['北京路步行街', 0, 1.5, null, true, 4.3],
  ],
  重庆: [
    ['洪崖洞', 0, 2, null, false, 4.8],
    ['武隆天生三桥', 135, 6, null, false, 4.7],
    ['长江索道', 30, 1, null, false, 4.6],
    ['磁器口古镇', 0, 2.5, null, false, 4.6],
    ['重庆中国三峡博物馆', 0, 2.5, '周一', true, 4.5],
    ['解放碑步行街', 0, 1.5, null, true, 4.5],
    ['李子坝轻轨穿楼', 0, 1, null, true, 4.3],
  ],
}

const pad = (n: number) => String(n).padStart(2, '0')

function hotelRules(h: Omit<Hotel, 'rules'>): string[] {
  const rules = [h.petsAllowed ? L('可携带宠物', 'pets allowed') : L('禁止携带宠物', 'no pets')]
  if (h.minNights > 1) rules.push(L(`最少连住 ${h.minNights} 晚`, `minimum stay ${h.minNights} nights`))
  rules.push(L(`每间最多入住 ${h.maxOccupancy} 人`, `max ${h.maxOccupancy} guests per room`))
  if (h.barrierFree) rules.push(L('有无障碍客房', 'accessible rooms'))
  return rules
}

export const HOTELS: Hotel[] = Object.entries(HOTELS_BY_CITY).flatMap(([city, rows]) =>
  rows.map(([name, price, rating, roomType, maxOccupancy, minNights, petsAllowed, barrierFree], i) => {
    const h = { id: `H-${CODE_ZH[city]}-${pad(i + 1)}`, city: tr(city), name: tr(name), price, rating, roomType: tr(roomType), maxOccupancy, minNights, petsAllowed, barrierFree }
    return { ...h, rules: hotelRules(h) }
  }),
)

export const RESTAURANTS: Restaurant[] = Object.entries(RESTAURANTS_BY_CITY).flatMap(([city, rows]) =>
  rows.map(([name, cuisine, avgCost, hours, rating], i) => ({ id: `R-${CODE_ZH[city]}-${pad(i + 1)}`, city: tr(city), name: tr(name), cuisine: tr(cuisine), avgCost, hours, rating })),
)

export const ATTRACTIONS: Attraction[] = Object.entries(ATTRACTIONS_BY_CITY).flatMap(([city, rows]) =>
  rows.map(([name, ticket, duration, closedOn, barrierFree, rating], i) => ({
    id: `A-${CODE_ZH[city]}-${pad(i + 1)}`,
    city: tr(city),
    name: tr(name),
    ticket,
    duration,
    closedOn: closedOn && tr(closedOn),
    barrierFree,
    rating,
  })),
)

export const HOTEL_BY_ID = new Map(HOTELS.map((h) => [h.id, h]))
export const RESTAURANT_BY_ID = new Map(RESTAURANTS.map((r) => [r.id, r]))
export const ATTRACTION_BY_ID = new Map(ATTRACTIONS.map((a) => [a.id, a]))

// —————————————— 时间 ——————————————

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
export const fmtMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`

/** 餐厅在 slot（分钟）开始吃一顿饭（1 小时）时是否营业 */
export function openFor(hours: string, slot: number, minutes = 60): boolean {
  return hours.split(',').some((range) => {
    const [a, b] = range.split('-').map((s) => toMin(s.trim()))
    const close = b <= a ? b + 24 * 60 : b
    return a <= slot && slot + minutes <= close
  })
}
