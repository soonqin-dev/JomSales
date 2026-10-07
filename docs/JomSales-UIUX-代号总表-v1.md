# JomSales｜UI/UX 页面、内容与按钮代号总表 V1

整理日期：2026-10-07。用途：Figma 设计与后续开发沟通。不代表这些画面已经按此布局开发。

## 0. 命名规则与使用方法

- 页面／画面：`CAT`、`QTE` 等；Figma Frame 示例：`CAT｜产品目录｜销售员`。
- 页面内容、输入、按钮：`页面代号.元素名称`，例如 `CAT.SEARCH`、`QTE.DISCOUNT`。
- 页面可以包含弹层、折叠区域或状态画面；以下 38 个画面不是 38 个新网址。
- 代号不因页面排序、按钮位置、显示语言改变而改变。文字名称可以调整，代号尽量固定。
- 共用组件为 `G.*`，状态为 `ST.*`，确认弹窗为 `D.*`；具体实例可写成 `QTL / G.PAGE_NEXT`。
- 子字段用点号展开，例如 `CAT.CARD.NAME`；它属于 `CAT` 页面里的 `CAT.CARD` 组件。
- “内容／字段”包含只读资料、输入框、选择器、列表和组件；“按钮／操作”包括可点击菜单项、开关及链接。
- 隐藏权限按钮只是 UI 表现，后台权限仍必须保留。无权限者不显示操作按钮，不是仅置灰。

### 已确认，仍待实现的体验

1. 固定导航概念接受，实际项目、名称与排列仍可调整。
2. 管理员与销售员默认都进入产品目录。
3. `FLOW.QUOTE_CONTINUE`：同一公司内切换日常页面，保留当前报价的会话内存内容，不使用浏览器本地存储。刷新、关闭后不承诺恢复；替换当前报价、退出、切换公司、放弃修改仍有必要保护。
4. 产品卡片增加快速加入报价，保留点击卡片查看详情。
5. 两个直接报价输出操作：下载／分享，均自动保存；不增加独立保存按钮。
6. 对外产品卡片和顾客目录都隐藏价格。内部目录、报价编辑、报价 PDF 仍显示价格。现有产品卡片去价仍待开发。

### 权限用词

- 成员：可访问当前公司的销售员或管理员。
- 产品管理员：公司管理员，或已获产品管理权限的销售员；不等于公司管理员身份。
- 公司管理员：正管理员／副管理员，仍受身份边界限制。
- 平台负责人：获平台授权并满足双重验证要求的你；不默认获得商家的销售资料读取权限。
- 访客：持有效顾客目录链接的外部顾客，无须登录。

## 1. 页面索引

| 序号 | 页面代号 | 统一名称 | 主要所属区域／父画面 | 现有能力来源 |
|---|---|---|---|---|
| 01 | CAT | 产品目录 | 产品导航，默认首页 | /cloud |
| 02 | PRD | 产品详情 | CAT 弹层 | /cloud |
| 03 | PDE | 新增／编辑产品 | CAT 表单 | /cloud |
| 04 | QTE | 报价编辑 | CAT 当前报价 | /cloud 内状态 |
| 05 | TMP | 临时项目 | QTE 弹层／区域 | /cloud |
| 06 | CPK | 选择客户 | QTE 弹层 | /cloud |
| 07 | QTL | 报价记录 | 报价导航 | /quotations |
| 08 | QTR | 报价回收站 | QTL 子画面 | /quotations |
| 09 | CUS | 客户通讯录 | 客户导航 | /customers |
| 10 | CUE | 新增／编辑客户 | CUS 表单 | /customers |
| 11 | SHR | 分享中心 | 分享导航 | /catalog-share |
| 12 | SHC | 新建目录分享 | SHR 表单／挑选画面 | /catalog-share |
| 13 | ME | 我的 | 我的导航 | /account、/settings；入口组织待调整 |
| 14 | PRO | 个人资料 | ME；首次补资料复用 | /settings |
| 15 | SEC | 账号安全 | ME | /settings |
| 16 | ADM | 公司管理 | ME，仅管理员 | 现有工具的建议汇总入口 |
| 17 | TEAM | 员工管理 | ADM | /team |
| 18 | INV | 员工邀请 | TEAM 子画面 | /team |
| 19 | RPT | 销售概览 | ADM | /team 内报表 |
| 20 | BRD | 公司资料与品牌 | ADM | /brand |
| 21 | DEF | 报价默认设置 | ADM／BRD | /brand |
| 22 | CTG | 产品分类 | ADM | /catalog-settings |
| 23 | NUM | 产品编号规则 | ADM | /catalog-settings |
| 24 | IMP | 批量新增产品 | ADM | /catalog-settings |
| 25 | PRC | 批量调价 | ADM，内建表／CSV 两种模式 | /catalog-settings |
| 26 | VIS | 产品公开设置 | ADM；建议与分享创建分离 | /catalog-share |
| 27 | AUTH.LOGIN | 登录 | 未登录入口 | /account |
| 28 | AUTH.REGISTER | 注册员工账号 | 登录辅助流程 | /account |
| 29 | AUTH.VERIFY | 邮箱验证 | 注册／更改邮箱辅助流程 | /account、/auth/callback |
| 30 | AUTH.RESET | 重置密码 | 邮件链接辅助流程 | /auth/reset |
| 31 | AUTH.JOIN | 接受公司邀请 | 邀请流程 | /join |
| 32 | AUTH.WAIT | 等待公司邀请 | 已登录、无可用公司状态 | /account |
| 33 | AUTH.PROFILE_FIRST | 首次补齐资料 | 进入公司前，复用 PRO | /settings |
| 34 | PUB | 顾客产品目录 | 外部访客 | /c/<token> |
| 35 | PUB.INVALID | 目录链接失效 | PUB 状态画面 | /c/<token> |
| 36 | PLT.LIST | 商家公司列表 | 平台后台 | /platform |
| 37 | PLT.NEW | 开通公司 | 平台后台表单 | /platform |
| 38 | PLT.COMPANY | 商家公司管理 | 平台后台详情 | /platform |

## 2. 导航与共用组件

### NAV｜日常导航（项目与排列待最终设计）

| 代号 | 名称 | 目标画面 |
|---|---|---|
| NAV.PRODUCTS | 产品 | CAT |
| NAV.QUOTES | 报价 | QTL，已保存记录，不是当前报价编辑 |
| NAV.CUSTOMERS | 客户 | CUS |
| NAV.SHARE | 分享 | SHR |
| NAV.ME | 我的 | ME |

登录／邀请、外部目录不使用员工导航；专注编辑时是否隐藏导航按最终设计处理。

### G｜可重复使用的组件

| 代号 | 名称／用途 | 所属位置 |
|---|---|---|
| G.TOPBAR | 页面标题栏 | 普通页面顶部 |
| G.NAVBAR | 固定日常导航 | 成员日常画面 |
| G.BACK | 返回上一层／来源画面 | 子画面，保留必要未保存提醒 |
| G.CLOSE | 关闭弹层 | 弹层，不等于清空业务内容 |
| G.MORE | 更多操作菜单 | 卡片、标题栏、低频操作 |
| G.SEARCH | 搜索组件 | 有查询功能的画面 |
| G.FILTER | 筛选组件 | 有筛选功能的画面 |
| G.COMPANY_PICKER | 公司选择器 | 多公司成员；切换公司须处理当前任务 |
| G.COMPANY_PICKER.LIST | 所属公司、角色、访问状态 | 公司选择器 |
| G.COMPANY_PICKER.SELECT | 进入／切换选中公司 | 公司选择器 |
| G.PAGE_PREV | 上一页 | 分页列表 |
| G.PAGE_NEXT | 下一页 | 分页列表 |
| G.PAGE_INFO | 当前页／数量 | 分页列表 |
| G.PRIMARY_BUTTON | 主要按钮样式 | 各页最主要操作 |
| G.SECONDARY_BUTTON | 次要按钮样式 | 次要操作 |
| G.DANGER_BUTTON | 危险操作样式 | 删除、撤销、移除 |
| G.CONFIRM | 确认弹窗组件 | D.* 的共用结构 |
| G.CONFIRM.CONFIRM | 确认执行 | 确认弹窗 |
| G.CONFIRM.CANCEL | 取消／留在当前画面 | 确认弹窗 |
| G.TOAST | 简短完成提示 | 操作完成后，不替代错误保护 |
| G.INLINE_ERROR | 相关字段／操作附近的错误 | 表单及提交区域 |
| G.EMPLOYEE_FILTER | 员工／建立者选择器 | QTL、CUS 的管理员筛选 |
| G.EMPLOYEE_FILTER.SEARCH | 搜索员工 | 员工选择器 |
| G.EMPLOYEE_FILTER.SELECT | 选择员工 | 员工选择器 |
| G.EMPLOYEE_FILTER.CLEAR | 清除员工筛选 | 员工选择器 |
| G.CUSTOMER_FILTER | 报价顾客选择器 | QTL、QTR |
| G.CUSTOMER_FILTER.SEARCH | 搜索顾客候选 | 顾客选择器 |
| G.CUSTOMER_FILTER.SELECT | 选择顾客 | 顾客选择器 |
| G.CUSTOMER_FILTER.CLEAR | 清除顾客筛选 | 顾客选择器 |

