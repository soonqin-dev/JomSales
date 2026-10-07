# 日常流程规格 V1（产品 · 报价 · 报价记录）

范围：CAT、PRD、PDE、QTE、TMP、CPK、QTL、QTR + `FLOW.QUOTE_CONTINUE`。
视觉与外壳见 `docs/design-system.md`（先读）。登录相关见 `docs/auth-spec.md`。代号沿用代号总表。
实现者 Codex；审阅 Claude。**业务规则不变**（权限、RLS、报价状态、自动保存、回收站 15 天等），本文只改布局、流程与上述已确认项。

## 0. 已确认决定（来自负责人）

1. 登录后管理员/销售员都先进 CAT。
2. 底部「报价单」= **当前报价 QTE**；「报价记录」(QTL) 从 CAT 报价条右侧按钮进入，也可从 QTE 顶部进入。
3. 卡片右下「＋」一键加入报价；同一商品再加 → 合并为一行、数量 +1；导航徽章 = 行数（不是数量总和）。点卡片其他位置仍开 PRD。
4. 编辑/删除收进卡片 `⋯`（G.MORE），仅产品管理员可见；无权限整个 `⋯` 不渲染。
5. PRD（内部详情）**显示价格**。仅「对外卡片图」不含价格。图片右下角下载图标改为文字按钮「下载卡片」。
6. PDE 去掉「商品/服务」选择；新增一律 `is_service=false`；**编辑旧服务类产品时保留原值不改**。数据库、CSV 类型列、RPT 口径、旧数据不动。
7. 刷新 = 顶部小图标，只刷新产品列表，不动当前报价。
8. 同公司内换页：未完成报价只留在页面内存；刷新/关闭不恢复；不用 localStorage/sessionStorage/IndexedDB。
9. 只有真正“替换当前报价”（选另一张、复制、新建、换公司、退出）才弹确认；换页不弹。
10. 下载/分享报价都自动保存，无保存按钮；成功 → 回 CAT 且当前报价清空为新单；保存失败/取消分享 → 内容保留。
11. 管理员的「销售概览/员工管理」入口在 ME 页顶部（见 `docs/pages-spec.md`），不在本流程。

## 1. FLOW.QUOTE_CONTINUE（本阶段唯一的架构改动）

**问题**：报价草稿现在存在 `useCloudQuotation(context)`，该 hook 挂在 `/cloud` 页面里，离开页面即丢失。
**要求**：
- 新建路由组（如 `app/(member)/layout.js`），把日常页面放进去：`/cloud`、`/cloud/quote`(QTE，新)、`/quotations`、`/customers`、`/catalog-share`、`/me`(新，聚合 /account 与 /settings 的入口)。**现有 URL 不变**（路由组括号不进 URL）；`/account`、`/settings`、`/team` 等保持原路径，可以在同一布局内或外，按 §6 外壳显示规则。
- 布局内放 `CompanyQuoteProvider`：持有当前公司上下文 + 当前报价（即原 hook 的状态）+ 导航外壳。页面通过 `useCurrentQuote()` 读写。客户端路由跳转（`<Link>`、`router.push`）不卸载 provider。
- **清空时机**：切换公司、退出登录、成功完成（下载/分享成功）、用户确认“替换”。其余都保留。
- **整页刷新类跳转**（`window.location.assign/replace`、输入网址、浏览器刷新）会丢内存——这是接受的。因此：所有日常页面内的跳转必须用客户端路由；`beforeunload` 保护保留（有未保存内容时提示）。
- 现有“URL 参数 `quote`/`duplicate` 一次性读取后 `history.replaceState` 清除”的交接保留；provider 已挂载时（从 QTL 点进来）要处理：读取参数 → 若当前有未保存内容先走 D.QUOTE_REPLACE → 载入 → 清参数。
- 现有 document 级点击捕获守卫（离开前 confirm）**移除**：换页不再询问；只在上面第 9 条情形询问，并改用 G.CONFIRM 弹层，不用 `window.confirm`。
- 公司切换器（G.COMPANY_PICKER）选另一家公司且当前有未保存报价 → D.COMPANY_CHANGE：「切换公司会放弃当前报价。」[留在这里] [放弃并切换]。
- 多标签页：每个标签页各自一份内存，互不同步（不做处理）。

