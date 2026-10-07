# 其余页面规格 V1（客户 · 分享 · 我的 · 公司管理 · 顾客目录 · 平台）

视觉规则：`docs/design-system.md`。日常流程：`docs/daily-flow-spec.md`。登录：`docs/auth-spec.md`。代号沿用代号总表。
实现者 Codex；审阅 Claude。**只改布局、入口与文案；业务规则、权限、RPC、RLS 不变**，除非本文明确写出。
每页统一用：G.TOPBAR（标题 + 必要时 G.BACK）、G.NAVBAR（成员日常页）、design-system 的组件。所有 `window.confirm/alert` 改 G.CONFIRM / G.TOAST。

## 0. 路由与入口总览

| 页面 | 路由 | 外壳 | 说明 |
|---|---|---|---|
| CUS / CUE | `/customers` | 日常+导航「客户」 | CUE 为弹层 |
| SHR / SHC | `/catalog-share` | 日常+导航「分享」 | SHC 为二级页（同路由，`?new=1`，或子路由） |
| ME / PRO / SEC | **新增 `/me`**；PRO、SEC 沿用 `/settings` 的能力，拆成 `/me/profile`、`/me/security`（旧 `/settings` 保留并重定向，首次补资料仍用 `?setup=company&next=`） | 日常+导航「我的」 | `/account` 回归纯登录页（AUTH.*）；已登录访问 `/account` 按 auth-spec 路由 |
| ADM | **新增 `/admin`** | 日常（导航「我的」高亮） | 仅正/副管理员 |
| TEAM / INV / RPT | `/team`（TEAM+INV）、**RPT 独立 `/team/report`**（从 `SalesReport` 拆出） | 日常 | |
| BRD / DEF | `/brand`（两个分区） | 日常 | |
| CTG / NUM / IMP / PRC / VIS | `/catalog-settings`，用顶部分段 `?tab=categories|numbers|import|prices|public` | 日常 | VIS 从 `/catalog-share` 的创建区迁到这里 |
| PUB / PUB.INVALID | `/c/<token>` | 无导航 | |
| PLT.* | `/platform` | 无员工导航，自带顶栏 | |

旧入口全部保持可用（旧网址不 404）。`/migration` 保持兼容跳转。

## 1. CUS｜客户通讯录 / CUE｜新增编辑客户（`/customers`）

标题「客户」。搜索框（CUS.SEARCH，防抖 250ms 沿用）+ 筛选图标：有效/包含停用（CUS.STATE_FILTER），管理员多「建立者」（G.EMPLOYEE_FILTER）。右上「＋」圆形按钮 = CUS.ADD。
卡片：姓名（粗）+ 公司 · 电话；点卡片就地展开（CUS.DETAIL）：邮箱、地址、建立者、状态；停用客户整卡 muted +「已停用」chip；他人建立的显示「只读」chip（CUS.CARD.EDIT_SCOPE）。电话/邮箱可点（`tel:`、`mailto:`）。
`⋯`（仅创建者，G.MORE）：编辑客户（CUE 弹层）、停用/恢复（D.CUSTOMER_STATE）。无权限不渲染 `⋯`。
CUE 弹层：姓名 `*`、电话（`+60` 固定前缀同注册规则的号码标准化可选；先只做原样保存）、公司、邮箱、地址；底部「保存客户」；改动后关闭 → D.DISCARD；保存成功 toast「客户已保存，旧报价不会改变」。
分页 50/页 G.PAGE_*；总数 CUS.TOTAL 放在标题下小字。空：「还没有客户」+「新增客户」。
**从 QTE 来的“管理客户”**：当前报价保留（见 FLOW.QUOTE_CONTINUE），客户页顶部不需要特殊提示；返回走导航「报价单」。

## 2. SHR｜分享中心（`/catalog-share`）/ SHC｜新建目录分享