具体实例建议写成 `CUS / G.PAGE_NEXT`；PRC 有两份分页，写成 `PRC.PRODUCTS / G.PAGE_NEXT` 与 `PRC.DRAFT_LIST / G.PAGE_NEXT`。

## 3. 日常画面

### 01 CAT｜产品目录

权限：可访问公司的成员。建议顺序：公司 → 搜索／分类 → 产品 → 分页 → 当前报价条 → 导航。
 
内容／字段：

| 代号 | 名称 | 说明 |
|---|---|---|
| CAT.COMPANY | 当前公司 | 可调用 G.COMPANY_PICKER |
| CAT.PRODUCT_PERMISSION | 当前产品权限 | 简洁身份信息，不铺长说明 |
| CAT.TOTAL | 产品总数 | 查询返回的数量 |
| CAT.SEARCH | 产品搜索 | 编号、名称、标签、分类、说明 |
| CAT.CATEGORY | 分类筛选 | 全部、未分类、公司分类 |
| CAT.LIST | 产品列表 | 每页 30 项 |
| CAT.CARD | 产品卡片 | 重复组件 |
| CAT.CARD.IMAGE | 产品图片 | 缩略图／无图状态 |
| CAT.CARD.NAME | 产品名称 | 可点击查看详情 |
| CAT.CARD.SKU | 产品编号 | 公司自定义编号 |
| CAT.CARD.PRICE | 内部单价 | 显示价格；对外隐藏不影响这里 |
| CAT.CARD.UNIT | 单位 | 件、米、小时等 |
| CAT.CARD.TYPE | 商品／服务类型 | 辅助信息 |
| CAT.CARD.CATEGORY | 分类名称 | 辅助信息 |
| CAT.CARD.TAGS | 标签 | 辅助信息 |
| CAT.QUOTE_BAR | 当前报价条 | 当前报价入口组件 |
| CAT.QUOTE_BAR.IDENTITY | 新报价／正在编辑编号 | 不能与报价记录混淆 |
| CAT.QUOTE_BAR.COUNT  | 当前项目数 | 当前报价行数 |
| CAT.QUOTE_BAR.COPIED_FROM | 复制来源 | 复制报价时显示 |
| CAT.QUOTE_BAR.SAVE_STATE | 未保存／保存状态 | 当前报价状态 |
| CAT.LAST_PDF | 刚生成文件结果区 | 当前会话中可再次下载／分享 |

按钮／操作：

| 代号 | 名称 | 功能／条件 |
|---|---|---|
| CAT.CLEAR_SEARCH | 清除搜索 | 清空查询词 |
| CAT.DETAIL | 查看产品 | 打开 PRD |
| CAT.ADD_QUOTE | ＋加入报价 | 卡片快速加入；待实现 |
| CAT.OPEN_QUOTE | 查看当前报价／继续编辑 | 进入 QTE |
| CAT.NEW_QUOTE | 新建报价 | 替换未保存内容前确认 |
| CAT.ADD_PRODUCT | 新增产品 | 打开 PDE；仅产品管理员 |
| CAT.PRODUCT_MORE | 产品更多 | 编辑／删除菜单；无权限不显示 |
| CAT.EDIT_PRODUCT | 编辑产品 | 打开 PDE；仅产品管理员 |
| CAT.DELETE_PRODUCT | 删除产品 | 确认后删除；仅产品管理员 |
| CAT.REFRESH | 刷新产品 | 读取最新云端目录 |
| CAT.RELOAD_QUOTE | 重新读取当前报价与品牌 | 放弃修改前确认 |
| CAT.DOWNLOAD_LAST_PDF | 下载刚生成的报价 | 不重新制作当前报价 |
| CAT.SHARE_LAST_PDF | 分享刚生成的报价 | 可重试／下                   载替代 |

其他：G.PAGE_PREV、G.PAGE_NEXT、G.PAGE_INFO、G.NAVBAR。

### 02 PRD｜产品详情

父画面：CAT。形式：弹层／详情抽屉。权限：成员。

内容／字段：

| 代号 | 名称 |
|---|---|
| PRD.COMPANY | 公司名称／品牌 Logo |
| PRD.IMAGE | 产品原图 |
| PRD.NAME | 产品名称 |
| PRD.SKU | 产品编号 |
| PRD.PRICE | 内部价格 |
| PRD.UNIT | 单位 |
| PRD.TYPE | 商品／服务类型 |
| PRD.CATEGORY | 分类 |
| PRD.TAGS | 标签 |
| PRD.DESCRIPTION | 产品说明 |
| PRD.CARD_STATE | 分享卡片准备状态 |
| PRD.ADD_RESULT | 加入报价结果 |

按钮／操作：

| 代号 | 名称 | 功能 |
|---|---|---|
| PRD.ADD_QUOTE | 加入报价 | 加入当前报价 |
| PRD.SHARE_CARD | 分享产品卡片 | 对外卡片去价待实现 |
| PRD.DOWNLOAD_CARD | 下载产品卡片 | 对外卡片去价待实现 |
| PRD.RETRY_CARD | 重新生成卡片 | 失败时重试 |
| PRD.OPEN_QUOTE | 查看当前报价 | 进入 QTE |
| PRD.CLOSE | 关闭／返回目录 | 不清空报价 |

### 03 PDE｜新增／编辑产品

父画面：CAT。形式：共用表单，新建／编辑为变体。权限：产品管理员。

内容／字段：

| 代号 | 名称 |
|---|---|
| PDE.MODE | 新增／编辑状态 |
| PDE.IMAGE | 图片选择及预览 |
| PDE.NAME | 产品名称输入 |
| PDE.SKU | 产品编号输入 |
| PDE.PRICE | 单价输入 |
| PDE.CATEGORY | 分类选择 |
| PDE.UNIT | 单位输入 |
| PDE.TYPE | 商品／服务选择 |
| PDE.TAGS | 标签输入 |
| PDE.DESCRIPTION | 说明输入 |
| PDE.MORE_FIELDS | 更多资料区域 |

按钮／操作：

| 代号 | 名称 | 功能 |
|---|---|---|
| PDE.UPLOAD_IMAGE | 上传／更换图片 | 使用图片选择控件 |
| PDE.REMOVE_IMAGE | 移除图片 | 清除照片 |
| PDE.SAVE | 新增产品／保存修改 | 保存云端 |
| PDE.CANCEL | 取消／关闭 | 保留必要放弃提醒 |

### 04 QTE｜报价编辑

父画面：CAT 当前报价。权限：员工自己的报价／管理员全公司报价。形式：专注编辑画面。

内容／字段：