验收：CAT 加 2 个产品 → 点导航「客户」→ 点「报价单」→ 仍是 2 行；点「产品」→ 徽章仍为 2；刷新浏览器 → 徽章消失（可接受）。

## 2. CAT｜产品目录（`/cloud`）

自上而下：
1. **头部**（design-system §3.2）：头像 + 角色-姓名 + 邮箱；公司药丸 + CAT.TOTAL 药丸 + 右侧 CAT.REFRESH 小图标按钮（刷新中旋转；失败 G.INLINE_ERROR「刷新失败，点此重试」）。
2. **搜索栏**：搜索框（左放大镜、右 ✕ 清除=CAT.CLEAR_SEARCH）+ 右侧「筛选」图标文字（G.FILTER）。点筛选 → 下拉列表：**全部 ✓ / 公司分类… / 未分类**（单选，选中打勾，选后收起并重新查询，保留搜索词）。
3. **「＋ 新增产品」** 整行 navy 药丸大按钮（CAT.ADD_PRODUCT）——**仅产品管理员**；无权限不渲染，列表上移。
4. **报价条 CAT.QUOTE_BAR**（紧凑一行）：左：`正在编辑：新报价`（或 `正在编辑：Q-0007`）+ 状态药丸 `未保存`/`已保存`（QUOTE_BAR.IDENTITY / SAVE_STATE）；复制单加 `复制自 Q-0003`（COPIED_FROM）；右：「报价记录」次要小药丸（→ QTL）。整条点击（除右侧按钮）= 进入 QTE。无任何行且未编辑原单时，只显示 `新报价` + 「报价记录」。
5. **产品列表**（2 列网格，每页 30；CAT.LIST）。卡片 CAT.CARD：
   - 图片区正方形（无图 `--ph` 占位），右上角「＋」圆（navy，CAT.ADD_QUOTE，点后 ✓ 动画 600ms；点击区 44px 但不可遮住图片主体太多）。
   - 名称（粗，2 行省略）、编号 SKU（muted 小字）。
   - 底行：价格 `RM20.00 / 件`（粗）；右下 `⋯`（仅产品管理员；菜单：编辑产品 / 删除产品〔danger〕）。
   - 去掉卡片上的 CAT.CARD.TYPE 文字（旧服务产品在 PRD 里仍显示「服务」小标）。
6. **分页** G.PAGE_*；列表为空：ST.EMPTY（有权限者带「新增产品」按钮）；搜索无果：ST.NO_RESULTS「没有符合的产品」+「清除搜索」。
7. **CAT.LAST_PDF**（刚生成文件结果区）：保留，放在报价条下，卡片样式；含 CAT.DOWNLOAD_LAST_PDF / CAT.SHARE_LAST_PDF（分享为 G.SHARE_BUTTON）。
8. **移除**：原 hero 里的「公司账号 · 注册/登录」链接；原独立「重新读取报价与品牌」按钮（改为 QTE 内次要入口 QTE.RELOAD）；页内长说明文字。
9. G.NAVBAR（产品高亮）。

**加入报价规则（CAT.ADD_QUOTE / PRD.ADD_QUOTE 共用）**：调用现有 `quotation.add(product)`（已合并同产品、`quantity+1`、200 行上限）。超过 200 行 → G.TOAST「报价最多 200 行」，不加。价格按产品当前价快照；若产品价格无效（非数字）→ 不加入并提示「这个产品价格有误，请先修正」。

**删除产品**：`⋯` → 删除 → D.PRODUCT_DELETE（「删除 {名称}？已有报价不受影响。」）。

## 3. PRD｜产品详情（CAT 弹层）

