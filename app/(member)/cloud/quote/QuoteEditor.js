"use client";
// QTE｜报价编辑 — daily-flow-spec §5. Autosave on download/share; no manual save button.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCurrentQuote, useMember } from "../../../member-context";
import { MAX_QUANTITY, MAX_UNIT_PRICE, formatMoney, lineCents, moneyToCents, quantityToMillis, quotationTotals } from "../../../quotation-utils";
import { canShareFile, downloadFile } from "../../../share";
import CustomerPicker from "../../../CustomerPicker";
import TemporaryItem from "../../../TemporaryItem";
import { EmptyState, InlineError, MoreMenu, SkeletonList, TopBar, useToast } from "../../../ui";
import Icon from "../../../icons";

const signature = (items, details, company, edits = {}) => JSON.stringify({ items, details,
  company: { name: company?.name, contact: company?.contact, logo_path: company?.logo_path }, edits });

export default function QuoteEditor() {
  const member = useMember(), quote = useCurrentQuote();
  const router = useRouter(), toast = useToast();
  const [edits, setEdits] = useState({});
  const [phase, setPhase] = useState("idle"); // idle | saving | rendering | sharing
  const [pdf, setPdf] = useState(null), [pdfError, setPdfError] = useState("");
  const [problems, setProblems] = useState({});
  const [picker, setPicker] = useState(false), [temporary, setTemporary] = useState(false);

  if (!quote.ready) {
    return <main className="app-main qte-page"><TopBar title="当前报价" />
      {quote.error ? <InlineError onRetry={() => void quote.reload()}>{quote.error}</InlineError> : <SkeletonList count={4} height={96} />}</main>;
  }

  const { items = [], details, company } = quote;
  const totals = quotationTotals(items, details.discount);
  const invalidRows = items.some(item => {
    const draft = edits[item.product.id];
    return lineCents(item) === null || (draft && (quantityToMillis(draft.quantity) === null || moneyToCents(draft.unitPrice) === null || Number(draft.unitPrice) > MAX_UNIT_PRICE));
  });
  const fingerprint = signature(items, details, company, edits);
  const readyPdf = !quote.dirty && pdf?.fingerprint === fingerprint ? pdf.file : null;
  const working = phase !== "idle" || quote.busy;
  const editing = !!quote.row?.revision;

  const saveState = quote.busy ? ["pill-muted", "保存中…"] : quote.error && quote.dirty ? ["pill-danger", "保存失败"] : quote.dirty || !editing ? ["pill-warn", "未保存"] : ["pill-green", "已保存"];

  function updateDetails(key, value) { quote.setDetails(prev => ({ ...prev, [key]: value })); setProblems(prev => ({ ...prev, [key]: "" })); }

  function updateLine(item, field, value) {
    const draft = { quantity: String(item.quantity), unitPrice: String(item.unitPrice), ...edits[item.product.id], [field]: value };
    setEdits(prev => ({ ...prev, [item.product.id]: draft }));
    setProblems(prev => ({ ...prev, items: "" }));
    if (quantityToMillis(draft.quantity) === null || moneyToCents(draft.unitPrice) === null || Number(draft.unitPrice) > MAX_UNIT_PRICE) { quote.markDirty(); return; }
    const next = { ...item, quantity: Number(draft.quantity), unitPrice: Number(draft.unitPrice) };
    next.lineTotal = lineCents(next) / 100;
    quote.setItems(prev => prev.map(line => line.product.id === item.product.id ? next : line));
  }

  function step(item, delta) {
    const current = quantityToMillis(edits[item.product.id]?.quantity ?? item.quantity) ?? 1000;
    const next = Math.min(MAX_QUANTITY * 1000, Math.max(1000, current + delta * 1000));
    updateLine(item, "quantity", String(next / 1000));
  }

  // QTE.REMOVE_ITEM: no confirmation; undo from the toast for 5 seconds.
  function removeLine(item) {
    const index = items.findIndex(line => line.product.id === item.product.id);
    quote.setItems(prev => prev.filter(line => line.product.id !== item.product.id));
    setEdits(prev => { const next = { ...prev }; delete next[item.product.id]; return next; });
    toast(`已移除 ${item.product.name}`, { duration: 5000, action: { label: "撤销", onClick: () => quote.setItems(prev => prev.some(line => line.product.id === item.product.id) ? prev : [...prev.slice(0, index), item, ...prev.slice(index)]) } });
  }

  function validate() {
    const next = {};
    if (!items.length) next.items = "还没有项目，请先加入产品或临时项目。";
    else if (invalidRows) next.items = "有项目的数量或单价无效：数量须大于 0（最多三位小数），单价最多两位小数。";
    if (!details.customerName.trim()) next.customerName = "请填写客户名称。";
    if (totals.total === null && !invalidRows) next.discount = "折扣须为有效金额，且不能超过小计。";
    if (!details.date) next.date = "请选择报价日期。";
    if (company?.logoError) next.company = company.logoError;
    setProblems(next);
    if (Object.keys(next).length) { toast(Object.values(next)[0]); return false; }
    return true;
  }

  async function prepare() {
    const { createQuotationPdf } = await import("../../../quotation-pdf");
    setPhase("saving"); setPdfError("");
    let saved;
    try { saved = await quote.save(); }
    catch { setPhase("idle"); return null; } // quote.error shows 保存失败; contents stay.
    try {
      if (saved.company.logoError) throw new Error(saved.company.logoError);
      setPhase("rendering");
      const file = await createQuotationPdf(saved);
      setEdits({});
      const value = { file, fingerprint: signature(saved.items, saved.details, saved.company), id: saved.row.id, number: saved.details.number };
      setPdf(value);
      return value;
    } catch (err) {
      setPdfError(`报价已保存，但 PDF 生成失败：${err.message || "请重试。"}`);
      return null;
    } finally { setPhase("idle"); }
  }

  function finish(value) {
    if (quote.complete(value.id)) {
      quote.setLastPdf({ file: value.file, number: value.number });
      toast("报价已保存");
      router.push("/cloud");
    }
  }

  async function download() {
    if (working || !validate()) return;
    const value = readyPdf ? pdf : await prepare();
    if (!value) return;
    downloadFile(value.file);
    finish(value);
  }

  // Sharing needs a fresh tap after the async save, so the first tap prepares the PDF.
  async function share() {
    if (working || !validate()) return;
    if (!readyPdf) {
      const value = await prepare();
      if (value) toast(canShareFile(value.file) ? "PDF 已准备好，请再点一次「分享报价」" : "此浏览器不能直接分享，可改为下载", { duration: 4000 });
      return;
    }
    if (!canShareFile(readyPdf)) { toast("此浏览器不能直接分享，请改为下载后发送。"); return; }
    setPhase("sharing");
    try { await navigator.share({ files: [readyPdf], title: `Quotation ${details.number}` }); finish(pdf); }
    catch (err) { toast(err.name === "AbortError" ? "已取消分享，报价仍保留" : "分享未完成，可改为下载后发送。"); }
    finally { setPhase("idle"); }
  }

  const busyLabel = phase === "saving" ? "保存中…" : phase === "rendering" ? "生成 PDF…" : phase === "sharing" ? "正在分享…" : null;

  return (
    <main className="app-main qte-page">
      <TopBar title="当前报价" actions={<>
        <Link href="/quotations" className="text-btn">报价记录</Link>
        <MoreMenu disabled={working} items={[
          { label: "新建报价", icon: "plus", onSelect: async () => { if (await quote.startNew()) { setEdits({}); setPdf(null); setProblems({}); } } },
          { label: "重新读取", icon: "refresh", onSelect: async () => { if (await quote.reload()) { setEdits({}); setPdf(null); } } }
        ]} />
      </>} />

      <div className="stack">
        <section className="card row-between" aria-label="报价状态">
          <div className="grow">
            <p className="card-title">{editing ? `正在编辑 ${details.number}` : "新报价"}</p>
            {quote.copiedFrom && <p className="small muted">复制自 {quote.copiedFrom}，请确认价格和条款</p>}
            {quote.message && <p className="small muted">{quote.message}</p>}
          </div>
          <span className={`pill ${saveState[0]}`}>{saveState[1]}</span>
        </section>
        {quote.error && <InlineError>{quote.error}{quote.dirty ? " 内容还在，可再试一次。" : ""}</InlineError>}

        <section className="card stack" aria-labelledby="qte-customer">
          <div className="row-between"><h2 className="section-title" id="qte-customer">客户</h2>
            <button type="button" className="btn btn-secondary btn-sm" disabled={working} onClick={() => setPicker(true)}>选择已有客户</button></div>
          {details.customerId && <div className="row"><span className="chip">已关联：{details.customerName || "客户"}</span>
            <button type="button" className="text-btn" onClick={() => updateDetails("customerId", null)}>取消关联</button></div>}
          <label className="field"><span className="field-label">客户名称*</span>
            <input className="input" value={details.customerName} maxLength={120} autoComplete="off" aria-invalid={!!problems.customerName}
              placeholder="客户或公司名称" onChange={e => updateDetails("customerName", e.target.value)} />
            {problems.customerName && <span className="field-error">{problems.customerName}</span>}</label>
          <label className="field"><span className="field-label">电话</span>
            <input className="input" type="tel" value={details.phone} maxLength={40} placeholder="例如 +60 12 345 6789" onChange={e => updateDetails("phone", e.target.value)} /></label>
          <details className="fold"><summary>更多资料<Icon name="chevronDown" size={18} /></summary>
            <div className="fold-body">
              <label className="field"><span className="field-label">客户公司</span>
                <input className="input" maxLength={120} value={details.customerCompany || ""} onChange={e => updateDetails("customerCompany", e.target.value)} /></label>
              <label className="field"><span className="field-label">邮箱</span>
                <input className="input" type="email" maxLength={254} value={details.email || ""} onChange={e => updateDetails("email", e.target.value)} /></label>
              <label className="field"><span className="field-label">地址</span>
                <textarea className="input" rows={2} maxLength={1000} value={details.address || ""} onChange={e => updateDetails("address", e.target.value)} /></label>
            </div>
          </details>
        </section>

        <section className="card" aria-labelledby="qte-items">
          <div className="row-between"><h2 className="section-title" id="qte-items">项目 <span className="muted small">{items.length} 项</span></h2></div>
          {problems.items && <InlineError>{problems.items}</InlineError>}
          {!items.length ? <EmptyState icon="doc" title="还没有项目" action={<div className="btn-row">
            <Link href="/cloud" className="btn btn-primary btn-sm">去选产品</Link>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTemporary(true)}>添加临时项目</button></div>} />
            : <>
              {items.map(item => {
                const draft = edits[item.product.id];
                const quantity = draft?.quantity ?? String(item.quantity);
                const unitPrice = draft?.unitPrice ?? String(item.unitPrice);
                const qBad = quantityToMillis(quantity) === null, pBad = moneyToCents(unitPrice) === null || Number(unitPrice) > MAX_UNIT_PRICE;
                return (
                  <article className="qte-item" key={item.product.id}>
                    <div className="row-between" style={{ alignItems: "flex-start" }}>
                      <div className="grow">
                        <p className="qname">{item.product.name}</p>
                        <p className="qmeta">{item.product.temporary ? <span className="chip">临时</span> : item.product.serial} · {item.product.unit || "件"}{item.product.is_service ? " · 服务" : ""}</p>
                      </div>
                      <MoreMenu label={`${item.product.name} 的更多操作`} disabled={working} items={[{ label: "移除项目", icon: "trash", danger: true, onSelect: () => removeLine(item) }]} />
                    </div>
                    <div className="qte-line">
                      <div className="stepper" aria-label={`${item.product.name} 数量`}>
                        <button type="button" aria-label="减少数量" disabled={working || (quantityToMillis(quantity) ?? 0) <= 1000} onClick={() => step(item, -1)}><Icon name="minus" size={18} /></button>
                        <input inputMode="decimal" aria-label={`${item.product.serial} 数量`} aria-invalid={qBad} value={quantity} disabled={working} onChange={e => updateLine(item, "quantity", e.target.value)} />
                        <button type="button" aria-label="增加数量" disabled={working} onClick={() => step(item, 1)}><Icon name="plus" size={18} /></button>
                      </div>
                      <div className="unit-price field">
                        <div className="input-group" aria-invalid={pBad}><span className="prefix">RM</span>
                          <input className="input" inputMode="decimal" aria-label={`${item.product.serial} 单价`} value={unitPrice} disabled={working} onChange={e => updateLine(item, "unitPrice", e.target.value)} /></div>
                        <span className="field-hint">单价仅本单</span>
                      </div>
                    </div>
                    <div className="row-between"><span className="small muted">行金额</span><strong className="num">{qBad || pBad ? "—" : formatMoney(lineCents(item))}</strong></div>
                  </article>
                );
              })}
              <div className="btn-row" style={{ marginTop: 12 }}>
                <Link href="/cloud" className="btn btn-secondary btn-sm">去选产品</Link>
                <button type="button" className="btn btn-secondary btn-sm" disabled={working} onClick={() => setTemporary(true)}>添加临时项目</button>
              </div>
            </>}
        </section>

        <section className="card totals" aria-label="金额">
          <div className="row-between"><span className="muted">小计</span><span className="num">{invalidRows ? "—" : formatMoney(totals.subtotal)}</span></div>
          <div className="row-between"><label htmlFor="qte-discount" className="muted">折扣</label>
            <div className="input-group" style={{ width: 160, minHeight: 40 }} aria-invalid={!!problems.discount || (totals.total === null && !invalidRows)}><span className="prefix">RM</span>
              <input id="qte-discount" className="input" style={{ minHeight: 38 }} inputMode="decimal" value={details.discount} disabled={working} onChange={e => updateDetails("discount", e.target.value)} /></div></div>
          {(problems.discount || (totals.total === null && !invalidRows)) && <span className="field-error">折扣须为有效金额，且不能超过小计。</span>}
          <div className="row-between grand"><span>总额</span><span className="num">{invalidRows ? "—" : formatMoney(totals.total)}</span></div>
        </section>

        <section className="card">
          <details className="fold"><summary>更多报价资料<Icon name="chevronDown" size={18} /></summary>
            <div className="fold-body">
              <div className="fields-2">
                <label className="field"><span className="field-label">报价编号</span><input className="input" value={details.number || "保存时自动分配"} readOnly /></label>
                <label className="field"><span className="field-label">日期*</span>
                  <input className="input" type="date" value={details.date} aria-invalid={!!problems.date} onChange={e => updateDetails("date", e.target.value)} /></label>
              </div>
              <label className="field"><span className="field-label">有效天数</span>
                <input className="input" type="number" min={1} max={365} value={details.validityDays || ""} placeholder="未设置" onChange={e => updateDetails("validityDays", e.target.value)} /></label>
              <label className="field"><span className="field-label">付款条款</span>
                <textarea className="input" rows={3} maxLength={1500} value={details.paymentTerms || ""} onChange={e => updateDetails("paymentTerms", e.target.value)} /></label>
              <label className="field"><span className="field-label">备注</span>
                <textarea className="input" rows={3} maxLength={3000} value={details.notes} placeholder="例如交货说明" onChange={e => updateDetails("notes", e.target.value)} /></label>
              <div className="notice-box">
                <div className="row">{company?.logo && <img src={company.logo} alt="" style={{ width: 32, height: 32, objectFit: "contain" }} />}<strong>{company?.name}</strong></div>
                {company?.contact && <p>{company.contact}</p>}
                <p className="small">公司资料以首次保存时为准，之后修改品牌不会改变这张报价。</p>
                {member.role === "admin" && <Link href="/brand" className="text-btn link">公司品牌设置</Link>}
              </div>
              {problems.company && <InlineError>{problems.company}</InlineError>}
            </div>
          </details>
        </section>

        {pdfError && <InlineError onRetry={() => void prepare()} retryLabel="重新生成">{pdfError}</InlineError>}
      </div>

      <div className="sticky-actions">
        <div className="btn-row">
          <button type="button" className="btn btn-share" disabled={working} onClick={share}>
            <Icon name="send" size={18} />{phase === "sharing" ? busyLabel : readyPdf ? "分享 PDF" : busyLabel || "分享报价"}</button>
          <button type="button" className="btn btn-primary" disabled={working} onClick={download}>
            <Icon name="download" size={18} />{busyLabel && phase !== "sharing" ? busyLabel : "下载报价"}</button>
        </div>
      </div>

      {picker && <CustomerPicker context={member} onClose={() => setPicker(false)} onSelect={row => quote.setDetails(prev => ({ ...prev,
        customerName: row.name, customerCompany: row.company, phone: row.phone, email: row.email, address: row.address, customerId: row.id }))} />}
      {temporary && <TemporaryItem quotation={quote} onClose={() => setTemporary(false)} onAdded={name => toast(`已加入 ${name}`)} />}
    </main>
  );
}