| 代号 | 名称 | 说明 |
|---|---|---|
| QTE.IDENTITY | 当前报价身份 | 新报价／正在编辑 |
| QTE.NUMBER | 报价编号 | 只读，保存时分配 |
| QTE.COPIED_FROM | 复制来源 | 复制单显示 |
| QTE.SAVE_STATE | 保存状态 | 未保存、保存中、失败等 |
| QTE.CUSTOMER | 客户区域 | 资料分组 |
| QTE.CUSTOMER_NAME | 客户名称 | 必填 |
| QTE.CUSTOMER_PHONE | 客户电话 | 本单资料 |
| QTE.CUSTOMER_COMPANY | 客户公司 | 更多资料 |
| QTE.CUSTOMER_EMAIL | 客户邮箱 | 更多资料 |
| QTE.CUSTOMER_ADDRESS | 客户地址 | 更多资料 |
| QTE.CUSTOMER_LINK | 已关联客户 | 是否关联通讯录 |
| QTE.CUSTOMER_MORE | 客户更多资料区域 | 可折叠 |
| QTE.ITEMS | 项目列表 | 商品、服务、临时项目 |
| QTE.ITEM.NAME | 项目名称 | 保存快照 |
| QTE.ITEM.SKU | 编号 | 临时项目有相应标记 |
| QTE.ITEM.UNIT | 单位 | 行项目单位 |
| QTE.ITEM.TYPE | 商品／服务／临时标记 | 不等于库存 |
| QTE.ITEM.DESCRIPTION | 项目说明 | 有内容时显示 |
| QTE.QUANTITY | 行数量输入 | 当前报价行内 |
| QTE.UNIT_PRICE | 行单价输入 | 只改本单，不改产品价格 |
| QTE.ITEM.LINE_TOTAL | 行金额 | 计算展示 |
| QTE.DISCOUNT | 折扣金额输入 | 整张单折扣 |
| QTE.TOTALS | 金额汇总组件 | 小计／折扣／总额 |
| QTE.SUBTOTAL | 小计 | 计算展示 |
| QTE.TOTAL | 总额 | 计算展示 |
| QTE.DETAILS | 更多报价资料区域 | 可折叠 |
| QTE.DATE | 报价日期 | 可选日期 |
| QTE.NOTES | 备注 | 本单说明 |
| QTE.VALIDITY | 有效天数 | 本单设置 |
| QTE.PAYMENT_TERMS | 付款条款 | 本单设置 |
| QTE.BRAND | 公司品牌快照区域 | 历史不随设置改变 |
| QTE.BRAND.NAME | 公司名称 | 快照 |
| QTE.BRAND.CONTACT | 公司联系方式 | 快照 |
| QTE.BRAND.LOGO | 公司 Logo | 快照 |
| QTE.PDF_STATE | PDF 准备／分享状态 | 不与保存成功混为一谈 |

按钮／操作：

| 代号 | 名称 | 功能 |
|---|---|---|
| QTE.PICK_CUSTOMER | 选择已有客户 | 打开 CPK |
| QTE.UNLINK_CUSTOMER | 取消客户关联 | 保留本张资料 |
| QTE.CUSTOMER_BOOK | 管理客户 | 打开 CUS；按连续工作流保留任务 |
| QTE.ADD_PRODUCTS | 继续添加产品 | 返回 CAT，不丢当前单 |
| QTE.ADD_TEMP | 添加临时项目 | 打开 TMP |
| QTE.REMOVE_ITEM | 移除项目 | 仅从本张报价移除 |
| QTE.DOWNLOAD | 下载报价 PDF | 自动保存后生成／下载 |
| QTE.SHARE | 分享报价 PDF | 自动保存后准备／分享 |
| QTE.NEW_QUOTE | 新建报价 | 有未保存替换时确认 |
| QTE.RECORDS | 报价记录 | 打开 QTL；不等于选另一张单 |
| QTE.RELOAD | 重新读取 | 放弃修改前确认 |
| QTE.BRAND_SETTINGS | 公司品牌设置 | 仅管理员 |

保护：没有独立保存按钮。保存失败／取消分享保留当前内容；成功完成按业务规则回 CAT 并开始空白新单。内部报价及 PDF 仍有价格。

### 05 TMP｜临时项目

父画面：QTE。形式：弹层／折叠区域。

内容／字段：

| 代号 | 名称 |
|---|---|
| TMP.NAME | 项目名称 |
| TMP.PRICE | 单价 |
| TMP.QUANTITY | 数量 |
| TMP.UNIT | 单位 |
| TMP.TYPE | 商品／服务 |
| TMP.DESCRIPTION | 说明 |

按钮／操作：

| 代号 | 名称 |
|---|---|
| TMP.ADD | 加入本张报价，不进产品目录 |
| TMP.CLEAR | 清空临时输入 |
| TMP.CLOSE | 关闭／收起，保留必要未完成输入保护 |

### 06 CPK｜选择客户

父画面：QTE。形式：弹层／选择区域。只显示可访问的有效客户。

内容／字段：

| 代号 | 名称 |
|---|---|
| CPK.SEARCH | 客户搜索 |
| CPK.LIST | 客户列表 |
| CPK.CARD.NAME | 客户姓名 |
| CPK.CARD.COMPANY | 客户公司 |
| CPK.CARD.PHONE | 电话 |
| CPK.CARD.OWNER | 建立者，管理员可见 |

按钮／操作：`CPK.SELECT` 选用客户并返回报价；`CPK.CLOSE` 收起／关闭。

共用分页：G.PAGE_PREV、G.PAGE_NEXT、G.PAGE_INFO；每批 50 位。

### 07 QTL｜报价记录

权限：员工自己的报价；管理员全公司。每页 30 张。

内容／字段：

| 代号 | 名称 |
|---|---|
| QTL.SEARCH | 报价搜索 |
| QTL.STATUS_FILTER | 状态筛选 |
| QTL.CUSTOMER_FILTER | 顾客筛选，使用 G.CUSTOMER_FILTER |
| QTL.EMPLOYEE_FILTER | 员工筛选，仅管理员，使用 G.EMPLOYEE_FILTER |
| QTL.DATE_FILTER | 日期筛选区域 |
| QTL.DATE_MODE | 单日／日期区间 |
| QTL.DATE_SINGLE | 单日日期 |
| QTL.DATE_FROM | 起始日期 |
| QTL.DATE_TO | 结束日期 |
| QTL.DATE_APPLIED | 当前已应用日期范围 |
| QTL.DATE_UNAPPLIED | 修改后尚未查询提示 |
| QTL.FILTER_TAGS | 当前筛选条件摘要，建议编排 |
| QTL.LIST | 报价列表 |
| QTL.CARD.NUMBER | 报价编号 |
| QTL.CARD.CUSTOMER | 客户名称 |
| QTL.CARD.DATE | 报价日期 |
| QTL.CARD.AMOUNT | 总额 |
| QTL.CARD.STATUS | Pending／Success／Paid |
| QTL.CARD.CREATOR | 创建员工姓名／邮箱快照 |
| QTL.AUDIT_LIST | 最近操作记录 |
| QTL.AUDIT_LIST.ACTOR | 操作人 |
| QTL.AUDIT_LIST.ACTION | 操作类型 |
| QTL.AUDIT_LIST.TIME | 操作时间 |
| QTL.AUDIT_LIST.DETAILS | 记录详情 |

按钮／操作：

| 代号 | 名称 | 功能 |
|---|---|---|
| QTL.FILTER | 筛选 | 打开／收起筛选区域 |
| QTL.APPLY_DATE | 查询日期 | 应用日期，含首尾最多 30 天；可选早期历史 |
| QTL.SELECT | 选择报价 | 替换当前任务前保护，回 CAT 编辑原单 |
| QTL.MORE | 报价更多操作 | 次要／危险操作菜单 |
| QTL.DUPLICATE | 复制为新报价 | 新编号，不覆盖原单 |
| QTL.SET_PENDING | 标记待确认 | Pending |
| QTL.SET_SUCCESS | 标记已成交 | Success |
| QTL.SET_PAID | 标记已收款 | 人工全额收款，确认后记录 |
| QTL.CORRECT_STATUS | 更正已收款状态 | 根据目标状态调用已有操作，不新增第四个状态 |
| QTL.DELETE | 移入回收站 | 保留 15 天 |
| QTL.AUDIT | 查看最近操作记录 | 读取／展开记录 |
| QTL.TRASH | 回收站 | 进入 QTR |
| QTL.NEW_QUOTE | 新建报价 | 必要时确认当前任务，回 CAT |
| QTL.REFRESH | 刷新列表 | 重新读取 |