Figma 版式 + 本次修改：
- 标题行：公司名（PRD.COMPANY，小字 muted）+ 右上 G.CLOSE。
- 产品图（原图，正方形，`object-fit: contain`，灰底）。**图片内不放任何按钮**；下方右对齐文字按钮「下载卡片」（G.SECONDARY_BUTTON 小号，PRD.DOWNLOAD_CARD）。
- 名称（大，粗）+ ` / 件` 单位（muted）。
- 编号 SKU。
- **价格 `RM 20.00`（PRD.PRICE，大号 navy 粗体，新增）**——内部可见。
- Chip 行：标签（PRD.TAGS）。
- 分类（未分类显示「未分类」）、说明（PRD.DESCRIPTION，muted；空则不渲染）。旧服务产品在名称旁显示 chip「服务」。
- 底部固定两个按钮：「分享卡片」（G.SHARE_BUTTON，PRD.SHARE_CARD）+「加入报价」（G.PRIMARY_BUTTON，PRD.ADD_QUOTE）；加入成功后按钮短暂变「已加入 ✓」，弹层不关闭，旁边出现次要文字链接「查看当前报价」(PRD.OPEN_QUOTE → QTE)。
- 卡片准备状态 PRD.CARD_STATE：生成中时两个卡片按钮置为「准备中…」；失败显示 G.INLINE_ERROR +「重新生成」(PRD.RETRY_CARD)。分享不被浏览器支持 → ST.SHARE_UNSUPPORTED：自动改为下载并提示「已为你下载，可在相册/文件中发送」。用户取消分享不报错（ST.SHARE_CANCELLED）。

### 3.1 对外产品卡片图（`app/product-card.js`）— **去价格**
- 画布 JPG 不再绘制 `RM {price}`，也不再因价格无效而抛错（价格与卡片无关）。
- 保留：图片、名称、编号、单位、分类/标签、公司名与品牌；底部留出联系人区块（销售员姓名 + WhatsApp，若有）。**不再出现「· 服务」文字**（类型不对外显示）。
- 无图产品：用 `--ph` 占位 + 名称大字，不报错。
- 测试：单测 spy `CanvasRenderingContext2D.fillText`，断言任何调用的文本都不含 `RM` 与价格数字；价格为 `""`/`NaN` 的产品也能生成卡片。
- PRD 内的价格展示、QTE、报价 PDF 不受影响（仍含价格）。

## 4. PDE｜新增/编辑产品（弹层，两步，按 Figma）

**步骤 1「新增产品」/「编辑产品」**（副标题「填写产品资料后保存」）：
- 产品编号（PDE.SKU；自动编号规则开启时显示灰字「保存时自动生成」且不可编辑，对应 NUM.MODE）。
- 名称 `*`（PDE.NAME）、价格 `*`（PDE.PRICE，输入框内左置 `RM` 前缀，`inputmode=decimal`，最多 2 位小数，> 0 或 ≥ 0 沿用现有校验）。
- 照片行：左「选择照片」（G.SECONDARY_BUTTON，PDE.UPLOAD_IMAGE；已选后显示缩略图 + 「更换」「移除」PDE.REMOVE_IMAGE）；右「更多设置 →」（navy 小药丸）进入步骤 2。
- 底部整行「保存产品」（PDE.SAVE，编辑时「保存修改」）。必填未填时点保存 → 对应输入框红框 + 文案，不关闭弹层。

**步骤 2「更多设置」**：单位（默认「件」）、产品分类（下拉，含「未分类」；仅有效分类）、标签（逗号分隔，输入框 placeholder「分类, 材质, 款式」）、说明（多行 5 行）。底部「返回」（回步骤 1，保留已填）+「保存产品」。
**去掉**：商品/服务选择（PDE.TYPE）。保存时：新增 → `is_service=false`；编辑 → 原样带回原值。

保护：有改动时关闭/ESC/遮罩 → D.DISCARD。保存中（ST.SAVING）按钮禁用并显示「保存中…」，防双击。保存成功 → 关闭、列表回到当前页并 G.TOAST「已保存」；失败 → 留在弹层 + G.INLINE_ERROR。

