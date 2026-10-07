"use client";
// PDE｜新增／编辑产品 — two steps as in Figma (daily-flow-spec §4).
import { useRef, useState } from "react";
import { MAX_UNIT_PRICE, moneyToCents } from "../../quotation-utils";
import { prepareUploadImage } from "../../images";
import { InlineError, Sheet, useConfirm } from "../../ui";
import Icon from "../../icons";

function initialFields(record, categories) {
  if (!record) return { serial: "", name: "", price: "", image: "", thumbnail: "", unit: "件", category: "", tags: "", description: "" };
  const match = categories.find(c => c.name.toLowerCase() === record.category?.trim().toLowerCase());
  return { serial: record.serial, name: record.name, price: String(record.price), image: record.image || "", thumbnail: "",
    unit: record.unit || "件", category: match?.name || record.category || "", tags: (record.tags || []).join(", "), description: record.description || "" };
}

export default function ProductForm({ record, categories, busy, onSave, onClose }) {
  const confirm = useConfirm();
  const initial = useRef(initialFields(record, categories));
  const pendingId = useRef(null), imageToken = useRef(0), fileInput = useRef(null);
  const [fields, setFields] = useState(initial.current);
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({}), [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false), [imageLoading, setImageLoading] = useState(false);
  const editing = !!record;
  const dirty = JSON.stringify(fields) !== JSON.stringify(initial.current);
  const set = (key, value) => { setFields(prev => ({ ...prev, [key]: value })); setErrors(prev => ({ ...prev, [key]: "" })); };

  async function close() {
    if (saving) return;
    if (dirty && !(await confirm({ title: "放弃修改？", message: "关闭后，这次填写的内容不会保存。", cancelLabel: "继续编辑", confirmLabel: "放弃", danger: true }))) return;
    onClose();
  }

  async function pickImage(file) {
    if (!file) return;
    const token = ++imageToken.current;
    setImageLoading(true); setFormError("");
    try {
      const converted = await prepareUploadImage(file);
      const small = await prepareUploadImage(await (await fetch(converted)).blob(), { maxSide: 320 });
      if (imageToken.current === token) setFields(prev => ({ ...prev, image: converted, thumbnail: small }));
    } catch (err) { if (imageToken.current === token) setFormError(err.message || "图片转换失败，请重试。"); }
    finally { if (imageToken.current === token) setImageLoading(false); }
  }

  function removeImage() { imageToken.current += 1; setImageLoading(false); setFields(prev => ({ ...prev, image: "", thumbnail: "" })); }

  async function submit(event) {
    event?.preventDefault();
    if (saving || busy || imageLoading) return;
    const next = {};
    if (!fields.name.trim()) next.name = "请填写名称";
    const cents = moneyToCents(fields.price.trim().replace(/^\./, "0."));
    if (!fields.price.trim()) next.price = "请填写价格";
    else if (cents === null || cents / 100 > MAX_UNIT_PRICE) next.price = "请输入有效价格，最多两位小数";
    if (editing && !fields.serial.trim()) next.serial = "编辑时需要产品编号";
    if (Object.keys(next).length) { setErrors(next); setStep(1); return; }
    const item = {
      id: record?.id || (pendingId.current ||= crypto.randomUUID()),
      serial: fields.serial.trim(), name: fields.name.trim(),
      tags: fields.tags.split(",").map(tag => tag.trim()).filter(Boolean),
      price: (cents / 100).toFixed(2), image: fields.image, thumbnail: fields.thumbnail,
      unit: fields.unit.trim() || "件", category: fields.category, description: fields.description,
      // PDE.TYPE removed: new items are goods; editing keeps the original value.
      is_service: record ? record.is_service === true : false
    };
    setSaving(true); setFormError("");
    try { await onSave(item, record); onClose(); }
    catch (err) { setFormError(`保存失败：${err.message}。内容仍保留，请检查网络后重试。`); }
    finally { setSaving(false); }
  }

  const saveLabel = saving ? "保存中…" : imageLoading ? "正在处理图片…" : editing ? "保存修改" : "保存产品";
  const activeCategories = categories.filter(c => c.active);

  if (step === 2) {
    return (
      <Sheet title="更多设置" subtitle="填写产品资料后保存" onClose={close} footer={<>
        <InlineError>{formError}</InlineError>
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>返回</button>
          <button type="button" className="btn btn-primary" disabled={saving || busy || imageLoading} onClick={submit}>{saveLabel}</button>
        </div></>}>
        <div className="fields-2">
          <label className="field"><span className="field-label">单位</span>
            <input className="input" value={fields.unit} maxLength={30} placeholder="件" onChange={e => set("unit", e.target.value)} /></label>
          <label className="field"><span className="field-label">产品分类</span>
            <select className="input" value={fields.category} onChange={e => set("category", e.target.value)}>
              <option value="">未分类</option>
              {activeCategories.map(c => <option key={c.id || c.name} value={c.name}>{c.name}</option>)}
              {fields.category && !activeCategories.some(c => c.name === fields.category) && <option value={fields.category}>{fields.category}（已停用）</option>}
            </select></label>
        </div>
        <label className="field"><span className="field-label">标签</span>
          <input className="input" value={fields.tags} placeholder="分类, 材质, 款式" onChange={e => set("tags", e.target.value)} />
          <span className="field-hint">多个标签用逗号分开</span></label>
        <label className="field"><span className="field-label">说明</span>
          <textarea className="input" rows={5} maxLength={2000} value={fields.description} onChange={e => set("description", e.target.value)} /></label>
      </Sheet>
    );
  }

  return (
    <Sheet title={editing ? "编辑产品" : "新增产品"} subtitle="填写产品资料后保存" onClose={close} footer={<>
      <InlineError>{formError}</InlineError>
      <button type="button" className="btn btn-primary btn-block" disabled={saving || busy || imageLoading} onClick={submit}>{saveLabel}</button></>}>
      <form className="stack" onSubmit={submit} noValidate>
        {record?.imageError && <InlineError>{record.imageError} 只改文字会保留原照片；重新上传可修复。</InlineError>}
        <label className="field"><span className="field-label">产品编号{editing ? "*" : ""}</span>
          <input className="input" value={fields.serial} maxLength={120} placeholder={editing ? "" : "例如 TEST-0001（留空自动编号）"} aria-invalid={!!errors.serial}
            onChange={e => set("serial", e.target.value)} />
          {errors.serial && <span className="field-error">{errors.serial}</span>}</label>
        <label className="field"><span className="field-label">名称*</span>
          <input className="input" value={fields.name} maxLength={240} placeholder="例如 Sample Product A" aria-invalid={!!errors.name} onChange={e => set("name", e.target.value)} />
          {errors.name && <span className="field-error">{errors.name}</span>}</label>
        <div className="field"><span className="field-label" id="pde-price">价格*</span>
          <div className="input-group" aria-invalid={!!errors.price}><span className="prefix">RM</span>
            <input className="input" aria-labelledby="pde-price" inputMode="decimal" placeholder="0.00" value={fields.price} onChange={e => set("price", e.target.value)} /></div>
          {errors.price && <span className="field-error">{errors.price}</span>}</div>
        <div className="field"><div className="row-between"><span className="field-label">照片</span><span className="field-label">更多设置</span></div>
          <div className="row" style={{ gap: 12 }}>
            {fields.image ? <div className="row grow">
              <span className="thumb-preview"><img src={fields.image} alt="照片预览" /></span>
              <div className="stack-sm"><button type="button" className="text-btn" onClick={() => fileInput.current?.click()}>更换</button>
                <button type="button" className="text-btn danger" onClick={removeImage}>移除</button></div>
            </div> : <button type="button" className="btn btn-secondary btn-sm grow" disabled={imageLoading} onClick={() => fileInput.current?.click()}>{imageLoading ? "处理中…" : "选择照片"}</button>}
            <button type="button" className="btn btn-primary btn-sm" style={{ minWidth: 84 }} aria-label="更多设置" onClick={() => setStep(2)}><Icon name="arrowRight" size={20} strokeWidth={2.25} /></button>
          </div>
          <input ref={fileInput} type="file" hidden aria-label="产品照片" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
            onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void pickImage(file); }} />
          <span className="field-hint">JPG、PNG、WebP 或 HEIC，最大 12MB，会自动压缩。</span>
        </div>
      </form>
    </Sheet>
  );
}