其他：G.PAGE_PREV、G.PAGE_NEXT、G.PAGE_INFO、G.NAVBAR。

### 08 QTR｜报价回收站

父画面：QTL。复用报价记录组件，不新增一套业务系统。

内容／字段：

| 代号 | 名称 |
|---|---|
| QTR.LIST | 已删除报价列表 |
| QTR.CARD | 报价摘要，复用 QTL.CARD 字段结构 |
| QTR.DELETED_AT | 删除时间 |
| QTR.RESTORE_UNTIL | 恢复截止时间 |
| QTR.RETENTION | 保留 15 天／到期清理的短提示 |
| QTR.SEARCH | 搜索，复用 QTL.SEARCH |
| QTR.FILTERS | 状态／顾客／管理员员工／日期，复用 QTL 的筛选组件 |
| QTR.AUDIT_LIST | 操作记录，复用 QTL.AUDIT_LIST |

按钮／操作：`QTR.RESTORE` 恢复报价；`QTR.AUDIT` 查看记录；`QTR.BACK` 返回报价记录；`QTR.REFRESH` 刷新列表。

其他：复用 QTL 日期应用操作与 G 分页。不得增加不存在的任意永久删除按钮。

### 09 CUS｜客户通讯录

权限：员工私有；管理员可读全公司，但只修改自己创建的客户。每页 50 位。

内容／字段：

| 代号 | 名称 |
|---|---|
| CUS.SEARCH | 客户搜索 |
| CUS.OWNER_FILTER | 建立者筛选，仅管理员 |
| CUS.STATE_FILTER | 有效／包含停用客户 |
| CUS.LIST | 客户列表 |
| CUS.CARD.NAME | 客户姓名 |
| CUS.CARD.COMPANY | 公司 |
| CUS.CARD.PHONE | 电话 |
| CUS.CARD.EMAIL | 邮箱 |
| CUS.CARD.ADDRESS | 地址 |
| CUS.CARD.OWNER | 建立者姓名／邮箱 |
| CUS.CARD.STATUS | 有效／停用 |
| CUS.CARD.EDIT_SCOPE | 自己建立／其他员工只读 |
| CUS.TOTAL | 总数量 |

按钮／操作：

| 代号 | 名称 | 条件 |
|---|---|---|
| CUS.ADD | 新增客户 | 保存为本人客户 |
| CUS.DETAIL | 展开完整资料 | 视觉编排，可直接在卡片展开 |
| CUS.EDIT | 编辑客户 | 仅创建者 |
| CUS.DEACTIVATE | 停用客户 | 仅创建者，旧报价不改 |
| CUS.RESTORE | 恢复客户 | 仅创建者 |

其他：G 分页、G.NAVBAR；CUS.OWNER_FILTER 使用 G.EMPLOYEE_FILTER。

### 10 CUE｜新增／编辑客户

父画面：CUS。共用表单。编辑仅创建者。

内容／字段：`CUE.NAME` 姓名；`CUE.PHONE` 电话；`CUE.COMPANY` 公司；`CUE.EMAIL` 邮箱；`CUE.ADDRESS` 地址。

按钮／操作：`CUE.SAVE` 保存客户；`CUE.CANCEL` 取消／返回，必要时确认放弃修改。

### 11 SHR｜分享中心

权限：销售员自己的链接；管理员全公司链接。列表与新建流程的分离是建议编排。

内容／字段：

| 代号 | 名称 |
|---|---|
| SHR.CONTACT | 当前分享联系人区域 |
| SHR.CONTACT.NAME | 本人显示姓名 |
| SHR.CONTACT.WHATSAPP | 本人工作号码 |
| SHR.LIST | 已生成链接列表 |
| SHR.LINK_CARD.NAME | 内部链接名称 |
| SHR.LINK_CARD.URL | 有效链接地址 |
| SHR.LINK_CARD.SCOPE | 全部公开／指定产品 |
| SHR.LINK_CARD.EXPIRY | 到期时间 |
| SHR.LINK_CARD.STATUS | 有效／到期／撤销 |
| SHR.LINK_CARD.CREATOR | 分享员工，管理员可见 |

按钮／操作：

| 代号 | 名称 | 功能 |
|---|---|---|
| SHR.CREATE | 新建目录分享 | 打开 SHC |
| SHR.PROFILE | 修改联系资料 | 打开 PRO |
| SHR.VIEW | 打开顾客目录 | 打开有效链接 |
| SHR.COPY | 复制链接 | 复制有效链接 |
| SHR.SEND | 分享链接 | 分享有效链接 |
| SHR.REVOKE | 撤销链接 | 确认后永久失效 |
| SHR.REFRESH | 刷新链接 | 重新读取 |

其他：G 分页、G.NAVBAR。

### 12 SHC｜新建目录分享

父画面：SHR。默认全部允许公开产品；挑选模式最多 1,000 项。期限固定 7 天。

内容／字段：

| 代号 | 名称 |
|---|---|
| SHC.SCOPE | 全部公开／挑选产品 |
| SHC.NAME | 内部链接名称，可选 |
| SHC.CONTACT | 联系人姓名与工作号码 |
| SHC.EXPIRY | 固定 7 天展示，不可编辑 |
| SHC.SEARCH | 搜索候选产品 |
| SHC.PRODUCTS | 产品候选列表，每页 30 项 |
| SHC.PRODUCTS.SKU | 候选编号 |
| SHC.PRODUCTS.NAME | 候选名称 |
| SHC.PRODUCTS.VISIBILITY | 是否允许公开 |
| SHC.SELECTED_COUNT | 已选数量 |
| SHC.SELECTED_LIST | 已选产品列表 |
| SHC.RESULT | 刚生成的链接区域 |
| SHC.RESULT.URL | 链接地址 |
| SHC.RESULT.EXPIRY | 实际到期时间 |

按钮／操作：

| 代号 | 名称 |
|---|---|
| SHC.SELECT | 勾选／取消选择产品，跨页保留 |
| SHC.SELECTED | 查看／收起已选产品 |
| SHC.REMOVE | 移除已选产品 |
| SHC.CLEAR | 清空选择，确认后执行 |
| SHC.REFRESH_PRODUCTS | 刷新候选产品 |
| SHC.CREATE | 生成 7 天链接 |
| SHC.VIEW | 打开刚生成的顾客目录 |
| SHC.COPY | 复制刚生成的链接 |
| SHC.SEND | 分享刚生成的链接 |
| SHC.CANCEL | 返回分享中心，处理必要未完成选择提醒 |

其他：G 分页。管理员的产品公开修改放 VIS，不混入挑选过程。

### 13 ME｜我的

形式：建议重新组织的账号入口，复用已有账号／设置能力。

内容／字段：`ME.IDENTITY` 个人摘要；`ME.NAME` 姓名；`ME.EMAIL` 邮箱；`ME.CURRENT_COMPANY` 当前公司；`ME.ROLE` 角色；`ME.COMPANIES` 所属公司列表／访问状态。

按钮／操作：

| 代号 | 名称 | 目标／条件 |
|---|---|---|
| ME.PROFILE | 个人资料 | PRO |
| ME.SECURITY | 账号安全 | SEC |
| ME.COMPANY | 所属公司／切换公司 | G.COMPANY_PICKER |
| ME.ENTER_COMPANY | 进入公司 | 当前可访问公司 |
| ME.ADMIN | 公司管理 | ADM，仅公司管理员 |
| ME.PLATFORM | 平台管理 | PLT.LIST，仅平台授权及必要验证后 |
| ME.RELOAD_COMPANIES | 重新读取公司 | 读取失败／需刷新时 |
| ME.LOGOUT | 退出此设备登录 | 保留必要未保存保护 |

其他：G.NAVBAR。

### 14 PRO｜个人资料

内容／字段：`PRO.NAME` 显示姓名；`PRO.WHATSAPP` 含国家区号工作号码；`PRO.SAVE_STATE` 保存状态。

按钮／操作：`PRO.SAVE` 保存资料；`PRO.RELOAD` 重新读取，必要时确认；`PRO.CONTINUE` 首次补齐后继续进入公司。

保护：修改旧工作号码会永久撤销本人旧顾客目录链接，须确认。