## 5. QTE｜报价编辑（`/cloud/quote`，导航「报价单」）

专注页：显示 G.NAVBAR（键盘弹出时隐藏），顶部标题「当前报价」+ 右侧「报价记录」图标文字（→ QTL，**不**替换当前报价）。

自上而下的分组卡片：
1. **状态行**：`新报价` / `正在编辑 Q-0007`（QTE.IDENTITY/NUMBER）、复制来源、保存状态药丸（QTE.SAVE_STATE：未保存/保存中/保存失败）。
2. **客户 QTE.CUSTOMER**：客户名称 `*`、电话；「选择已有客户」(QTE.PICK_CUSTOMER → CPK 弹层)；已关联时显示 chip「已关联：{名}」+「取消关联」；「更多资料 ▾」折叠（公司、邮箱、地址）。「管理客户」(QTE.CUSTOMER_BOOK) 放在 CPK 弹层底部，点它用客户端路由去 `/customers`，当前报价保留（FLOW.QUOTE_CONTINUE）。
3. **项目 QTE.ITEMS**：每行一张小卡：名称、SKU（临时项目带「临时」chip）、单位；数量步进器（− 数字输入 +，最少 1，沿用现有上限校验）、单价输入（只改本单，旁注「仅本单」muted）、行金额；右上 `⋯`→「移除项目」（QTE.REMOVE_ITEM，无需确认，toast 带「撤销」5 秒）。行尾空状态：「还没有项目」+ 按钮「去选产品」(QTE.ADD_PRODUCTS → /cloud) 与「添加临时项目」(QTE.ADD_TEMP → TMP)。有行时这两个按钮变成列表底部两个次要按钮。
4. **金额 QTE.TOTALS**：小计、折扣（输入，QTE.DISCOUNT）、总额（大号粗体）。
5. **更多报价资料 ▾**（QTE.DETAILS 折叠，默认收起）：日期、有效天数、付款条款、备注。公司品牌快照 QTE.BRAND 以只读小块放在折叠区最下，管理员多一个「公司品牌设置」文字链接（→ `/brand`）。
6. **底部操作区**（固定在导航之上）：「分享报价」（G.SHARE_BUTTON，QTE.SHARE）+「下载报价」（G.PRIMARY_BUTTON，QTE.DOWNLOAD）。无行或客户名为空时两个按钮可点但点击后在对应处显示 G.INLINE_ERROR（不用置灰无解释）。
7. 次要操作（标题栏 `⋯`）：新建报价（QTE.NEW_QUOTE，有内容时 D.QUOTE_REPLACE）、重新读取（QTE.RELOAD，有修改时 D.DISCARD）。

**保存/输出行为**（沿用现有，不改业务）：点下载/分享 → 自动保存（ST.SAVING）→ 生成 PDF（ST.FILE_PREPARING）→ 下载/系统分享。
- 全部成功 → 回 CAT，当前报价清空为空白新单，CAT 显示 `CAT.LAST_PDF` 区 + G.TOAST「报价已保存」。
- 保存失败 → 留在 QTE，保留全部内容，G.INLINE_ERROR「保存失败：{原因}。内容还在，可再试一次。」。
- 分享被取消 / 浏览器不支持 → 留在 QTE（已保存），提示并提供「改为下载」。**不要**清空。
- PDF 生成失败但保存成功 → 保存状态显示「已保存」，PDF 区显示失败与重试（QTE.PDF_STATE 与保存状态分开）。

## 6. TMP｜临时项目（QTE 内底部抽屉）
字段：名称 `*`、单价 `*`、数量（默认 1）、单位（默认「件」）、说明。**去掉商品/服务选择**（临时项目一律 `is_service=false`）。按钮：「加入本单」(TMP.ADD，加入后清空并关闭)、「清空」(TMP.CLEAR)。有未加入输入时关闭 → D.DISCARD。

