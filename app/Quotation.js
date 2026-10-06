"use client";

import { useState } from "react";
import Link from "next/link";
import { MAX_QUANTITY, MAX_UNIT_PRICE, formatMoney, lineCents, moneyToCents,
  quotationTotals, quantityToMillis } from "./quotation-utils";
import { canShareFile, downloadFile } from "./share";
import CustomerPicker from "./CustomerPicker";
import TemporaryItem from "./TemporaryItem";
const signature = (items, details, company, edits = {}) => JSON.stringify({ items, details,
  company: { name: company.name, contact: company.contact, logo_path: company.logo_path }, edits });

export default function Quotation({ quotation, context, onBack, onComplete }) {
  const { items = [], setItems, details, setDetails, company, ready, error } = quotation;
  const [edits, setEdits] = useState({});
  const [generating, setGenerating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState("");
  const [pdf, setPdf] = useState(null);

  const totals = quotationTotals(items, details.discount);
  const invalidRows = items.some(item => {
    const draft = edits[item.product.id];
    return lineCents(item) === null || (draft && (
      quantityToMillis(draft.quantity) === null || moneyToCents(draft.unitPrice) === null ||
      Number(draft.unitPrice) > MAX_UNIT_PRICE
    ));
  });
  const fingerprint = signature(items, details, company, edits);
  const currentPdf = !quotation.dirty && pdf?.fingerprint === fingerprint ? pdf.file : null;
  const locked = generating || sharing || quotation.busy || !ready;

  function updateLine(item, field, value) {
    const draft = { quantity: String(item.quantity), unitPrice: String(item.unitPrice),
      ...edits[item.product.id], [field]: value };
    setEdits(prev => ({ ...prev, [item.product.id]: draft }));
    setMessage("");
    if (quantityToMillis(draft.quantity) === null || moneyToCents(draft.unitPrice) === null ||
        Number(draft.unitPrice) > MAX_UNIT_PRICE) { quotation.markDirty(); return; }
    const next = { ...item, quantity: Number(draft.quantity), unitPrice: Number(draft.unitPrice) };
    next.lineTotal = lineCents(next) / 100;
    setItems(prev => prev.map(line => line.product.id === item.product.id ? next : line));
  }

  function updateDetails(key, value) {
    setDetails(prev => ({ ...prev, [key]: value }));
    setMessage("");
  }

  function removeItem(id) {
    setItems(prev => prev.filter(item => item.product.id !== id));
    setEdits(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setMessage("");
  }

  function startNewQuotation() {
    if (!quotation.startNew()) return;
    setEdits({}); setPdf(null); setMessage("");
  }

  async function generatePdf(event, prepareShare = false) {
    event.preventDefault();
    if (locked || !items.length || invalidRows || totals.total === null) return;
    if (quotation.temporaryDraft) { setMessage("临时项目还未加入，请先加入本张报价或清空临时输入。"); return; }
    if (!details.customerName.trim() || !company.name.trim() || !details.date) {
      setMessage("请填写客户名称、公司名称和报价日期。");
      return;
    }
    setGenerating(true);
    setPdf(null);
    setMessage("");
    try {
      const { createQuotationPdf } = await import("./quotation-pdf");
      const saved = await quotation.save();
      if (saved.company.logoError) throw new Error(saved.company.logoError);
      const file = await createQuotationPdf(saved);
      setEdits({});
      setPdf({ file, fingerprint: signature(saved.items, saved.details, saved.company) });
      if (prepareShare) setMessage("报价已自动保存，PDF 已准备好。请点击分享；取消分享不会清空当前报价。");
      else { downloadFile(file); onComplete(file, saved.row.id); }
    } catch (err) {
      setMessage(err.message || "PDF 生成失败，请重试。");
    } finally {
      setGenerating(false);
    }
  }

  async function sharePdf() {
    if (!currentPdf || sharing) return;
    if (!canShareFile(currentPdf)) {
      setMessage("此浏览器无法直接分享 PDF。请下载后在 WhatsApp 中选择附件 → 文档发送。");
      return;
    }
    setSharing(true);
    setMessage("");
    try {
      // The file is prepared beforehand so this call retains the tap's user activation.
      await navigator.share({ files: [currentPdf], title: `Quotation ${details.number}` });
      onComplete(currentPdf, quotation.row.id);
    } catch (err) {
      setMessage(err.name === "AbortError" ? "分享已取消，当前报价保留，可重试分享或继续编辑。" : "未能分享 PDF，当前报价保留。请下载文件后在 WhatsApp 中发送。");
    } finally {
      setSharing(false);
    }
  }

  return (
    <main className="page quotationPage">
      <div className="quotationNavigation">
        <button type="button" className="cancelButton" onClick={onBack} disabled={locked}>
          ← 返回产品目录
        </button>
        <button type="button" className="textButton" onClick={startNewQuotation} disabled={locked}>
          新建报价
        </button>
      </div>
      <header className="quotationHeading">
        <div className="eyebrow">JOMSALES · QUOTATION</div>
        <h1>报价清单</h1>
        <p className="activeQuotation">{quotation.row.revision ? `正在编辑：${details.number}` : "新报价"}</p>
        {quotation.copiedFrom&&<p>复制自 {quotation.copiedFrom}，请确认历史价格与条款。保存为新报价，不覆盖原单。</p>}
        <p>编辑产品，填写客户资料，生成报价 PDF。</p>
      </header>
      {error && <p className="quotationError" role="alert">{error}</p>}
      <p role="status">{quotation.dirty ? "有未保存修改（仅在当前页面内存）。生成／分享时自动保存。" : quotation.message || "生成／分享时自动保存到公司云端。"}</p>
      {company.logoError && <p className="quotationError" role="alert">{company.logoError}</p>}
      <Link href={`/quotations?company=${context.companyId}`}>已保存报价</Link>
      <TemporaryItem quotation={quotation} disabled={locked}/>

      <form onSubmit={event => generatePdf(event)}>
        <fieldset className="quotationFields" disabled={locked}>
          <section className="quotationSection" aria-labelledby="quotationItemsTitle">
            <h2 id="quotationItemsTitle">产品 <span>{items.length} 项</span></h2>
            {!items.length ? (
              <div className="empty">
                <p>报价清单还没有产品。</p>
                <button type="button" className="saveButton" onClick={onBack}>返回目录选择产品</button>
              </div>
            ) : items.map(item => {
              const draft = edits[item.product.id];
              const quantity = draft?.quantity ?? String(item.quantity);
              const unitPrice = draft?.unitPrice ?? String(item.unitPrice);
              const quantityInvalid = quantityToMillis(quantity) === null;
              const priceInvalid = moneyToCents(unitPrice) === null || Number(unitPrice) > MAX_UNIT_PRICE;
              return (
                <article className="quotationItem" key={item.product.id}>
                  <div className="quotationItemHeading">
                    <div><h3>{item.product.name}</h3><p>{item.product.serial} · {item.product.unit || "件"}{item.product.is_service && " · 服务"}{item.product.temporary && " · 不进入目录"}</p>{item.product.description && <p>{item.product.description}</p>}</div>
                    <button type="button" className="deleteButton" aria-label={`移除 ${item.product.name}`}
                      onClick={() => removeItem(item.product.id)}>移除</button>
                  </div>
                  <div className="quotationItemInputs">
                    <label>数量（{item.product.unit || "件"}）
                      <input type="number" min="0.001" max={MAX_QUANTITY} step="0.001" required
                        aria-label={`${item.product.serial} 数量`} aria-invalid={quantityInvalid}
                        inputMode="decimal" value={quantity} onChange={e => updateLine(item, "quantity", e.target.value)} />
                    </label>
                    <label>单价（RM）
                      <input type="number" min="0" max={MAX_UNIT_PRICE} step="0.01" required
                        aria-label={`${item.product.serial} 单价`} aria-invalid={priceInvalid}
                        inputMode="decimal" value={unitPrice} onChange={e => updateLine(item, "unitPrice", e.target.value)} />
                    </label>
                  </div>
                  {(quantityInvalid || priceInvalid) && <p className="quotationError">数量须大于零，最多三位小数；单价须为非负金额，最多两位小数。</p>}
                  <div className="lineTotal">行金额 <strong>{quantityInvalid || priceInvalid ? "—" : formatMoney(lineCents(item))}</strong></div>
                </article>
              );
            })}
          </section>

          <section className="quotationSection" aria-labelledby="quotationCustomerTitle">
            <h2 id="quotationCustomerTitle">客户资料</h2>
            <CustomerPicker context={context} disabled={locked} onSelect={row=>setDetails(prev=>({...prev,customerName:row.name,customerCompany:row.company,phone:row.phone,email:row.email,address:row.address,customerId:row.id}))}/>
            {details.customerId&&<button type="button" onClick={()=>updateDetails("customerId",null)}>取消通讯录关联（保留本张资料）</button>}
            <Link href={`/customers?company=${context.companyId}`}>管理客户通讯录</Link>
            <label>客户名称 *
              <input value={details.customerName} required maxLength={120} autoComplete="name"
                onChange={e => updateDetails("customerName", e.target.value)} placeholder="客户或公司名称" />
            </label>
            <details><summary>客户公司、邮箱与地址</summary>
              <label>客户公司<input maxLength={120} value={details.customerCompany || ""} onChange={e=>updateDetails("customerCompany",e.target.value)}/></label>
              <label>客户邮箱<input type="email" maxLength={254} value={details.email || ""} onChange={e=>updateDetails("email",e.target.value)}/></label>
              <label>客户地址<textarea aria-label="客户地址" rows={2} maxLength={1000} value={details.address || ""} onChange={e=>updateDetails("address",e.target.value)}/></label>
            </details>
            <label>客户电话
              <input type="tel" value={details.phone} maxLength={40} autoComplete="tel"
                onChange={e => updateDetails("phone", e.target.value)} placeholder="例如 +60 12 345 6789" />
            </label>
          </section>

          <section className="quotationSection" aria-labelledby="quotationInfoTitle">
            <h2 id="quotationInfoTitle">报价资料</h2>
            <label>报价编号<input value={details.number || "保存时自动分配"} readOnly /></label>
            <label>日期 *<input type="date" value={details.date} required
              onChange={e => updateDetails("date", e.target.value)} /></label>
            <label>备注<textarea aria-label="备注" value={details.notes} maxLength={3000} rows={3}
              onChange={e => updateDetails("notes", e.target.value)} placeholder="例如报价有效期、交货说明" /></label>
            <details><summary>有效期与付款条款</summary>
              <label>有效天数<input type="number" min={1} max={365} value={details.validityDays || ""} placeholder="未设置" onChange={e=>updateDetails("validityDays",e.target.value)}/></label>
              <label>付款条款<textarea aria-label="付款条款" rows={3} maxLength={1500} value={details.paymentTerms || ""} onChange={e=>updateDetails("paymentTerms",e.target.value)}/></label>
            </details>
            <label>折扣（RM）<input type="number" min="0" step="0.01" inputMode="decimal"
              value={details.discount} aria-invalid={totals.total === null}
              onChange={e => updateDetails("discount", e.target.value)} /></label>
            {totals.total === null && !invalidRows && <p className="quotationError">折扣须为非负金额，最多两位小数，且不能超过小计。</p>}
            <dl className="quotationTotals">
              <div><dt>小计</dt><dd>{invalidRows ? "—" : formatMoney(totals.subtotal)}</dd></div>
              <div><dt>折扣</dt><dd>{formatMoney(totals.discount)}</dd></div>
              <div className="grandTotal"><dt>总额</dt><dd>{invalidRows ? "—" : formatMoney(totals.total)}</dd></div>
            </dl>
          </section>

          <section className="quotationSection companySettings">
            <h2>公司资料（首次保存时的快照）</h2>
            <p>{company.name} · {company.contact}</p>
            {company.logo && <div className="companyLogoPreview"><img src={company.logo} alt="公司 Logo" /></div>}
            <p>历史报价不会随产品或公司品牌修改而改变。</p>
            {context.role === "admin" && <Link href={`/brand?company=${context.companyId}`}>管理公司品牌（新报价生效）</Link>}
          </section>
        </fieldset>

        <button type="submit" className="generatePdfButton saveButton"
          disabled={locked || !items.length || invalidRows || totals.total === null || !!company.logoError}>
          {generating ? "正在生成 PDF…" : "生成报价 PDF"}
        </button>
        <button type="button" className="whatsappButton"
          disabled={locked || !items.length || invalidRows || totals.total === null || !!company.logoError}
          onClick={event => generatePdf(event, true)}>准备分享 PDF（自动保存）</button>
      </form>
      {currentPdf && <div className="pdfActions">
        <button type="button" className="cancelButton" disabled={locked} onClick={() => { downloadFile(currentPdf); onComplete(currentPdf, quotation.row.id); }}>下载 PDF</button>
        <button type="button" className="whatsappButton" disabled={sharing} onClick={sharePdf}>
          {sharing ? "正在打开分享…" : "分享 PDF"}
        </button>
      </div>}
      <p className="quotationMessage" role="status" aria-live="polite">{message}</p>
    </main>
  );
}