### 15 SEC｜账号安全

内容／字段：

| 代号 | 名称 |
|---|---|
| SEC.PASSWORD_SECTION | 密码区域 |
| SEC.CURRENT_PASSWORD | 当前密码，敏感修改前填写 |
| SEC.NEW_PASSWORD | 新密码，6–128 字符 |
| SEC.CONFIRM_PASSWORD | 确认新密码 |
| SEC.EMAIL_SECTION | 邮箱区域 |
| SEC.CURRENT_EMAIL | 当前登录邮箱 |
| SEC.PENDING_EMAIL | 待验证的新邮箱 |
| SEC.NEW_EMAIL | 新邮箱输入 |
| SEC.MFA_SECTION | 双重验证区域 |
| SEC.MFA_QR | 设置二维码，设计用假数据 |
| SEC.MFA_SECRET | 手动密钥，设计用假数据 |
| SEC.MFA_CODE | 六位验证码输入 |
| SEC.MFA_STATE | 双重验证状态 |

按钮／操作：`SEC.CHANGE_PASSWORD` 修改密码并退出；`SEC.CHANGE_EMAIL` 验证并更改邮箱；`SEC.ENROLL_MFA` 设置验证器；`SEC.VERIFY_MFA` 验证。

## 4. 公司管理画面

### 16 ADM｜公司管理

权限：正／副管理员。形式：建议新增的汇总入口，不新增权限。

内容／字段：`ADM.COMPANY` 当前公司；`ADM.ROLE` 管理员身份；`ADM.TEAM_GROUP` 团队与业绩分组；`ADM.PRODUCT_GROUP` 产品工具分组；`ADM.SETTINGS_GROUP` 公司与报价设置分组。

按钮／操作：

| 代号 | 名称 | 目标 |
|---|---|---|
| ADM.TEAM | 员工管理 | TEAM |
| ADM.REPORT | 销售概览 | RPT |
| ADM.CATEGORIES | 产品分类 | CTG |
| ADM.IMPORT | 批量新增产品 | IMP |
| ADM.PRICES | 批量调价 | PRC |
| ADM.PUBLIC | 产品公开设置 | VIS |
| ADM.BRAND | 公司资料与品牌 | BRD |
| ADM.DEFAULTS | 报价默认设置 | DEF |
| ADM.NUMBERS | 产品编号规则 | NUM |

### 17 TEAM｜员工管理

权限：公司管理员，副管理员不能管理正管理员／其他副管理员。

内容／字段：

| 代号 | 名称 |
|---|---|
| TEAM.COMPANY | 当前公司，必要时公司选择器 |
| TEAM.LIST | 公司成员列表 |
| TEAM.COUNT | 成员数量 |
| TEAM.MEMBER.NAME | 姓名 |
| TEAM.MEMBER.EMAIL | 邮箱 |
| TEAM.MEMBER.ROLE | 正管理员／副管理员／销售员 |
| TEAM.MEMBER.STATUS | 有效／停用／移除 |
| TEAM.MEMBER.IS_ME | 本人标记 |
| TEAM.MEMBER.PRODUCT_PERMISSION | 当前产品管理权限状态 |

按钮／操作：

| 代号 | 名称 | 条件 |
|---|---|---|
| TEAM.INVITE | 邀请员工 | INV |
| TEAM.PRODUCT_PERMISSION | 产品管理开关 | 销售员新增／编辑／删除及分配已有分类；管理员始终有管理权 |
| TEAM.MORE | 成员更多操作 | 受角色边界保护 |
| TEAM.DISABLE | 停用员工 | 不删除公司资料 |
| TEAM.ENABLE | 恢复员工 | 不恢复已撤销旧链接 |
| TEAM.REMOVE | 移除员工 | 重新加入需要新邀请 |
| TEAM.PROMOTE | 设为副管理员 | 仅正管理员 |
| TEAM.DEMOTE | 撤销副管理员 | 仅正管理员 |
| TEAM.REFRESH | 刷新员工与邀请 | 读取最新状态 |

### 18 INV｜员工邀请

父画面：TEAM。公司管理员使用。

内容／字段：`INV.EMAIL` 受邀邮箱输入；`INV.LINK` 刚生成邀请链接；`INV.RECORDS` 邀请列表；`INV.RECORD.EMAIL` 受邀邮箱；`INV.RECORD.STATUS` 邀请状态；`INV.RECORD.EXPIRY` 到期时间。

按钮／操作：`INV.GENERATE` 生成邀请链接；`INV.COPY` 复制链接；`INV.REVOKE` 撤销待接受邀请；`INV.BACK` 返回员工管理。

说明：目前不自动发送邮件邀请，不能将生成链接标为“已发送邮件”。

### 19 RPT｜销售概览

权限：公司管理员。现有报表的独立视觉编排。

内容／字段：

| 代号 | 名称 |
|---|---|
| RPT.DATE_FROM | 开始日期 |
| RPT.DATE_TO | 结束日期 |
| RPT.RANKING | 员工排行列表 |
| RPT.MEMBER.NAME | 员工姓名 |
| RPT.MEMBER.EMAIL | 员工邮箱 |
| RPT.MEMBER.STATUS | 有效／停用／已移除 |
| RPT.MEMBER.RANK | 排名 |
| RPT.QUOTE_COUNT | 报价数 |
| RPT.CONFIRMED_COUNT | 成交单数 |
| RPT.CONFIRMED_AMOUNT | 成交报价金额，Success＋Paid 不重复 |
| RPT.PAID_AMOUNT | 人工标记 Paid 报价金额 |
| RPT.GOODS | 分单位成交货物量，不包含服务 |
| RPT.BAR | 成交金额条形图 |
| RPT.DATA_NOTE | 必要数据口径／旧资料缺日期提示 |

按钮／操作：`RPT.QUERY` 查询业绩；G.BACK 返回公司管理。

说明：报表日期规则按现有报表接口，不擅自套用 QTL 的 30 天规则；Paid 金额不是支付对账账本。

### 20 BRD｜公司资料与品牌

权限：公司管理员。

内容／字段：`BRD.NAME` 品牌／报价显示公司名称；`BRD.CONTACT` 联系方式；`BRD.LOGO` Logo 选择及预览。

按钮／操作：`BRD.UPLOAD_LOGO` 上传／更换；`BRD.REMOVE_LOGO` 移除；`BRD.SAVE` 保存公司品牌；`BRD.RELOAD` 重新读取。

### 21 DEF｜报价默认设置

权限：公司管理员。可与 BRD 同一网址，独立画设计区域。

内容／字段：`DEF.PREFIX` 报价前缀；`DEF.DIGITS` 流水号位数；`DEF.VALIDITY` 默认有效天数；`DEF.PAYMENT_TERMS` 默认付款条款；`DEF.NOTES` 默认备注／T&C。

按钮／操作：`DEF.SAVE` 保存默认设置；`DEF.RELOAD` 重新读取。

说明：只影响新报价，不改旧报价。

### 22 CTG｜产品分类

权限：公司管理员。销售员产品管理权只允许分配已有有效分类，不管理分类清单。

内容／字段：`CTG.LIST` 分类列表；`CTG.NAME` 名称输入；`CTG.ROW.NAME` 分类名称；`CTG.ROW.PRODUCT_COUNT` 产品数；`CTG.ROW.STATUS` 有效／停用状态。

按钮／操作：`CTG.ADD` 新增；`CTG.EDIT` 编辑；`CTG.SAVE` 保存名称；`CTG.CANCEL` 取消编辑；`CTG.ARCHIVE` 停用；`CTG.RESTORE` 恢复；`CTG.REFRESH` 刷新。

说明：停用分类不删产品、不改变公开状态；旧产品仍保留分类。

### 23 NUM｜产品编号规则

权限：公司管理员。

内容／字段：`NUM.MODE` 自动／必须手填；`NUM.PREFIX` 前缀；`NUM.DIGITS` 位数；`NUM.NEXT` 下个流水号。

按钮／操作：`NUM.SAVE` 保存规则；`NUM.RELOAD` 读取／重新读取。

### 24 IMP｜批量新增产品

权限：公司管理员。只新增，不覆盖已有编号。

内容／字段：

