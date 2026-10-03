import { L } from '../../engine/locale'

/** 极光网盘帮助中心（约 40 篇）。updatedAt 很重要：存在新旧两个版本互相矛盾的文档。 */
export interface HelpDoc {
  id: string
  title: string
  category: string
  updatedAt: string
  text: string
}

const HELP_DOCS_ZH: HelpDoc[] = [
  // —— 套餐与价格 ——
  { id: 'plan-free', title: '免费版说明', category: '套餐', updatedAt: '2026-05-10', text: '注册即可使用免费版。免费版提供 20GB 存储空间，单个文件最大 2GB，同时最多 2 台设备登录。免费版的分享链接不支持设置提取码。' },
  { id: 'pricing-2024', title: '会员价格（2024 版）', category: '套餐', updatedAt: '2024-03-01', text: '专业版每月 25 元，年付 240 元，提供 2TB 存储空间。团队版每人每月 40 元。' },
  { id: 'pricing-2026', title: '会员价格（2026 版）', category: '套餐', updatedAt: '2026-04-01', text: '自 2026 年 4 月起调整价格：专业版每月 30 元，年付 288 元，提供 3TB 存储空间。团队版每人每月 45 元，最少 3 人起购。老用户在当前订阅周期内价格不变。' },
  { id: 'plan-pro', title: '专业版权益', category: '套餐', updatedAt: '2026-04-01', text: '专业版单个文件最大 50GB，最多 10 台设备同时登录，支持在线预览 4K 视频、版本历史保留 180 天，回收站保留 90 天。' },
  { id: 'plan-team', title: '团队版说明', category: '套餐', updatedAt: '2026-04-01', text: '团队版最多支持 500 名成员，管理员可以统一分配空间、查看操作审计日志。团队版每位成员享有 1TB 空间，团队另有 10TB 共享空间。' },
  { id: 'plan-enterprise', title: '企业版说明', category: '套餐', updatedAt: '2026-02-20', text: '企业版支持私有化部署和单点登录（SSO），成员数量不限。企业版管理员可以把分享链接有效期设置为永久，并可以强制所有分享链接设置提取码。价格请联系销售。' },
  { id: 'refund', title: '退款政策', category: '账单', updatedAt: '2026-01-15', text: '首次购买会员后 7 天内且使用空间未超过免费额度的，可以申请全额退款。续费订单和团队版订单不支持退款。退款会在 3 到 5 个工作日内原路退回。' },
  { id: 'invoice', title: '开具发票', category: '账单', updatedAt: '2025-11-02', text: '在“账户 → 订单记录”中选择订单即可申请电子发票，支持增值税普通发票和专用发票。专用发票需要上传营业执照，审核需要 1 到 2 个工作日。发票只能在付款后 180 天内申请。' },
  { id: 'auto-renew', title: '取消自动续费', category: '账单', updatedAt: '2025-09-18', text: '在“账户 → 会员管理”中关闭自动续费即可。通过 App Store 购买的会员，需要在 iPhone 的“设置 → Apple ID → 订阅”中取消。到期前 24 小时内取消可能仍会扣费。' },
  { id: 'payment-methods', title: '支付方式', category: '账单', updatedAt: '2025-07-01', text: '支持微信支付、支付宝和银联卡。团队版和企业版还支持对公转账，对公转账到账后 1 个工作日内开通。' },

  // —— 上传与下载 ——
  { id: 'upload-limits', title: '上传限制', category: '上传下载', updatedAt: '2026-04-01', text: '网页端上传单个文件最大 4GB；客户端上传的单文件上限取决于套餐：免费版 2GB，专业版和团队版 50GB。单次最多可选择 1000 个文件上传。' },
  { id: 'upload-resume', title: '断点续传', category: '上传下载', updatedAt: '2025-06-12', text: '客户端支持断点续传，网络中断后重新连接会自动从中断处继续上传。网页端不支持断点续传，刷新页面会导致上传中断。未完成的上传任务会保留 7 天。' },
  { id: 'download-speed', title: '下载速度说明', category: '上传下载', updatedAt: '2025-12-01', text: '极光网盘对所有用户都不限速。如果下载慢，请检查本地网络、关闭代理或 VPN，并尝试切换到客户端下载。客户端支持多线程下载。' },
  { id: 'offline-download', title: '离线下载', category: '上传下载', updatedAt: '2025-08-21', text: '专业版及以上支持离线下载，可以添加 HTTP、HTTPS 和磁力链接，任务完成后文件会保存到“离线下载”文件夹。每天最多添加 50 个离线任务。' },
  { id: 'sync-folder', title: '同步文件夹', category: '上传下载', updatedAt: '2025-10-10', text: '桌面客户端可以把本地文件夹设置为同步文件夹，本地和云端的修改会双向同步。同步冲突时会保留两个版本，文件名后加上“冲突副本”和设备名。' },

  // —— 分享与协作 ——
  { id: 'share-links', title: '分享链接', category: '分享协作', updatedAt: '2026-03-12', text: '分享链接的有效期可以选择 1 天、7 天或 30 天，最长 30 天。付费用户可以为链接设置 4 位提取码。分享者可以随时在“我的分享”中取消分享。' },
  { id: 'share-limits', title: '分享次数限制', category: '分享协作', updatedAt: '2025-05-30', text: '每个账号每天最多创建 200 个分享链接。被举报违规的链接会被立即封禁，多次违规的账号会被限制分享功能。' },
  { id: 'collab-folder', title: '共享文件夹', category: '分享协作', updatedAt: '2026-01-08', text: '共享文件夹可以邀请最多 50 位成员共同编辑，成员权限分为“可查看”和“可编辑”。共享文件夹占用的是创建者的空间。' },
  { id: 'online-edit', title: '在线编辑文档', category: '分享协作', updatedAt: '2025-11-20', text: '支持在线编辑 Word、Excel 和 PPT 文档，多人可以同时编辑，修改实时保存。在线编辑不支持带宏的文件，例如 xlsm。' },
  { id: 'comments', title: '文件评论', category: '分享协作', updatedAt: '2025-04-11', text: '在文件详情页可以添加评论并 @ 其他成员，被 @ 的成员会收到站内通知和邮件提醒。' },

  // —— 文件管理 ——
  { id: 'recycle-bin', title: '回收站', category: '文件管理', updatedAt: '2026-04-01', text: '删除的文件会先进入回收站，免费版保留 10 天，专业版保留 90 天，到期后自动彻底删除。在回收站中可以把误删的文件找回到原来的位置。彻底删除的文件无法恢复。' },
  { id: 'version-history', title: '历史版本', category: '文件管理', updatedAt: '2026-04-01', text: '修改文件后会自动保留历史版本，免费版保留 30 天内的版本，专业版保留 180 天。在文件右键菜单选择“历史版本”即可查看和恢复。' },
  { id: 'search-files', title: '搜索文件', category: '文件管理', updatedAt: '2025-03-14', text: '支持按文件名、文件类型和修改时间搜索。专业版支持全文搜索，可以搜索 PDF、Word 文档中的文字内容。' },
  { id: 'photo-backup', title: '手机相册备份', category: '文件管理', updatedAt: '2025-12-12', text: '在手机 App 中开启“相册自动备份”后，新拍的照片和视频会自动上传。可以选择仅在 Wi-Fi 下备份。实况照片会以原始格式保存。' },
  { id: 'video-preview', title: '视频在线播放', category: '文件管理', updatedAt: '2026-04-01', text: '免费版支持 720P 在线播放，专业版支持 4K。支持 mp4、mkv、mov 等常见格式，播放时支持倍速和外挂字幕。' },

  // —— 账号与安全 ——
  { id: 'account-reset', title: '忘记密码', category: '账号安全', updatedAt: '2025-10-01', text: '在登录页点击“忘记密码”，输入注册的手机号或邮箱，填写收到的验证码后即可设置新密码。验证码 10 分钟内有效。连续 5 次输错验证码，账号会被锁定 30 分钟。' },
  { id: 'two-factor', title: '两步验证', category: '账号安全', updatedAt: '2025-09-09', text: '在“账户 → 安全设置”中可以开启两步验证，支持身份验证器 App 和短信两种方式。开启后在新设备登录需要额外输入动态码。' },
  { id: 'devices', title: '登录设备管理', category: '账号安全', updatedAt: '2026-04-01', text: '在“账户 → 登录设备”中可以查看所有已登录设备并一键下线。超过套餐允许的设备数时，最早登录的设备会被自动下线。' },
  { id: 'security', title: '数据安全', category: '账号安全', updatedAt: '2026-02-01', text: '所有文件在传输时使用 TLS 加密，存储时使用 AES-256 加密，数据中心采用三副本存储。极光网盘员工无法查看用户文件内容。' },
  { id: 'private-vault', title: '隐私保险箱', category: '账号安全', updatedAt: '2025-08-08', text: '隐私保险箱需要单独设置 6 位密码，放入保险箱的文件不会出现在搜索结果和最近文件中。保险箱密码忘记后只能通过人工客服核验身份重置。' },
  { id: 'account-delete', title: '注销账号', category: '账号安全', updatedAt: '2025-12-30', text: '在“账户 → 安全设置 → 注销账号”中提交申请，需要先取消所有自动续费。提交后有 15 天冷静期，冷静期内登录即视为撤销注销；冷静期结束后所有文件将被永久删除。' },
  { id: 'phone-change', title: '更换绑定手机号', category: '账号安全', updatedAt: '2025-07-22', text: '在“账户 → 安全设置”中可以更换绑定手机号，需要同时验证旧手机号和新手机号。旧手机号已停用的，需要上传手持身份证照片由人工审核，审核需要 3 个工作日。' },

  // —— 客户端与开发者 ——
  { id: 'clients', title: '支持的客户端', category: '客户端', updatedAt: '2026-01-20', text: '极光网盘提供 Windows、macOS、iOS、Android 客户端和网页版。暂不提供 Linux 客户端，Linux 用户可以使用网页版或 WebDAV。' },
  { id: 'webdav', title: 'WebDAV 访问', category: '客户端', updatedAt: '2025-11-11', text: '专业版及以上可以开启 WebDAV，在第三方软件中挂载网盘。WebDAV 需要使用单独生成的应用密码，不能使用登录密码。' },
  { id: 'api-limits', title: '开放平台 API 限额', category: '开发者', updatedAt: '2026-03-03', text: '开放平台 API 默认每个应用每分钟 600 次请求，超出会返回 429 错误。企业版可以申请提高限额。上传接口单次请求最大 100MB，大文件需要使用分片上传。' },
  { id: 'api-auth', title: '开放平台鉴权', category: '开发者', updatedAt: '2025-10-25', text: '开放平台使用 OAuth 2.0 授权码模式，access_token 有效期 2 小时，refresh_token 有效期 30 天。' },

  // —— 故障排查 ——
  { id: 'trouble-sync', title: '同步失败怎么办', category: '故障排查', updatedAt: '2025-12-05', text: '同步失败时请先确认客户端是最新版本，再检查文件名是否包含 \\ / : * ? " < > | 等特殊字符，以及路径长度是否超过 260 个字符。仍然失败请在客户端“帮助 → 上传日志”后联系客服。' },
  { id: 'trouble-login', title: '无法登录', category: '故障排查', updatedAt: '2025-11-30', text: '提示“账号或密码错误”请尝试重置密码；提示“设备数超限”请在其他设备上退出登录；提示“账号已被锁定”请等待 30 分钟后重试。' },
  { id: 'trouble-space', title: '空间显示不对', category: '故障排查', updatedAt: '2025-09-27', text: '回收站和历史版本中的文件同样占用空间。清空回收站后，空间统计最多需要 10 分钟刷新。' },
  { id: 'contact', title: '联系客服', category: '其它', updatedAt: '2026-01-01', text: '在线客服的服务时间为每天 9:00 到 22:00。会员用户可以使用专属客服通道，平均响应时间 5 分钟。' },
  { id: 'student', title: '学生优惠', category: '套餐', updatedAt: '2026-04-01', text: '通过学信网认证的在校学生可以以 5 折购买专业版年付，每个账号每年限购一次。' },
]