**SHR**：标题「分享」。顶部 SHR.CONTACT 小卡：`我的联系资料：{姓名} · +60 12-345 6789`，右侧「修改」(SHR.PROFILE → `/me/profile`)。主按钮「新建目录分享」（G.PRIMARY_BUTTON，SHR.CREATE）。下面链接列表（分页）：
- 卡片：内部名称（无则「目录链接」）、范围 chip（全部公开 / 指定 N 项）、到期 `到期 2026-10-14`、状态药丸（有效/到期/撤销）；管理员加「分享人」。
- 有效链接按钮行：「复制」（SHR.COPY）、「分享」（G.SHARE_BUTTON，SHR.SEND）、`⋯`：打开顾客目录（SHR.VIEW）、撤销链接（danger，D.LINK_REVOKE）。到期/撤销的卡片无按钮，muted。
- 刷新图标在标题右（SHR.REFRESH）。空：「还没有分享链接」+「新建目录分享」。
**SHC**（G.BACK 返回 SHR）：
1. 范围分段：「全部公开产品」/「挑选产品」（SHC.SCOPE）。
2. 内部链接名称（可选，SHC.NAME）；联系人（只读：姓名 + 号码，缺号码时 G.INLINE_ERROR「请先填写 WhatsApp」+ 链接去 PRO）；「有效期：7 天（固定）」只读文字。
3. 挑选模式：搜索框 + 候选列表（缩略图小、名称、编号、复选框；每页 30，跨页保留；最多 1000，超出 ST.LIMIT toast）；顶部粘性条「已选 N 项 ▾」(SHC.SELECTED_COUNT/SELECTED，展开已选列表，可逐项 ✕ 或「清空」→ D.SELECTION_CLEAR)。不可公开的产品不出现在候选里（它们在 VIS 管理）。
4. 底部固定「生成 7 天链接」（SHC.CREATE）。成功后页面变结果态：链接框 + 到期时间 + 三个按钮「复制」「分享」（绿）「打开」；「完成」回 SHR。
5. 离开且有未完成挑选 → D.DISCARD。
管理员对产品公开状态的修改**不再放在这里**（见 §6 VIS）。

## 3. ME｜我的（`/me`）

自上而下：
1. **个人摘要卡**：头像圆（首字母）+ 姓名（粗）+ 邮箱 + 角色 chip（正管理员/副管理员/销售员）。
2. **管理员快捷区**（仅正/副管理员，销售员完全不渲染；已确认）：两个并排大卡「销售概览」（→ `/team/report`）、「员工管理」（→ `/team`）。其下一行次要文字链接「更多公司设置 →」（→ ADM）。
3. **当前公司卡**：公司名 +「切换公司」（有多家公司时，G.COMPANY_PICKER；D.COMPANY_CHANGE）。公司读取失败 → ST.ERROR +「重新读取」（ME.RELOAD_COMPANIES）。
4. **列表菜单**（箭头行，高 56）：个人资料（→ PRO）、账号安全（→ SEC）。
5. **平台管理**（仅平台授权者，ME.PLATFORM；该行文字「平台管理」）。
6. 底部「退出登录」（danger 次要按钮，ME.LOGOUT）→ 有未保存报价 → D.LOGOUT：「退出会放弃当前报价。」。
7. 版本号小字（读 package.json 版本，可选）。

## 4. PRO｜个人资料 / SEC｜账号安全

**PRO**（`/me/profile`，G.BACK→ME）：姓名 `*`；WhatsApp（左固定「+60」，输入其余号码；规则与 auth-spec 的号码标准化一致，保存格式 `+60…`；已存的非 +60 号码原样显示为只读前缀+数字，不强行改）；「保存资料」（PRO.SAVE，未改动时禁用）。改动已有号码 → D.PHONE_CHANGE：「更改号码会让你之前分享的目录链接失效。」。首次补资料模式（AUTH.PROFILE_FIRST）：顶部一句「请先补齐资料再进入公司」，隐藏返回箭头，保存后 PRO.CONTINUE 进入 `next`。
**SEC**（`/me/security`）：三个折叠分区。
- 密码：当前密码、新密码（6–128，眼睛切换）、确认；「修改密码并重新登录」。
- 邮箱：当前邮箱只读；若有待验证新邮箱显示 chip「待验证：x@y」；新邮箱输入 +「发送验证邮件」。
- 双重验证：状态（未设置/已启用）；设置流程 = 二维码 + 手动密钥（可复制）+ 6 位码输入 +「验证」。平台负责人未启用时在此页顶部显示醒目提示。
所有修改按钮在 ST.SAVING 时禁用；成功 G.TOAST；失败 G.INLINE_ERROR。

## 5. ADM｜公司管理（`/admin`，仅管理员）

标题「公司管理」，顶部公司名 + 角色。三个分组卡（每项一行，图标 + 名称 + 一句话说明 + 箭头）：
- **团队与业绩**：员工管理（TEAM）、销售概览（RPT）。
- **产品工具**：产品分类（CTG）、产品编号规则（NUM）、批量新增产品（IMP）、批量调价（PRC）、产品公开设置（VIS）。
- **公司与报价**：公司资料与品牌（BRD）、报价默认设置（DEF）。
非管理员访问 → ST.NO_ACCESS 并回 CAT。

