/**
 * Nova 科技帮助中心文档：RAG 相关关卡共用的知识库。
 * 每篇文档有稳定的 id，回答时用 [id#块编号] 标注出处。
 */
import { L } from '../../engine/locale'

export interface Doc {
  id: string
  title: string
  text: string
}

const NOVA_DOCS_ZH: Doc[] = [
  {
    id: 'faq-warranty',
    title: '保修政策',
    text: 'Nova 全系产品自签收之日起计算保修期。智能空调 X1 整机保修 3 年，压缩机保修 10 年。智能门锁 L2 整机保修 2 年，电子元件保修 3 年。扫地机器人 R5 整机保修 2 年，电池保修 1 年，滚刷、边刷、滤网属于易耗件，不在保修范围内。保修无需纸质发票，凭 Nova 账号中的订单记录即可申请。人为损坏、私自拆机、进水不在保修范围内。',
  },
  {
    id: 'faq-returns',
    title: '退货与退款',
    text: '签收后 7 天内可无理由退货，商品需保持完好、配件齐全。因质量问题退货的，往返运费由 Nova 承担；无理由退货的，寄回运费由用户承担。已发货但未签收的订单不能取消，可在签收后申请退货。退款在仓库验收后原路退回，一般 3 到 5 个工作日到账；VIP 客户退款优先处理，1 个工作日内完成。',
  },
  {
    id: 'faq-shipping',
    title: '配送说明',
    text: '订单付款后 48 小时内发货，默认使用顺丰或京东物流。偏远地区配送时间可能延长 2 到 3 天。大件商品（智能空调 X1）由物流公司预约送货上门，送货前会电话联系。订单发货后，可在 App 的“我的订单”页面查看物流轨迹。如需修改收货地址，请在发货前联系在线客服。',
  },
  {
    id: 'faq-offline',
    title: '设备离线排查',
    text: 'App 显示设备离线时，请按以下步骤排查：第一步，确认设备通电且指示灯正常；第二步，确认家中路由器可以正常上网；第三步，Nova 设备只支持 2.4GHz Wi-Fi，若路由器为双频合一，请在路由器后台拆分 2.4G 和 5G 信号；第四步，在 App 中长按设备卡片，选择“重新配网”。仍然离线的，请联系在线客服并提供设备序列号。',
  },
  {
    id: 'x1-manual',
    title: '智能空调 X1 使用手册',
    text: '智能空调 X1 支持制冷、制热、除湿、送风四种模式，温度调节范围 16 到 30 度。可通过 Nova App、遥控器以及小度、天猫精灵音箱进行语音控制。睡眠模式会在入睡后每小时自动升高 1 度。X1 的过滤网建议每两周清洗一次，清洗时用清水冲洗并阴干，切勿暴晒。室外机周围 50 厘米内不要堆放杂物。',
  },
  {
    id: 'l2-manual',
    title: '智能门锁 L2 使用手册',
    text: '智能门锁 L2 支持指纹、密码、NFC 门卡、机械钥匙和 App 远程五种开锁方式，最多可录入 100 个指纹和 50 组密码。L2 使用 8 节 5 号电池，正常使用约 10 到 12 个月，电量低于 20% 时 App 会推送提醒。电池耗尽时，可用充电宝连接锁体底部的 Type-C 应急供电口临时供电，再用指纹或密码开门。锁体被暴力撬动时会发出约 85 分贝的报警声，并推送到手机。',
  },
  {
    id: 'r5-manual',
    title: '扫地机器人 R5 使用手册',
    text: '扫地机器人 R5 采用激光导航，首次使用会自动建图，建图完成后可在 App 中划分房间、设置禁区。R5 电量低于 15% 时会自动返回充电座，充满约需 4 小时，续航约 150 分钟。尘盒建议每次清扫后清理，滚刷每周清理一次缠绕的毛发。家中有宠物时，可在 App 中开启“宠物模式”，提高吸力并避开宠物粪便。',
  },
  {
    id: 'bulb-manual',
    title: '智能灯泡套装使用手册',
    text: '智能灯泡套装包含 4 个 E27 螺口灯泡，单个功率 9 瓦，支持 1600 万种颜色和 2700K 到 6500K 色温调节。灯泡首次通电后连续开关 3 次即可进入配网状态。可在 App 中设置定时开关、日出唤醒和音乐律动效果。灯泡不适用于浴室等潮湿环境，也不能搭配调光开关使用。',
  },
  {
    id: 'app-account',
    title: '账号与家庭共享',
    text: 'Nova App 支持手机号注册登录。一个家庭最多可以邀请 10 名成员，成员可以控制家中所有设备，但只有家庭管理员可以删除设备和修改自动化场景。在“我的 → 家庭管理”中可以发送邀请链接，链接 24 小时内有效。如需注销账号，请在“设置 → 账号与安全”中提交申请，注销后数据将在 15 天后彻底删除。',
  },
  {
    id: 'install-service',
    title: '上门安装服务',
    text: '智能空调 X1 和智能门锁 L2 提供免费上门安装服务，安装师傅会在签收后 24 小时内电话预约。可预约的上门时间为每天 9 点到 21 点，周末和节假日照常服务。门锁安装需要门厚在 40 到 120 毫米之间；空调安装如需额外铜管或高空作业，按官方收费标准另行收费，师傅会在施工前告知。',
  },
  {
    id: 'privacy',
    title: '隐私与数据安全',
    text: 'Nova 设备的使用数据经过加密后存储在国内的数据中心。门锁的开锁记录只保存在用户账号下，Nova 员工无权查看。摄像头类设备的视频默认只在本地存储，开通云存储后才会上传。用户可以在 App 中导出个人数据，或申请删除全部数据。Nova 不会向第三方出售用户数据。',
  },
]