| 代号 | 名称 |
|---|---|
| IMP.FILE | CSV 文件选择／文件名 |
| IMP.DELIMITER | 分隔符 |
| IMP.MAPPING | 字段对应区域 |
| IMP.MAPPING.SKU | 编号对应列 |
| IMP.MAPPING.NAME | 名称对应列 |
| IMP.MAPPING.PRICE | 价格对应列 |
| IMP.MAPPING.UNIT | 单位对应列 |
| IMP.MAPPING.CATEGORY | 分类对应列 |
| IMP.MAPPING.DESCRIPTION | 说明对应列 |
| IMP.MAPPING.TAGS | 标签对应列 |
| IMP.MAPPING.TYPE | 商品／服务对应列 |
| IMP.SUMMARY | 总行数、可新增、错误、已有编号数量 |
| IMP.PREVIEW_LIST | 预览行列表，当前最多显示 20 行 |
| IMP.ROW.LINE | 文件行号 |
| IMP.ROW.SKU | 编号 |
| IMP.ROW.NAME | 名称 |
| IMP.ROW.STATUS | 检查／处理状态 |
| IMP.ROW.MESSAGE | 错误／跳过原因 |
| IMP.PROGRESS | 导入进度／已确认结果 |

按钮／操作：`IMP.TEMPLATE` 下载模板；`IMP.PREVIEW` 预览检查；`IMP.APPLY` 确认新增；`IMP.PAUSE` 批次结束后暂停；`IMP.RESUME` 继续／重试；`IMP.REPORT` 下载完整结果；`IMP.RESTART` 重新预览。

文件选择本身是 IMP.FILE 控件，不额外创建与之重复的“上传到云端”按钮；选文件不写数据。没有图片 CSV 批量上传能力。

### 25 PRC｜批量调价

权限：公司管理员。两种方式是已存在能力，模式切换／页面组织待设计。

#### PRC 共用入口

| 代号 | 名称／作用 |
|---|---|
| PRC.MODE | 内建表／CSV 文件方式状态 |
| PRC.TABLE | 切换内建调价表模式，默认 |
| PRC.CSV | 切换 CSV 文件调价模式 |

#### 内建调价表内容／字段

| 代号 | 名称 |
|---|---|
| PRC.SEARCH | 候选产品搜索 |
| PRC.CATEGORY | 候选产品分类 |
| PRC.PRODUCTS | 候选产品列表，每页 30 项 |
| PRC.PRODUCTS.SKU | 候选编号 |
| PRC.PRODUCTS.NAME | 候选名称 |
| PRC.PRODUCTS.CATEGORY | 候选分类 |
| PRC.PRODUCTS.PRICE | 当前价格 |
| PRC.DRAFT_LIST | 待调价表，每页 30 行 |
| PRC.DRAFT_COUNT | 待调价行数 |
| PRC.ROW.SKU | 已匹配编号，只读 |
| PRC.ROW.NAME | 已匹配名称，只读 |
| PRC.OLD_PRICE | 原价，只读 |
| PRC.NEW_PRICE | 新价输入 |
| PRC.FIX_SKU | 未匹配编号输入，仅未匹配时可修正 |
| PRC.ROW.STATUS | 检查／提交结果 |
| PRC.ROW.MESSAGE | 错误／冲突原因 |
| PRC.IMPORT_FILE | CSV 文件选择 |
| PRC.IMPORT_MAPPING | 导入文件对应区域 |
| PRC.IMPORT_MAPPING.DELIMITER | 分隔符 |
| PRC.IMPORT_MAPPING.SKU | 编号列 |
| PRC.IMPORT_MAPPING.PRICE | 新价列 |
| PRC.CHECK_SUMMARY | 可更新／错误／冲突等检查摘要 |
| PRC.TASK_STATE | 未开始／已锁定／执行／暂停／结果 |
| PRC.PROGRESS | 已确认批次及行结果 |

#### 内建调价表按钮／操作

| 代号 | 名称／作用 |
|---|---|
| PRC.REFRESH_PRODUCTS | 刷新候选产品 |
| PRC.ADD_ONE | 加入单个产品 |
| PRC.ADD_PAGE | 加入当前页，最多 30 项 |
| PRC.REMOVE_ROW | 移除待调价行 |
| PRC.IMPORT_TO_TABLE | 导入 CSV 到表，不保存 |
| PRC.EXPORT_TABLE | 导出待调价表 CSV |
| PRC.CHECK | 检查调价表，不写价格 |
| PRC.REFRESH_BASE | 重读原价，保留新价，确认后执行 |
| PRC.APPLY | 确认提交调价 |
| PRC.PAUSE | 当前批次完成后暂停 |
| PRC.RESUME | 继续／重试 |
| PRC.NEW_TASK | 开始新任务，不回滚已提交价格 |
| PRC.CLEAR | 清空未提交清单 |
| PRC.REPORT | 下载检查／提交结果 |

两套分页使用 `PRC.PRODUCTS / G.PAGE_*` 与 `PRC.DRAFT_LIST / G.PAGE_*`，不可混淆。

#### CSV 文件调价内容／字段

| 代号 | 名称 |
|---|---|
| PRC.CSV_FILE | CSV 文件选择／文件名 |
| PRC.CSV_MAPPING | 列对应区域 |
| PRC.CSV_DELIMITER | 分隔符 |
| PRC.CSV_SKU_COLUMN | 编号列 |
| PRC.CSV_PRICE_COLUMN | 新价列 |
| PRC.CSV_SUMMARY | 总数、可更新、无变化、错误、缺失、重复等 |
| PRC.CSV_PREVIEW_LIST | 新旧价格预览，当前最多显示 20 行 |
| PRC.CSV_ROW.LINE | 文件行号 |
| PRC.CSV_ROW.SKU | 编号 |
| PRC.CSV_ROW.NAME | 产品名称 |
| PRC.CSV_ROW.OLD_PRICE | 原价 |
| PRC.CSV_ROW.NEW_PRICE | 新价 |
| PRC.CSV_ROW.STATUS | 检查／处理状态 |
| PRC.CSV_ROW.MESSAGE | 原因 |
| PRC.CSV_PROGRESS | 批次执行进度及结果 |

按钮／操作：`PRC.CSV_TEMPLATE` 下载模板；`PRC.CSV_PREVIEW` 预览新旧价；`PRC.CSV_APPLY` 确认调价；`PRC.CSV_PAUSE` 暂停；`PRC.CSV_RESUME` 继续／重试；`PRC.CSV_REPORT` 下载完整结果；`PRC.CSV_RESTART` 重新预览。

保护：两种方式都保留冲突、锁定输入、部分成功、重试保护；仅改价格，不改历史报价。

### 26 VIS｜产品公开设置

权限：公司管理员。现有功能建议从目录分享创建区移到管理区。

内容／字段：`VIS.SEARCH` 产品搜索；`VIS.LIST` 产品列表；`VIS.ROW.SKU` 编号；`VIS.ROW.NAME` 名称；`VIS.ROW.STATUS` 公开状态；`VIS.MATCH_COUNT` 搜索匹配总数；`VIS.PUBLIC_COUNT` 已公开数量。

按钮／操作：`VIS.ALLOW` 允许公开单项；`VIS.HIDE` 停止公开单项；`VIS.ALLOW_MATCHES` 允许公开全部搜索结果；`VIS.HIDE_MATCHES` 停止公开全部搜索结果；`VIS.REFRESH` 刷新；G 分页。

保护：批量跨全部搜索结果，不只是本页；每次最多 10,000 项，确认实际影响数量。停止公开不是删除产品。

## 5. 登录、验证及首次使用画面

### 27 AUTH.LOGIN｜登录

内容／字段：`AUTH.LOGIN.EMAIL` 邮箱；`AUTH.LOGIN.PASSWORD` 密码；`AUTH.LOGIN.ERROR` 登录错误。

按钮／操作：`AUTH.LOGIN.SUBMIT` 登录；`AUTH.LOGIN.REGISTER` 注册员工账号；`AUTH.LOGIN.FORGOT` 忘记密码，使用输入邮箱申请邮件；`AUTH.LOGIN.RETURN_INVITE` 有邀请上下文时返回邀请。