## 6. 管理子页

通用：G.BACK→ADM；标题；表单类页面底部固定主按钮；有改动离开 → D.DISCARD。

### TEAM / INV（`/team`）
成员列表：头像首字母、姓名（`我` chip 标本人）、邮箱、角色 chip、状态 chip（有效/停用）。每行右侧 `⋯`（受角色边界保护，不可用项不渲染）：设为/撤销副管理员（D.ROLE_CHANGE）、停用/恢复（D.EMPLOYEE_*）、移除（danger，D.EMPLOYEE_REMOVE）。销售员行下有开关「产品管理权限」（TEAM.PRODUCT_PERMISSION，改动走 D.PRODUCT_PERMISSION；管理员行显示固定「始终拥有」文字，无开关）。
顶部「邀请员工」（TEAM.INVITE）→ INV 弹层：邮箱输入 +「生成邀请链接」→ 结果态：链接框 +「复制链接」；说明固定一句「链接需你自己发送给对方，系统不会自动发邮件」。列表区块「邀请记录」：邮箱、状态（待接受/已接受/已撤销/已过期）、到期；待接受行 `⋯`→ 撤销（D.INVITE_REVOKE）。刷新图标在标题右（TEAM.REFRESH）。成员数 TEAM.COUNT 在标题下。

### RPT｜销售概览（`/team/report`）
顶部日期区间（开始/结束，日期规则沿用现有报表接口）+「查询」（RPT.QUERY）。结果：员工排行卡片（排名圆章、姓名、状态 chip）；每卡显示：报价数、成交单数、成交金额（粗）、已收款金额、成交货物量（分单位列出，不含服务）；成交金额横向条形（RPT.BAR，条长相对最大值；navy）。底部固定一行小字口径说明（RPT.DATA_NOTE：「成交 = Success + Paid；已收款为人工标记，非对账」）。空：「这段时间没有数据」。

### BRD｜公司资料与品牌 / DEF｜报价默认设置（`/brand`）
两个分区（顶部分段「公司品牌」「报价默认」）。BRD：公司名称 `*`、联系方式、Logo（预览方块 + 「上传/更换」「移除」；图片读取失败 ST.IMAGE_ERROR 占位）。DEF：编号前缀、流水号位数、默认有效天数、默认付款条款、默认备注/T&C；一句固定提示「只影响新报价」。每分区各自「保存」；「重新读取」放标题 `⋯`。

### CTG｜产品分类
列表：名称、产品数、状态；顶部输入 + 「新增」；行 `⋯`：重命名（行内编辑，保存/取消）、停用/恢复（D.CATEGORY_CHANGE，说明「不会删除产品」）。

### NUM｜产品编号规则
分段「自动编号/必须手填」；自动时显示前缀、位数、下个流水号（只在自动时显示）；实时预览 `TEST-0001`；「保存规则」。

### IMP｜批量新增产品
步骤条（1 选文件 2 对应字段 3 检查预览 4 导入）。选文件（CSV；模板下载 IMP.TEMPLATE）→ 分隔符 + 字段对应（编号、名称、价格、单位、分类、说明、标签、类型：**类型列保留为可选对应项**，仅为兼容旧文件）→「预览检查」→ 摘要（总行/可新增/错误/已有编号，色块）+ 预览表前 20 行（行号、编号、名称、状态、原因）→「确认新增」（D.IMPORT_APPLY）→ 进度条 + 「批次结束后暂停/继续」+ 完成后「下载完整结果」。重选文件/重新预览 → D.IMPORT_RESET。无图片批量上传。

### PRC｜批量调价
顶部分段「调价表」「CSV 文件」（默认调价表）。调价表：左右两区改为上下：①候选搜索 + 分类 + 候选列表（「加入」「加入本页」）②待调价表（行：编号、名称、原价、新价输入、状态/原因、移除）。工具条：导入 CSV 到表、导出、检查、重读原价（D.PRICE_REBASE）、清空（D.PRICE_CLEAR）、「提交调价」（D.PRICE_APPLY，主按钮，固定底部）。提交中显示进度 + 暂停/继续；完成后 新任务（D.PRICE_RESET）/ 下载结果。两个分页分别用 `PRC.PRODUCTS` 与 `PRC.DRAFT_LIST` 前缀，文案区分「候选第 X 页」「待调价第 X 页」。CSV 模式：选文件→选列→预览新旧价（前 20 行）→确认调价，同样的暂停/继续/结果。所有冲突、锁定、部分成功（ST.PARTIAL_RESULT）、重试保护保留。