const NOVA_DOCS_EN: Doc[] = [
  {
    id: 'faq-warranty',
    title: 'Warranty policy',
    text: "The warranty on every Nova product starts on the day it is delivered. Smart AC X1: 3 years on the whole unit, 10 years on the compressor. Smart Lock L2: 2 years on the whole unit, 3 years on electronic components. Robot Vacuum R5: 2 years on the whole unit, 1 year on the battery; the main brush, side brush and filter are consumables and not covered. No paper invoice is needed: the order record in your Nova account is enough to file a claim. Damage caused by misuse, unauthorized disassembly or water is not covered.",
  },
  {
    id: 'faq-returns',
    title: 'Returns and refunds',
    text: 'Items can be returned for any reason within 7 days of delivery, as long as they are undamaged and complete with all accessories. For returns due to quality issues, Nova pays shipping both ways; for no-reason returns, the customer pays return shipping. Orders that have shipped but not been delivered cannot be cancelled; request a return after delivery instead. Refunds go back to the original payment method after the warehouse inspects the item, usually within 3 to 5 business days. VIP refunds are prioritized and completed within 1 business day.',
  },
  {
    id: 'faq-shipping',
    title: 'Shipping',
    text: 'Orders ship within 48 hours of payment, by SF Express or JD Logistics by default. Delivery to remote areas may take 2 to 3 extra days. Large items (Smart AC X1) are delivered to your door by appointment, and the carrier will call before delivery. Once an order ships, you can track it on the "My Orders" page in the app. To change the shipping address, contact online support before the order ships.',
  },
  {
    id: 'faq-offline',
    title: 'Troubleshooting offline devices',
    text: 'If the app shows a device as offline, go through these steps. Step 1: make sure the device is powered and its indicator light looks normal. Step 2: make sure your home router is online. Step 3: Nova devices only support 2.4GHz Wi-Fi; if your router merges both bands under one name, split the 2.4G and 5G networks in the router settings. Step 4: in the app, long-press the device card and choose "Reconnect to Wi-Fi". If it is still offline, contact online support with the device serial number.',
  },
  {
    id: 'x1-manual',
    title: 'Smart AC X1 user manual',
    text: 'The Smart AC X1 has four modes: cooling, heating, dehumidifying and fan, with a temperature range of 16 to 30 degrees. It can be controlled from the Nova App, the remote, or by voice through Xiaodu and Tmall Genie speakers. Sleep mode raises the temperature by 1 degree every hour after you fall asleep. Clean the X1 filter every two weeks: rinse it with clean water and let it dry in the shade, never in direct sunlight. Keep the area within 50 cm of the outdoor unit clear.',
  },
  {
    id: 'l2-manual',
    title: 'Smart Lock L2 user manual',
    text: 'The Smart Lock L2 unlocks five ways: fingerprint, passcode, NFC card, mechanical key and remotely from the app. It stores up to 100 fingerprints and 50 passcodes. The L2 runs on 8 AA batteries, which last about 10 to 12 months in normal use; the app sends a reminder when the battery drops below 20%. If the batteries run out, plug a power bank into the Type-C emergency port at the bottom of the lock for temporary power, then open the door with a fingerprint or passcode. If someone tries to force the lock, it sounds an alarm of about 85 decibels and sends an alert to your phone.',
  },
  {
    id: 'r5-manual',
    title: 'Robot Vacuum R5 user manual',
    text: 'The Robot Vacuum R5 uses laser navigation and maps your home automatically on its first run; once the map is ready you can split it into rooms and set no-go zones in the app. When the battery drops below 15%, the R5 returns to its dock on its own. A full charge takes about 4 hours and gives about 150 minutes of runtime. Empty the dustbin after every cleaning, and remove hair wrapped around the main brush once a week. If you have pets, turn on "Pet mode" in the app to boost suction and avoid pet waste.',
  },
  {
    id: 'bulb-manual',
    title: 'Smart Bulb Kit user manual',
    text: 'The Smart Bulb Kit includes 4 E27 screw-base bulbs, 9 watts each, with 16 million colors and a color temperature range of 2700K to 6500K. After powering a bulb on for the first time, switch it off and on 3 times in a row to enter pairing mode. In the app you can set on/off schedules, sunrise wake-up and music sync effects. The bulbs are not suitable for damp places such as bathrooms, and cannot be used with dimmer switches.',
  },
  {
    id: 'app-account',
    title: 'Accounts and family sharing',
    text: 'You can sign up and log in to the Nova App with a phone number. A household can invite up to 10 members. Members can control every device in the home, but only the household admin can remove devices or edit automations. Send an invite link from "Me → Household"; the link is valid for 24 hours. To delete your account, submit a request under "Settings → Account & Security"; your data is permanently deleted 15 days later.',
  },
  {
    id: 'install-service',
    title: 'Installation service',
    text: 'Free in-home installation is available for the Smart AC X1 and Smart Lock L2. An installer will call to schedule a visit within 24 hours of delivery. Visits can be booked from 9:00 to 21:00 every day, including weekends and public holidays. Lock installation requires a door thickness between 40 and 120 mm. If an AC installation needs extra copper piping or work at height, it is charged separately at the official rates, and the installer will tell you before starting.',
  },
  {
    id: 'privacy',
    title: 'Privacy and data security',
    text: "Usage data from Nova devices is encrypted and stored in data centers in China. A lock's unlock history is stored only under the user's account, and Nova employees cannot see it. Video from camera devices is stored locally by default and is uploaded only if you subscribe to cloud storage. You can export your personal data from the app, or request deletion of all your data. Nova never sells user data to third parties.",
  },
]

export const NOVA_DOCS: Doc[] = L(NOVA_DOCS_ZH, NOVA_DOCS_EN)