### 28 AUTH.REGISTER｜注册员工账号

内容／字段：`AUTH.REGISTER.NAME` 显示姓名；`AUTH.REGISTER.EMAIL` 邮箱；`AUTH.REGISTER.PASSWORD` 新密码；`AUTH.REGISTER.RESULT` 注册结果。

按钮／操作：`AUTH.REGISTER.SUBMIT` 注册并验证邮箱；`AUTH.REGISTER.LOGIN` 返回登录。

保护：不能自行创建公司或注册管理员。当前注册无独立确认密码字段，不凭空当作已实现。

### 29 AUTH.VERIFY｜邮箱验证

内容／字段：`AUTH.VERIFY.EMAIL` 当前待验证邮箱（仅在已有上下文时）；`AUTH.VERIFY.STATUS` 待验证／成功／无效／无法确认；`AUTH.VERIFY.MESSAGE` 简短下一步提示。

按钮／操作：`AUTH.VERIFY.RESEND` 重发注册验证邮件，可复用账号页邮件输入；`AUTH.VERIFY.LOGIN` 返回登录／账号页。

说明：重发按钮不是对所有邮箱更改／重置回调都可用。成功回调自动安全跳转；当前邮件验证失败页可返回账号页处理。

### 30 AUTH.RESET｜重置密码

内容／字段：`AUTH.RESET.PASSWORD` 新密码；`AUTH.RESET.CONFIRM` 确认密码；`AUTH.RESET.MFA` 必要时验证码；`AUTH.RESET.STATUS` 链接有效／无效、重置结果。

按钮／操作：`AUTH.RESET.SUBMIT` 设置密码并退出；`AUTH.RESET.LOGIN` 返回登录。

### 31 AUTH.JOIN｜接受公司邀请

内容／字段：`AUTH.JOIN.COMPANY` 公司；`AUTH.JOIN.EMAIL` 受邀邮箱；`AUTH.JOIN.ROLE` 受邀身份；`AUTH.JOIN.CURRENT_EMAIL` 当前登录邮箱；`AUTH.JOIN.STATUS` 邀请状态；`AUTH.JOIN.EXPIRY` 有可用数据时展示到期信息。

按钮／操作：`AUTH.JOIN.LOGIN` 登录／注册；`AUTH.JOIN.ACCEPT` 接受邀请；`AUTH.JOIN.RECHECK` 重新检查；`AUTH.JOIN.ENTER` 成功后进入公司；`AUTH.JOIN.CHANGE_ACCOUNT` 前往退出／换账号；`AUTH.JOIN.BACK` 返回账号页。

### 32 AUTH.WAIT｜等待公司邀请

内容／字段：`AUTH.WAIT.IDENTITY` 已登录邮箱／身份；`AUTH.WAIT.STATUS` 尚无可用公司；`AUTH.WAIT.MESSAGE` 等待邀请／联系负责人提示，不是自行创建公司入口。

按钮／操作：`AUTH.WAIT.RELOAD` 重新读取公司资料；`AUTH.WAIT.PROFILE` 个人资料；`AUTH.WAIT.LOGOUT` 退出。

### 33 AUTH.PROFILE_FIRST｜首次补齐资料

形式：复用 PRO，初次引导状态，不重复创建一套资料字段。

内容／字段：使用 `PRO.NAME`、`PRO.WHATSAPP`、`PRO.SAVE_STATE`；`AUTH.PROFILE_FIRST.MESSAGE` 补齐资料的简短提示。

按钮／操作：使用 `PRO.SAVE`、`PRO.CONTINUE`；必要读取失败使用 PRO.RELOAD。

## 6. 外部顾客画面

### 34 PUB｜顾客产品目录

权限：有效链接访客，不登录。无员工导航、无价格、无顾客购物车／下单／支付。

内容／字段：

| 代号 | 名称 |
|---|---|
| PUB.COMPANY | 公司名称 |
| PUB.CONTACT | 分享联系人区域 |
| PUB.CONTACT.NAME | 分享销售员姓名 |
| PUB.CONTACT.WHATSAPP | 工作号码 |
| PUB.SEARCH | 产品搜索 |
| PUB.CATEGORY | 链接可见产品的分类选择 |
| PUB.TOTAL | 匹配产品数量 |
| PUB.EXPIRY | 到期时间 |
| PUB.LIST | 产品列表，每页 30 项 |
| PUB.CARD.IMAGE | 产品缩略图 |
| PUB.CARD.NAME | 产品名称 |
| PUB.CARD.SKU | 编号 |
| PUB.CARD.UNIT | 单位 |
| PUB.CARD.TYPE | 商品／服务 |
| PUB.CARD.CATEGORY | 分类 |
| PUB.CARD.TAGS | 标签 |
| PUB.DETAIL_IMAGE | 展开的原图 |
| PUB.DESCRIPTION | 展开的说明 |
| PUB.IMAGE_STATE | 图片读取失败／无图 |
| PUB.FOOTER | JomSales 品牌标识 |

按钮／操作：`PUB.DETAIL` 查看详情；`PUB.CLOSE_DETAIL` 收起详情；`PUB.INQUIRE` WhatsApp 询价，带产品编号并联系分享员工；`PUB.REFRESH` 刷新目录；G 分页。

### 35 PUB.INVALID｜目录链接失效

父画面：PUB 的状态，不是新的公开业务入口。

内容／字段：`PUB.INVALID.STATUS` 无效／到期／撤销／无法访问；`PUB.INVALID.MESSAGE` 不泄露公司私有资料的提示。

按钮／操作：`PUB.INVALID.REFRESH` 重新检查／刷新，复用 PUB.REFRESH。

保护：链接无效时不能继续显示产品、旧联系人或凭空提供联系方式；建议提示向原分享者索取新链接。

## 7. 平台负责人画面

只属于平台负责人，不与商家 ADM 混称“管理员后台”。当前同在 /platform，可按画面区分。

### 36 PLT.LIST｜商家公司列表

内容／字段：

| 代号 | 名称 |
|---|---|
| PLT.SEARCH | 公司搜索输入 |
| PLT.COMPANY_LIST | 商家公司列表 |
| PLT.CARD.NAME | 公司名称 |
| PLT.CARD.PRIMARY_ADMIN | 正管理员邮箱 |
| PLT.CARD.PLAN | 配套身份 |
| PLT.CARD.SERVICE_STATE | 服务状态 |
| PLT.CARD.SERVICE_UNTIL | 截止时间 |
| PLT.CARD.MEMBERS | 成员数量 |
| PLT.CARD.PRODUCTS | 产品数量 |
| PLT.CARD.STORAGE | 图片用量估算 |
| PLT.ACCESS_STATE | 平台权限／验证状态 |

按钮／操作：`PLT.QUERY` 查询；`PLT.NEW` 开通公司；`PLT.MANAGE` 管理选中公司；`PLT.RECHECK_ACCESS` 重新检查权限；`PLT.SECURITY` 前往双重验证；G 分页；G.BACK 返回个人账号。

### 37 PLT.NEW｜开通公司

内容／字段：`PLT.NEW_NAME` 公司名称输入；`PLT.NEW_ADMIN_EMAIL` 正管理员邮箱输入；`PLT.NEW_INVITE_URL` 刚生成邀请链接；`PLT.NEW_INVITE_EXPIRY` 邀请有效信息；`PLT.NEW_RESULT` 开通结果。

按钮／操作：`PLT.CREATE_INVITE` 开通并生成管理员邀请；`PLT.COPY_INVITE` 复制邀请；G.BACK 返回公司列表。

说明：没有代客户填写／查看密码的字段；邀请尚未自动发送。

### 38 PLT.COMPANY｜商家公司管理

内容／字段：

