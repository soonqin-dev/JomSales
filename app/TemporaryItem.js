"use client";
// TMP｜临时项目 — daily-flow-spec §6. Added to this quote only, never to the catalog.
import { useState } from "react";
import { InlineError, Sheet, useConfirm } from "./ui";

const EMPTY = { name: "", price: "", quantity: "1", unit: "件", description: "" };

export default function TemporaryItem({ quotation, onClose, onAdded }) {
  const confirm = useConfirm();
  const [draft, setDraft] = useState(EMPTY), [error, setError] = useState("");
  const set = (key, value) => { setDraft(prev => ({ ...prev, [key]: value })); setError(""); };
  const touched = JSON.stringify(draft) !== JSON.stringify(EMPTY);

  async function close() {
    if (touched && !(await confirm({ title: "放弃临时项目？", message: "还没加入本单的内容会被清空。", cancelLabel: "继续填写", confirmLabel: "放弃", danger: true }))) return;
    onClose();
  }

  function add(event) {
    event.preventDefault();
    try { quotation.addTemporary(draft); onAdded?.(draft.name.trim()); onClose(); }
    catch (err) { setError(err.message); }
  }

  return (
    <Sheet title="临时项目" subtitle="只加入本张报价，不会进入产品目录" bottom onClose={close} footer={
      <div className="btn-row">
        <button type="button" className="btn btn-secondary" disabled={!touched} onClick={() => setDraft(EMPTY)}>清空</button>
        <button type="submit" form="tmp-form" className="btn btn-primary">加入本单</button>
      </div>}>
      <form id="tmp-form" className="stack" onSubmit={add} noValidate>
        <label className="field"><span className="field-label">名称*</span>
          <input className="input" maxLength={240} value={draft.name} onChange={e => set("name", e.target.value)} placeholder="例如 安装人工" /></label>
        <div className="fields-2">
          <div className="field"><span className="field-label" id="tmp-price">单价*</span>
            <div className="input-group"><span className="prefix">RM</span>
              <input className="input" aria-labelledby="tmp-price" inputMode="decimal" placeholder="0.00" value={draft.price} onChange={e => set("price", e.target.value)} /></div></div>
          <label className="field"><span className="field-label">数量</span>
            <input className="input" inputMode="decimal" value={draft.quantity} onChange={e => set("quantity", e.target.value)} /></label>
        </div>
        <label className="field"><span className="field-label">单位</span>
          <input className="input" maxLength={30} value={draft.unit} onChange={e => set("unit", e.target.value)} /></label>
        <label className="field"><span className="field-label">说明</span>
          <textarea className="input" rows={3} maxLength={2000} value={draft.description} onChange={e => set("description", e.target.value)} /></label>
        <InlineError>{error}</InlineError>
      </form>
    </Sheet>
  );
}