## 7. CPK｜选择客户（QTE 内弹层）
搜索框 + 客户列表（姓名粗、公司/电话 muted；管理员多一行建立者）。每批 50，G.PAGE_*。点一行 = 选用并关闭（CPK.SELECT）。底部「管理客户」文字链接。空：「还没有客户」+「去新增客户」（路由到 CUS）。只列有效且可访问客户。

## 8. QTL｜报价记录（`/quotations`）
- 标题「报价记录」，右上：「回收站」(QTL.TRASH → QTR)、刷新图标（QTL.REFRESH）。无“新建报价”按钮在标题栏；底部浮动「＋ 新建报价」(QTL.NEW_QUOTE，→ CAT，D.QUOTE_REPLACE 视情况)。
- 搜索框 + 「筛选」(G.FILTER) 展开面板：状态（全部/Pending/Success/Paid 分段）、顾客（G.CUSTOMER_FILTER）、员工（仅管理员，G.EMPLOYEE_FILTER）、日期（单日/区间；「查询」应用；规则不变：含首尾最多 30 天；已改未查询显示 QTL.DATE_UNAPPLIED）。已应用条件显示为可 ✕ 清除的 chip 行（QTL.FILTER_TAGS）。
- 列表卡片：编号（粗）+ 状态药丸；客户名；日期 · 金额（`RM 1,234.00`，粗）；管理员再加创建员工。整卡点击 = QTL.SELECT：载入该报价到当前并跳 CAT 的 QTE（`/cloud/quote`）；当前有未保存内容 → D.QUOTE_REPLACE。
- 卡片右上 `⋯`（QTL.MORE）：复制为新报价、标记待确认/已成交/已收款（按当前状态与权限只显示可用项；Paid 前 D.PAID_CONFIRM；已 Paid 者出现「更正状态」→ D.PAID_CORRECT）、查看最近操作记录（卡片内展开 QTL.AUDIT_LIST）、移入回收站（danger，D.QUOTE_TRASH）。
- 分页 30/页；空列表：ST.EMPTY「还没有报价」+「去新建」。

## 9. QTR｜报价回收站
同 QTL 版式（G.BACK 返回）；卡片多一行「已删除 {时间} · {RESTORE_UNTIL} 前可恢复」；`⋯` 或卡片按钮仅「恢复」「查看记录」。顶部一句提示「回收站保留 15 天，到期自动清理」。无永久删除按钮。

## 10. 统一状态与错误
列表读取失败：区块内 ST.ERROR +「重试」；无权限/访问停用：整页 ST.NO_ACCESS（说明 + 「返回我的」）；所有网络请求按钮在进行中禁用并改文案。

## 11. 验收清单
1. 导航 5 项正确、徽章 = 报价行数、换页不丢草稿、刷新才丢（见 §1 验收）。
2. 卡片 ＋ 加入：同产品两次 = 1 行、数量 2、徽章 1。第 201 行被拒并提示。
3. 无产品管理权限的销售员：看不到「新增产品」「⋯」；用 URL/控制台直接调用仍被后端拒绝（保留现有 RLS 测试）。
4. PRD 显示价格；对外卡片 JPG 无 `RM` 文本（单测）；旧服务产品编辑后 `is_service` 不变（单测或 SQL 测试）。
5. PDE 无类型选择；新增产品 `is_service=false`。
6. 下载/分享：成功清空并回 CAT；保存失败/分享取消内容保留。
7. QTL 选择报价替换流程、复制、状态变更、回收站、恢复行为与现有一致。
8. 全程没有 `window.confirm`/`alert`（改 G.CONFIRM）；没有使用浏览器本地存储保存草稿。
9. 390px 视觉走查：对照 Figma 截图（CAT 5 个画面）逐屏比对；`npm test`、`npm run build`、`scripts/test-workspace-browser.cjs` 通过。

## 12. 需要负责人在 Figma 里补的画面（Claude 无法替你画）
QTE（新报价/编辑原单/空状态）、QTL（含筛选展开、⋯ 菜单）、QTR、CPK、TMP、PRD 加入价格后的版本、报价条两种状态。已按 design-system 的规则推导，若与你的稿不同，以 Figma 为准并告诉我更新本文。