| 代号 | 名称 |
|---|---|
| PLT.COMPANY_NAME | 被管理公司名称 |
| PLT.SERVICE_STATE | 服务状态选择 |
| PLT.SERVICE_UNTIL | 服务截止时间 |
| PLT.PLAN | Lite／Pro／Premium／Customize 配套身份 |
| PLT.SEAT_LIMIT | 成员额度 |
| PLT.PRODUCT_LIMIT | 产品额度 |
| PLT.RESERVED_CONFIG | 预留配套配置区域 |
| PLT.STORAGE_RESERVED | 预留图片额度 |
| PLT.FEATURES_RESERVED | 预留功能 JSON |
| PLT.MEMBERS | 公司成员列表 |
| PLT.MEMBER.NAME | 姓名 |
| PLT.MEMBER.EMAIL | 邮箱 |
| PLT.MEMBER.ROLE | 身份 |
| PLT.MEMBER.STATUS | 访问／移除状态 |
| PLT.PRIMARY_EMAIL | 首次／重新邀请正管理员邮箱 |
| PLT.AUDIT_LIST | 平台操作记录 |
| PLT.AUDIT_LIST.TIME | 操作时间 |
| PLT.AUDIT_LIST.ACTION | 操作类型 |
| PLT.AUDIT_LIST.DETAILS | 记录详情 |

按钮／操作：`PLT.SAVE` 保存公司设置；`PLT.DISABLE_MEMBER` 停用；`PLT.ENABLE_MEMBER` 恢复；`PLT.REMOVE_MEMBER` 移除；`PLT.CHANGE_PRIMARY` 更换正管理员；`PLT.REINVITE_PRIMARY` 生成管理员邀请；`PLT.AUDIT` 展开最近记录；生成邀请结果复用 PLT.COPY_INVITE；G.BACK 返回列表。

说明：成员／产品额度已生效；图片总额、按配套功能限制、自动收费仍未完成。平台权限不自动授予商家销售资料访问权。

## 8. 通用状态 ST（不是额外页面）

| 代号 | 名称 | 主要所属位置 |
|---|---|---|
| ST.LOADING | 正在读取 | 查询、列表、身份确认 |
| ST.EMPTY | 没有资料 | 空列表 |
| ST.NO_RESULTS | 没有匹配结果 | 搜索／筛选 |
| ST.SAVING | 正在保存 | 表单、报价 |
| ST.SAVED | 已保存 | 保存完成 |
| ST.UNSAVED | 有未保存修改 | 当前报价、表单、任务 |
| ST.ERROR | 读取／保存／操作失败 | 相关操作区域 |
| ST.CONFLICT | 资料已变化 | 报价／产品／调价冲突 |
| ST.NO_ACCESS | 无权限／访问已停用 | 公司、成员、后台 |
| ST.EXPIRED | 到期 | 邀请、目录、服务状态 |
| ST.LIMIT | 达到额度／数量限制 | 新增、邀请、选择、导入 |
| ST.IMAGE_ERROR | 图片无法读取 | 产品、品牌 |
| ST.FILE_PREPARING | 正在准备文件 | PDF／产品卡片 |
| ST.SHARE_UNSUPPORTED | 浏览器无法直接分享 | 提供已有下载替代 |
| ST.SHARE_CANCELLED | 用户取消分享 | 保留可继续的内容 |
| ST.TASK_PAUSED | 任务已暂停 | IMP／PRC |
| ST.PARTIAL_RESULT | 部分成功／部分未完成 | IMP／PRC |
| ST.VERIFIED | 验证已通过 | 邮箱／双重验证 |

每个状态的文案和样式属于对应页面，不能把状态堆成首页长说明。

## 9. 确认弹窗 D（复用 G.CONFIRM）

| 代号 | 名称 | 主要所属页面／触发点 |
|---|---|---|
| D.DISCARD | 放弃未保存修改 | QTE、PDE、CUE、PRO、配置及任务；具体保护按实现 |
| D.QUOTE_REPLACE | 替换当前报价任务 | CAT.NEW_QUOTE、QTL.SELECT、QTL.DUPLICATE；连续工作流待实现 |
| D.COMPANY_CHANGE | 切换公司处理当前任务 | ME.COMPANY／公司选择器；连续工作流待实现 |
| D.LOGOUT | 退出处理未完成任务 | ME.LOGOUT；连续工作流待实现 |
| D.PRODUCT_DELETE | 删除产品 | CAT.DELETE_PRODUCT |
| D.QUOTE_TRASH | 报价移入回收站 | QTL.DELETE |
| D.PAID_CONFIRM | 确认全额收款 | QTL.SET_PAID |
| D.PAID_CORRECT | 更正已收款状态 | QTL.CORRECT_STATUS |
| D.CUSTOMER_STATE | 停用／恢复客户 | CUS.DEACTIVATE、CUS.RESTORE |
| D.LINK_REVOKE | 永久撤销目录链接 | SHR.REVOKE |
| D.SELECTION_CLEAR | 清空已选产品 | SHC.CLEAR |
| D.PHONE_CHANGE | 更改号码撤销旧链接 | PRO.SAVE 中的号码变更 |
| D.PRODUCT_PERMISSION | 调整产品管理权限 | TEAM.PRODUCT_PERMISSION |
| D.EMPLOYEE_DISABLE | 停用员工 | TEAM.DISABLE |
| D.EMPLOYEE_ENABLE | 恢复员工 | TEAM.ENABLE |
| D.EMPLOYEE_REMOVE | 移除员工 | TEAM.REMOVE |
| D.ROLE_CHANGE | 设置／撤销副管理员 | TEAM.PROMOTE、TEAM.DEMOTE |
| D.INVITE_REVOKE | 撤销邀请 | INV.REVOKE |
| D.CATEGORY_CHANGE | 分类重命名／停用／恢复 | CTG，保留现有必要确认 |
| D.BULK_PUBLIC | 修改全部搜索结果公开状态 | VIS.ALLOW_MATCHES、VIS.HIDE_MATCHES |
| D.PRICE_APPLY | 提交调价 | PRC.APPLY、PRC.CSV_APPLY |
| D.PRICE_REBASE | 重读原价、保留新价 | PRC.REFRESH_BASE |
| D.PRICE_RESET | 开始新任务／重置检查 | PRC.NEW_TASK、PRC.CSV_RESTART |
| D.PRICE_CLEAR | 清空未提交调价清单 | PRC.CLEAR |
| D.IMPORT_APPLY | 确认新增导入 | IMP.APPLY |
| D.IMPORT_RESET | 放弃当前导入预览／进度 | IMP.RESTART |
| D.PLATFORM_MEMBER | 平台调整成员状态 | PLT.DISABLE_MEMBER、PLT.ENABLE_MEMBER、PLT.REMOVE_MEMBER |
| D.PRIMARY_CHANGE | 更换正管理员 | PLT.CHANGE_PRIMARY |

这是确认画面的设计归类，不要求给每一次普通操作都添加新弹窗。两个按钮统一用 G.CONFIRM.CONFIRM／G.CONFIRM.CANCEL。

## 10. 不需要单独设计的入口与未完成范围

- `/`：登录检查／跳转，不新增欢迎首页。
- `/migration`：旧链接兼容跳转，不恢复浏览器资料迁移入口。
- `/auth/callback`：使用 AUTH.VERIFY 的处理中／成功／失败状态，不设计额外业务页面。
- 旧布局的重复“公司账号”“注册／登录”入口归入 ME／AUTH，不在已登录产品首页重复堆放。
- 没有顾客购物车、下单、付款、库存进出货、多仓库、完整语言切换、自动订阅页面；本次不为它们画误导性的空按钮。
- 容量／功能配置预留只能在平台高级设置表达，不能宣称已经完整执行。
- 多公司切换、返回位置保留、固定导航、专注画面重组等是设计规则，后续开发仍需逐项实现和验证。

## 11. Figma 命名示例

Frame：`CAT｜产品目录｜销售员`、`CAT｜产品目录｜管理员`、`QTE｜报价编辑｜新报价`、`QTE｜报价编辑｜编辑原单`。

图层／组件：`CAT.SEARCH｜搜索产品`、`QTE.DISCOUNT｜折扣金额`、`PRC.NEW_PRICE｜新价输入`、`TEAM.PRODUCT_PERMISSION｜产品管理开关`。

共用实例：`QTL / G.PAGE_NEXT｜下一页`；状态：`QTE / ST.SAVING｜保存中`；弹窗：`D.QUOTE_REPLACE｜替换当前报价`。

同一个代码元素不因视觉摆放变化而换代号。销售员／管理员、正常／失败、空／有数据使用变体区分。
