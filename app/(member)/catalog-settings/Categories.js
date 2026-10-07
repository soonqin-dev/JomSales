"use client";
// CTG｜产品分类 — create, rename inline, archive/restore. Archiving never deletes products.
import { useEffect, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/client";
import { readCategories } from "../../../lib/supabase/categories";
import { EmptyState, InlineError, MoreMenu, SkeletonList, useConfirm, useLeaveGuard, useToast } from "../../ui";
import Icon from "../../icons";

export default function Categories({ context, blocked = false, onBusyChange }) {
  const confirm = useConfirm(), toast = useToast();
  const [rows, setRows] = useState(null), [name, setName] = useState(""), [editing, setEditing] = useState(null), [rename, setRename] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const working = useRef(false), pending = useRef(null), alive = useRef(true);
  const dirty = !!name.trim() || (!!editing && rename.trim() !== editing.name);
  useLeaveGuard(dirty, { message: "分类修改还没保存。" });

  async function load() { const data = await readCategories(createClient(), context.companyId); if (alive.current) setRows(data); }
  async function run(task) {
    if (working.current || blocked) return;
    working.current = true; setBusy(true); onBusyChange?.(true); setError("");
    try { await task(); }
    catch (err) { if (alive.current) setError(err.code === "23505" ? "已有相同的分类名称，请编辑或恢复原分类。" : err.message); }
    finally { working.current = false; if (alive.current) { setBusy(false); onBusyChange?.(false); } }
  }
  useEffect(() => { alive.current = true; void run(load); return () => { alive.current = false; }; }, []);

  async function call(target, categoryName, revision, action) {
    const result = await createClient().rpc("manage_company_category", { target_company: context.companyId, target_category: target, category_name: categoryName, expected_revision: revision, action });
    if (result.error) throw result.error;
  }
  async function create(event) {
    event.preventDefault();
    await run(async () => {
      const normalized = name.trim();
      if (!normalized || normalized.length > 80) throw new Error("分类名称需为 1–80 个字符。");
      // Retry-safe: a lost response reuses the same id for the same name.
      if (pending.current?.name !== normalized) pending.current = { id: crypto.randomUUID(), name: normalized };
      await call(pending.current.id, normalized, 0, "create");
      setName(""); pending.current = null; await load(); toast("分类已新增");
    });
  }
  async function saveRename(row) {
    await run(async () => {
      const normalized = rename.trim();
      if (!normalized || normalized.length > 80) throw new Error("分类名称需为 1–80 个字符。");
      await call(row.id, normalized, row.revision, "rename");
      setEditing(null); setRename(""); await load(); toast("分类已改名，产品同步更新");
    });
  }
  async function act(row, action) {
    if (!(await confirm({ title: `${action === "archive" ? "停用" : "恢复"}分类「${row.name}」？`, message: action === "archive" ? "不会删除产品，已有产品仍保留这个分类，可继续筛选。" : "恢复后可以再分配给产品。", confirmLabel: action === "archive" ? "停用" : "恢复", danger: action === "archive" }))) return;
    await run(async () => { await call(row.id, row.name, row.revision, action); await load(); toast("分类状态已更新"); });
  }

  return (
    <div className="stack">
      <form className="row" onSubmit={create}>
        <input className="input grow" aria-label="新分类名称" maxLength={80} placeholder="新分类名称" disabled={busy || blocked} value={name} onChange={e => setName(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy || blocked || !name.trim()}><Icon name="plus" size={18} />新增</button>
      </form>
      <InlineError onRetry={rows === null ? () => void run(load) : undefined}>{error}</InlineError>
      {rows === null ? <SkeletonList count={4} height={56} /> : !rows.length ? <EmptyState icon="tag" title="还没有分类" /> : (
        <div className="list-card">
          {rows.map(row => <div key={row.id} className="list-row" style={row.active ? undefined : { opacity: .6 }}>
            {editing?.id === row.id ? <form className="row grow" onSubmit={e => { e.preventDefault(); void saveRename(row); }}>
              <input className="input grow" style={{ minHeight: 40 }} aria-label={`重命名 ${row.name}`} maxLength={80} autoFocus value={rename} disabled={busy} onChange={e => setRename(e.target.value)} />
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>保存</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { setEditing(null); setRename(""); }}>取消</button>
            </form> : <>
              <span className="list-text"><span className="list-title" style={{ display: "block" }}>{row.name}</span>
                <span className="list-desc">{row.product_count} 项产品{row.active ? "" : " · 已停用"}</span></span>
              <MoreMenu label={`分类 ${row.name} 的更多操作`} disabled={busy || blocked} items={[
                row.active && { label: "重命名", icon: "sliders", onSelect: () => { setEditing(row); setRename(row.name); } },
                { label: row.active ? "停用" : "恢复", icon: row.active ? "lock" : "refresh", danger: row.active, onSelect: () => void act(row, row.active ? "archive" : "restore") }
              ]} />
            </>}
          </div>)}
        </div>
      )}
      <p className="field-hint">员工只能使用已有分类；改名会同步到现有产品，不改变历史报价。</p>
    </div>
  );
}