/** Aurora Drive help center (about 40 articles). updatedAt matters: some old and new articles contradict each other. */
const HELP_DOCS_EN: HelpDoc[] = [
  // —— Plans and pricing ——
  { id: 'plan-free', title: 'Free plan', category: 'Plans', updatedAt: '2026-05-10', text: 'Every new account starts on the Free plan. The Free plan includes 20GB of storage, a 2GB maximum file size, and sign-in on up to 2 devices at a time. Share links on the Free plan cannot have an access code.' },
  { id: 'pricing-2024', title: 'Membership pricing (2024)', category: 'Plans', updatedAt: '2024-03-01', text: 'Pro costs ¥25 per month or ¥240 per year and includes 2TB of storage. Team costs ¥40 per member per month.' },
  { id: 'pricing-2026', title: 'Membership pricing (2026)', category: 'Plans', updatedAt: '2026-04-01', text: 'New prices from April 2026: Pro costs ¥30 per month or ¥288 per year and includes 3TB of storage. Team costs ¥45 per member per month, with a minimum of 3 members. Existing subscribers keep their current price until the end of their billing cycle.' },
  { id: 'plan-pro', title: 'Pro plan benefits', category: 'Plans', updatedAt: '2026-04-01', text: 'Pro raises the maximum file size to 50GB, allows sign-in on up to 10 devices at a time, streams 4K video previews, keeps version history for 180 days and keeps the recycle bin for 90 days.' },
  { id: 'plan-team', title: 'Team plan', category: 'Plans', updatedAt: '2026-04-01', text: 'The Team plan supports up to 500 members. Admins can allocate storage centrally and view audit logs of member activity. Each Team member gets 1TB of storage, plus 10TB of shared team storage.' },
  { id: 'plan-enterprise', title: 'Enterprise plan', category: 'Plans', updatedAt: '2026-02-20', text: 'Enterprise supports on-premises deployment and single sign-on (SSO), with unlimited members. Enterprise admins can make share links permanent and can require an access code on every share link. Contact sales for pricing.' },
  { id: 'refund', title: 'Refund policy', category: 'Billing', updatedAt: '2026-01-15', text: 'You can request a full refund within 7 days of your first membership purchase, as long as your storage use has not exceeded the free quota. Renewals and Team plan orders are not refundable. Refunds go back to the original payment method within 3 to 5 business days.' },
  { id: 'invoice', title: 'Requesting an invoice', category: 'Billing', updatedAt: '2025-11-02', text: 'Go to Account > Orders, pick an order and request an e-invoice. Both standard VAT invoices and special VAT invoices are available. A special VAT invoice requires uploading your business license, and review takes 1 to 2 business days. Invoices can only be requested within 180 days of payment.' },
  { id: 'auto-renew', title: 'Turning off auto-renewal', category: 'Billing', updatedAt: '2025-09-18', text: 'Turn off auto-renewal in Account > Membership. If you bought your membership through the App Store, cancel it on your iPhone in Settings > Apple ID > Subscriptions. If you cancel less than 24 hours before the renewal date, you may still be charged.' },
  { id: 'payment-methods', title: 'Payment methods', category: 'Billing', updatedAt: '2025-07-01', text: 'We accept WeChat Pay, Alipay and UnionPay cards. Team and Enterprise plans can also pay by corporate bank transfer; the plan is activated within 1 business day after the transfer arrives.' },

  // —— Upload and download ——
  { id: 'upload-limits', title: 'Upload limits', category: 'Upload & download', updatedAt: '2026-04-01', text: 'On the web, the maximum upload size for a single file is 4GB. In the desktop and mobile apps the per-file limit depends on your plan: 2GB on Free, 50GB on Pro and Team. You can select up to 1,000 files per upload.' },
  { id: 'upload-resume', title: 'Resumable uploads', category: 'Upload & download', updatedAt: '2025-06-12', text: 'The apps support resumable uploads: after a network drop, the upload continues from where it stopped once you reconnect. The web version does not; refreshing the page interrupts the upload. Unfinished uploads are kept for 7 days.' },
  { id: 'download-speed', title: 'Download speed', category: 'Upload & download', updatedAt: '2025-12-01', text: 'Aurora Drive never throttles downloads, for any user. If downloads are slow, check your local network, turn off any proxy or VPN, and try downloading with the desktop app, which supports multi-threaded downloads.' },
  { id: 'offline-download', title: 'Offline download', category: 'Upload & download', updatedAt: '2025-08-21', text: 'Offline download is available on Pro and above. You can add HTTP, HTTPS and magnet links; finished files are saved to the "Offline downloads" folder. You can add up to 50 offline tasks per day.' },
  { id: 'sync-folder', title: 'Sync folders', category: 'Upload & download', updatedAt: '2025-10-10', text: 'The desktop app can turn a local folder into a sync folder; changes on your computer and in the cloud sync both ways. On a sync conflict both versions are kept, and the file name gets "conflicted copy" plus the device name appended.' },

  // —— Sharing and collaboration ——
  { id: 'share-links', title: 'Share links', category: 'Sharing', updatedAt: '2026-03-12', text: 'A share link can expire after 1 day, 7 days or 30 days; the longest is 30 days. Paid users can protect a link with a 4-digit access code. You can cancel a share at any time in My Shares.' },
  { id: 'share-limits', title: 'Share limits', category: 'Sharing', updatedAt: '2025-05-30', text: 'Each account can create up to 200 share links per day. Links reported for violations are blocked immediately, and accounts with repeated violations lose sharing privileges.' },
  { id: 'collab-folder', title: 'Shared folders', category: 'Sharing', updatedAt: '2026-01-08', text: 'You can invite up to 50 members to edit a shared folder together, as Viewer or Editor. A shared folder uses the storage of the person who created it.' },
  { id: 'online-edit', title: 'Editing documents online', category: 'Sharing', updatedAt: '2025-11-20', text: 'You can edit Word, Excel and PowerPoint files online, with several people editing at once and changes saved in real time. Files with macros, such as xlsm, cannot be edited online.' },
  { id: 'comments', title: 'File comments', category: 'Sharing', updatedAt: '2025-04-11', text: 'On a file\'s details page you can leave comments and @mention other members; mentioned members get an in-app notification and an email.' },

  // —— File management ——
  { id: 'recycle-bin', title: 'Recycle bin', category: 'Files', updatedAt: '2026-04-01', text: 'Deleted files go to the recycle bin first. The Free plan keeps them for 10 days and Pro keeps them for 90 days; after that they are permanently deleted. You can restore a deleted file from the recycle bin to its original location. Permanently deleted files cannot be recovered.' },
  { id: 'version-history', title: 'Version history', category: 'Files', updatedAt: '2026-04-01', text: 'Every time you change a file, earlier versions are kept automatically: 30 days on the Free plan, 180 days on Pro. Right-click a file and choose Version history to view or restore a version.' },
  { id: 'search-files', title: 'Searching files', category: 'Files', updatedAt: '2025-03-14', text: 'You can search by file name, file type and modified date. Pro and above also get full-text search, which finds text inside PDF and Word documents.' },
  { id: 'photo-backup', title: 'Phone photo backup', category: 'Files', updatedAt: '2025-12-12', text: 'Turn on Auto photo backup in the mobile app and new photos and videos upload automatically. You can choose to back up on Wi-Fi only. Live Photos are saved in their original format.' },
  { id: 'video-preview', title: 'Video playback', category: 'Files', updatedAt: '2026-04-01', text: 'The Free plan streams video at 720p and Pro streams at 4K. Common formats such as mp4, mkv and mov are supported, with playback speed control and external subtitles.' },

  // —— Account and security ——
  { id: 'account-reset', title: 'Forgot your password', category: 'Account & security', updatedAt: '2025-10-01', text: 'On the sign-in page, click "Forgot password", enter the phone number or email you signed up with, then enter the verification code you receive and set a new password. The verification code is valid for 10 minutes. After 5 wrong codes in a row, the account is locked for 30 minutes.' },
  { id: 'two-factor', title: 'Two-step verification', category: 'Account & security', updatedAt: '2025-09-09', text: 'Turn on two-step verification in Account > Security, using an authenticator app or SMS. Once it is on, signing in on a new device requires a one-time code.' },
  { id: 'devices', title: 'Managing signed-in devices', category: 'Account & security', updatedAt: '2026-04-01', text: 'Account > Devices lists every signed-in device and lets you sign any of them out. If you exceed the number of devices your plan allows, the device that signed in earliest is signed out automatically.' },
  { id: 'security', title: 'Data security', category: 'Account & security', updatedAt: '2026-02-01', text: 'All files are encrypted with TLS in transit and AES-256 at rest, and our data centers store three replicas of every file. Aurora Drive staff cannot view the contents of your files.' },
  { id: 'private-vault', title: 'Private vault', category: 'Account & security', updatedAt: '2025-08-08', text: 'The private vault has its own 6-digit password. Files in the vault do not appear in search results or recent files. If you forget the vault password, it can only be reset by a human support agent after verifying your identity.' },
  { id: 'account-delete', title: 'Deleting your account', category: 'Account & security', updatedAt: '2025-12-30', text: 'Submit a request in Account > Security > Delete account; you must cancel all auto-renewals first. A 15-day cooling-off period follows: signing in during that period cancels the deletion. When it ends, all your files are permanently deleted.' },
  { id: 'phone-change', title: 'Changing your phone number', category: 'Account & security', updatedAt: '2025-07-22', text: 'Change your linked phone number in Account > Security; both the old and the new number must be verified. If the old number is no longer in service, upload a photo of yourself holding your ID for manual review, which takes 3 business days.' },

  // —— Apps and developers ——
  { id: 'clients', title: 'Supported apps', category: 'Apps', updatedAt: '2026-01-20', text: 'Aurora Drive has apps for Windows, macOS, iOS and Android, plus a web version. There is no Linux app yet; Linux users can use the web version or WebDAV.' },
  { id: 'webdav', title: 'WebDAV access', category: 'Apps', updatedAt: '2025-11-11', text: 'Pro and above can turn on WebDAV to mount the drive in third-party software. WebDAV requires a separately generated app password; your sign-in password will not work.' },
  { id: 'api-limits', title: 'Open API rate limits', category: 'Developers', updatedAt: '2026-03-03', text: 'By default the Open API allows 600 requests per minute per app; requests over the limit return a 429 error. Enterprise customers can apply for a higher limit. A single upload request can be at most 100MB; larger files must use multipart upload.' },
  { id: 'api-auth', title: 'Open API authentication', category: 'Developers', updatedAt: '2025-10-25', text: 'The Open API uses the OAuth 2.0 authorization code flow. An access_token is valid for 2 hours and a refresh_token for 30 days.' },

  // —— Troubleshooting ——
  { id: 'trouble-sync', title: 'Sync is failing', category: 'Troubleshooting', updatedAt: '2025-12-05', text: 'If sync fails, first make sure the app is up to date, then check whether file names contain special characters such as \\ / : * ? " < > | and whether any path is longer than 260 characters. If it still fails, choose Help > Upload logs in the app and contact support.' },
  { id: 'trouble-login', title: "Can't sign in", category: 'Troubleshooting', updatedAt: '2025-11-30', text: 'If you see "Wrong account or password", try resetting your password. If you see "Too many devices", sign out on another device. If you see "Account locked", wait 30 minutes and try again.' },
  { id: 'trouble-space', title: 'Storage usage looks wrong', category: 'Troubleshooting', updatedAt: '2025-09-27', text: 'Files in the recycle bin and in version history also count toward your storage. After you empty the recycle bin, the usage figure can take up to 10 minutes to refresh.' },
  { id: 'contact', title: 'Contacting support', category: 'Other', updatedAt: '2026-01-01', text: 'Live chat support is available every day from 9:00 to 22:00. Members get a priority support channel with an average response time of 5 minutes.' },
  { id: 'student', title: 'Student discount', category: 'Plans', updatedAt: '2026-04-01', text: 'Students verified through CHSI can buy a yearly Pro plan at 50% off, once per account per year.' },
]

export const HELP_DOCS: HelpDoc[] = L(HELP_DOCS_ZH, HELP_DOCS_EN)