### VIS｜产品公开设置（`?tab=public`）
搜索 + 列表（编号、名称、开关「允许公开」）；顶部统计「已公开 N / 匹配 M」；批量按钮「允许公开全部搜索结果」「停止公开全部搜索结果」（D.BULK_PUBLIC，确认中显示实际影响数量，最多 10,000）。停止公开不是删除，文案说明。

## 7. PUB｜顾客产品目录（`/c/<token>`）

无登录、无导航、**无价格**（数据层已不返回价格，UI 不得出现价格位）。
- 顶部：公司名（大）+ 联系人卡（销售员姓名 + 「WhatsApp 联系」，号码仅用于链接，不显示全号码也可；沿用现有行为）；右上到期 `有效至 2026-10-14`。
- 搜索框 + 分类下拉（仅链接可见的分类）；「共 N 件」。
- 2 列卡片：缩略图、名称、编号、单位；点开展开详情（大图、说明、标签、分类）；详情内「WhatsApp 询价」（G.SHARE_BUTTON 绿，带产品编号与名称预填文案）。商品/服务类型在顾客端不显示。
- 图片失败：灰块 + 小字「图片暂时无法显示」（PUB.IMAGE_STATE）。底部 `Powered by JomSales`（PUB.FOOTER）。刷新图标在顶部。
- **PUB.INVALID**：整页居中：图标 +「这个链接已失效」+「可能已过期或被撤销，请向分享给你的人索取新链接」+「重新检查」按钮。不显示公司、联系人、产品。

## 8. PLT｜平台后台（`/platform`，仅平台负责人）

深色顶栏标识「平台管理」以区别商家界面；无员工导航；G.BACK→ME。
- **PLT.LIST**：权限/验证状态条（PLT.ACCESS_STATE；未通过 → 说明 +「重新检查」+「前往双重验证」）；搜索 +「查询」；「＋ 开通公司」；公司卡：名称、正管理员邮箱、配套 chip、服务状态药丸 + 截止、成员/产品数、图片用量估算；点卡 → PLT.COMPANY。分页。
- **PLT.NEW**：公司名称 `*`、正管理员邮箱 `*`；「开通并生成管理员邀请」→ 结果态：邀请链接 +「复制」+ 有效期；固定提示「链接需自行发送」。
- **PLT.COMPANY**：分区折叠——公司设置（服务状态、截止、配套、成员/产品额度；预留项折叠成「高级（预留）」且标注未生效）、成员列表（姓名/邮箱/身份/状态；`⋯` 停用/恢复/移除 → D.PLATFORM_MEMBER）、正管理员（更换 → D.PRIMARY_CHANGE；重新邀请）、平台操作记录（折叠，时间/类型/详情）。底部「保存公司设置」。

## 9. 状态与保护（全站）
ST.LOADING 用骨架；ST.ERROR 在区块内带「重试」；ST.NO_ACCESS 整页；ST.EXPIRED 用于邀请/目录/服务到期；所有危险操作走 D.* 且用 G.CONFIRM；成功提示用 G.TOAST；不新增任何业务按钮或权限。

## 10. 验收清单
1. 路由表中每个页面可达，旧网址（`/account`、`/settings`、`/team`、`/brand`、`/catalog-settings`、`/catalog-share`、`/c/<token>`、`/platform`）不 404。
2. 销售员：ME 无管理员快捷区，访问 `/admin`、`/team`、`/brand`、`/catalog-settings` 得到 ST.NO_ACCESS，且后端仍拒绝。
3. 管理员：ME 顶部有「销售概览」「员工管理」，一次点击到达。
4. VIS 已移出分享创建页；SHC 只有挑选与生成。
5. PUB 页面 DOM 中无价格；PUB.INVALID 不泄露公司/联系人。
6. 所有确认走 G.CONFIRM；全站无 `window.confirm/alert`。
7. 对照代号总表：每个代号都有对应元素或在本文说明合并/移除（IMP 的类型列、TMP/PDE 的类型已按 daily-flow-spec 处理）。
8. `npm test`、`npm run build`、`npm run check:supabase`、浏览器回归通过；390px 无横向滚动。

## 11. 需要负责人确认/补画（Claude 无法代劳）
- Figma：ME、ADM、TEAM、RPT、SHR/SHC、CUS 等页面稿；若与本文不同以 Figma 为准。
- Supabase 控制台设置项见 `docs/auth-spec.md` §6。
